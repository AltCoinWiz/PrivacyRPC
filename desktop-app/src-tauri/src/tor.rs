use once_cell::sync::Lazy;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

// Global Tor state accessible from both Tauri commands and proxy control endpoints
static GLOBAL_TOR: Lazy<Arc<Mutex<Option<TorManager>>>> =
    Lazy::new(|| Arc::new(Mutex::new(None)));
static RESOURCE_DIR: Lazy<parking_lot::Mutex<Option<PathBuf>>> =
    Lazy::new(|| parking_lot::Mutex::new(None));

/// Store the resource directory (call during Tauri setup)
pub fn set_resource_dir(dir: PathBuf) {
    *RESOURCE_DIR.lock() = Some(dir);
}

/// Start Tor globally. Returns TorStatus on success.
pub async fn global_enable_tor() -> Result<TorStatus, String> {
    let mut guard = GLOBAL_TOR.lock().await;

    // Already running?
    if let Some(ref manager) = *guard {
        let status = manager.get_status().await;
        if status.is_running {
            // Make sure proxy routing is set
            crate::proxy::set_tor_routing(true, status.socks_port);
            return Ok(status);
        }
    }

    let resource_dir = RESOURCE_DIR
        .lock()
        .clone()
        .unwrap_or_else(|| PathBuf::from("."));

    let mut manager = TorManager::new(resource_dir.clone());
    manager.start(&resource_dir).await?;

    let socks_port = manager.socks_port();
    let status = manager.get_status().await;

    // Configure proxy to route through Tor
    crate::proxy::set_tor_routing(true, socks_port);

    *guard = Some(manager);
    Ok(status)
}

/// Stop Tor globally.
pub async fn global_disable_tor() -> Result<(), String> {
    let mut guard = GLOBAL_TOR.lock().await;

    if let Some(ref mut manager) = *guard {
        manager.stop().await;
    }
    *guard = None;

    crate::proxy::set_tor_routing(false, 0);
    Ok(())
}

/// Request a new Tor circuit globally.
pub async fn global_new_circuit() -> Result<Option<String>, String> {
    let guard = GLOBAL_TOR.lock().await;
    let manager = guard
        .as_ref()
        .ok_or_else(|| "Tor is not running".to_string())?;
    manager.new_circuit().await
}

/// Get global Tor status.
pub async fn global_get_status() -> TorStatus {
    let guard = GLOBAL_TOR.lock().await;
    match *guard {
        Some(ref manager) => manager.get_status().await,
        None => TorStatus::default(),
    }
}

/// Status of the Tor process
#[derive(Clone, serde::Serialize, Default)]
pub struct TorStatus {
    pub is_running: bool,
    pub is_bootstrapped: bool,
    pub bootstrap_progress: u8,
    pub socks_port: u16,
    pub control_port: u16,
    pub exit_ip: Option<String>,
}

/// Manages an embedded Tor process
pub struct TorManager {
    process: Mutex<Option<Child>>,
    control_stream: Mutex<Option<TcpStream>>,
    data_dir: PathBuf,
    socks_port: u16,
    control_port: u16,
    is_running: Mutex<bool>,
    is_bootstrapped: Mutex<bool>,
    bootstrap_progress: Mutex<u8>,
    exit_ip: Mutex<Option<String>>,
    cookie_auth_file: PathBuf,
}

impl TorManager {
    /// Create a new TorManager. `resource_dir` is the Tauri resource directory
    /// containing the bundled `tor/` folder.
    pub fn new(_resource_dir: PathBuf) -> Self {
        let data_dir = std::env::temp_dir().join("privacyrpc-tor");
        let cookie_auth_file = data_dir.join("control_auth_cookie");

        Self {
            process: Mutex::new(None),
            control_stream: Mutex::new(None),
            data_dir,
            socks_port: 0,
            control_port: 0,
            is_running: Mutex::new(false),
            is_bootstrapped: Mutex::new(false),
            bootstrap_progress: Mutex::new(0),
            exit_ip: Mutex::new(None),
            cookie_auth_file,
        }
    }

    /// Start the Tor process. Returns once bootstrapped or on error.
    pub async fn start(&mut self, resource_dir: &PathBuf) -> Result<(), String> {
        if *self.is_running.lock().await {
            return Ok(());
        }

        // Ensure data directory exists
        tokio::fs::create_dir_all(&self.data_dir)
            .await
            .map_err(|e| format!("Failed to create data dir: {}", e))?;

        // Find free ports
        self.socks_port = find_free_port().await?;
        self.control_port = find_free_port().await?;

        // Resolve tor binary
        let tor_binary = self.find_tor_binary(resource_dir)?;
        log::info!("Using Tor binary: {}", tor_binary.display());

        // Write torrc
        let torrc_path = self.data_dir.join("torrc");
        let torrc_content = self.generate_torrc();
        tokio::fs::write(&torrc_path, &torrc_content)
            .await
            .map_err(|e| format!("Failed to write torrc: {}", e))?;

        // Spawn Tor process
        let mut child = Command::new(&tor_binary)
            .args(["-f", &torrc_path.to_string_lossy()])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("Failed to spawn Tor: {}", e))?;

        *self.is_running.lock().await = true;

        // Read stdout for bootstrap progress
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "No stdout from Tor process".to_string())?;

        *self.process.lock().await = Some(child);

        let mut reader = BufReader::new(stdout).lines();

        // Wait for bootstrap to complete (with timeout)
        let bootstrap_result = tokio::time::timeout(
            std::time::Duration::from_secs(120),
            async {
                while let Ok(Some(line)) = reader.next_line().await {
                    log::info!("[Tor] {}", line);

                    if let Some(progress) = parse_bootstrap_progress(&line) {
                        *self.bootstrap_progress.lock().await = progress;

                        if progress == 100 {
                            *self.is_bootstrapped.lock().await = true;
                            return Ok(());
                        }
                    }

                    // Check for fatal errors
                    if line.contains("[err]") || line.contains("[warn] Could not bind") {
                        return Err(format!("Tor error: {}", line));
                    }
                }
                Err("Tor process ended before bootstrap completed".to_string())
            },
        )
        .await;

        match bootstrap_result {
            Ok(Ok(())) => {
                // Connect to control port
                self.connect_control().await?;
                // Detect exit IP
                let _ = self.detect_exit_ip().await;

                // Spawn background reader for remaining stdout
                tokio::spawn(async move {
                    while let Ok(Some(line)) = reader.next_line().await {
                        log::debug!("[Tor] {}", line);
                    }
                });

                Ok(())
            }
            Ok(Err(e)) => {
                self.stop().await;
                Err(e)
            }
            Err(_) => {
                self.stop().await;
                Err("Tor bootstrap timed out after 120 seconds".to_string())
            }
        }
    }

    /// Stop the Tor process
    pub async fn stop(&mut self) {
        // Try graceful shutdown via control port
        if let Some(ref mut stream) = *self.control_stream.lock().await {
            let _ = send_control_command(stream, "SIGNAL SHUTDOWN").await;
        }
        *self.control_stream.lock().await = None;

        // Kill process
        if let Some(ref mut child) = *self.process.lock().await {
            let _ = child.kill().await;
        }
        *self.process.lock().await = None;

        *self.is_running.lock().await = false;
        *self.is_bootstrapped.lock().await = false;
        *self.bootstrap_progress.lock().await = 0;
        *self.exit_ip.lock().await = None;
    }

    /// Request a new Tor circuit (new exit IP)
    pub async fn new_circuit(&self) -> Result<Option<String>, String> {
        if !*self.is_bootstrapped.lock().await {
            return Err("Tor is not bootstrapped".to_string());
        }

        let mut guard = self.control_stream.lock().await;
        let stream = guard
            .as_mut()
            .ok_or_else(|| "Control socket not connected".to_string())?;

        send_control_command(stream, "SIGNAL NEWNYM")
            .await
            .map_err(|e| format!("Failed to send NEWNYM: {}", e))?;

        drop(guard);

        // Wait for new circuit to establish
        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;

        // Clear cached IP and re-detect
        *self.exit_ip.lock().await = None;
        self.detect_exit_ip().await
    }

    /// Get the current Tor status
    pub async fn get_status(&self) -> TorStatus {
        TorStatus {
            is_running: *self.is_running.lock().await,
            is_bootstrapped: *self.is_bootstrapped.lock().await,
            bootstrap_progress: *self.bootstrap_progress.lock().await,
            socks_port: self.socks_port,
            control_port: self.control_port,
            exit_ip: self.exit_ip.lock().await.clone(),
        }
    }

    /// Get the SOCKS port
    pub fn socks_port(&self) -> u16 {
        self.socks_port
    }

    /// Detect exit IP via Tor SOCKS proxy
    async fn detect_exit_ip(&self) -> Result<Option<String>, String> {
        let proxy_url = format!("socks5h://127.0.0.1:{}", self.socks_port);
        let proxy = reqwest::Proxy::all(&proxy_url)
            .map_err(|e| format!("Failed to create proxy: {}", e))?;

        let client = reqwest::Client::builder()
            .proxy(proxy)
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| format!("Failed to build client: {}", e))?;

        match client
            .get("https://check.torproject.org/api/ip")
            .send()
            .await
        {
            Ok(resp) => {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    if let Some(ip) = json.get("IP").and_then(|v| v.as_str()) {
                        let ip_str = ip.to_string();
                        *self.exit_ip.lock().await = Some(ip_str.clone());
                        log::info!("Tor exit IP: {}", ip_str);
                        return Ok(Some(ip_str));
                    }
                }
                Ok(None)
            }
            Err(e) => {
                log::warn!("Failed to detect Tor exit IP: {}", e);
                Ok(None)
            }
        }
    }

    /// Connect to the Tor control port using cookie authentication
    async fn connect_control(&self) -> Result<(), String> {
        // Wait for cookie file to be written
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        let cookie = tokio::fs::read(&self.cookie_auth_file)
            .await
            .map_err(|e| format!("Failed to read cookie auth file: {}", e))?;

        let mut stream = TcpStream::connect(format!("127.0.0.1:{}", self.control_port))
            .await
            .map_err(|e| format!("Failed to connect to control port: {}", e))?;

        // Authenticate with cookie
        let cookie_hex = hex::encode(&cookie);
        let auth_cmd = format!("AUTHENTICATE {}", cookie_hex);
        send_control_command(&mut stream, &auth_cmd)
            .await
            .map_err(|e| format!("Control auth failed: {}", e))?;

        *self.control_stream.lock().await = Some(stream);
        log::info!("Connected to Tor control port {}", self.control_port);
        Ok(())
    }

    /// Generate torrc configuration file content
    fn generate_torrc(&self) -> String {
        let data_dir = self.data_dir.to_string_lossy().replace('\\', "/");
        let cookie_file = self.cookie_auth_file.to_string_lossy().replace('\\', "/");

        format!(
            r#"# PrivacyRPC Embedded Tor Configuration
DataDirectory {data_dir}
SocksPort {socks_port}
ControlPort {control_port}
CookieAuthentication 1
CookieAuthFile {cookie_file}

# Client-only mode
ClientOnly 1

# Disable unnecessary features
AvoidDiskWrites 1
DisableDebuggerAttachment 1

# Optimize for RPC traffic
CircuitBuildTimeout 30
LearnCircuitBuildTimeout 0
NumEntryGuards 4
KeepalivePeriod 60

# Security settings
SafeSocks 1
TestSocks 0

# Logging
Log notice stdout
"#,
            data_dir = data_dir,
            socks_port = self.socks_port,
            control_port = self.control_port,
            cookie_file = cookie_file,
        )
    }

    /// Find the Tor binary in bundled resources or system
    fn find_tor_binary(&self, resource_dir: &PathBuf) -> Result<PathBuf, String> {
        let is_windows = cfg!(target_os = "windows");
        let tor_exe = if is_windows { "tor.exe" } else { "tor" };

        let locations = vec![
            // Bundled with desktop app (primary)
            resource_dir.join("tor").join(tor_exe),
            // Next to executable
            std::env::current_exe()
                .unwrap_or_default()
                .parent()
                .unwrap_or(&PathBuf::from("."))
                .join("tor")
                .join(tor_exe),
            // Development: SDK binaries
            PathBuf::from("../../../sdk/typescript/bin/win32-x64/tor").join(tor_exe),
        ];

        // System fallback paths
        let system_paths: Vec<PathBuf> = if is_windows {
            vec![
                PathBuf::from(r"C:\Program Files\Tor Browser\Browser\TorBrowser\Tor\tor.exe"),
                PathBuf::from(r"C:\Program Files\Tor\tor.exe"),
            ]
        } else {
            vec![
                PathBuf::from("/usr/bin/tor"),
                PathBuf::from("/usr/local/bin/tor"),
                PathBuf::from("/opt/homebrew/bin/tor"),
            ]
        };

        for loc in locations.iter().chain(system_paths.iter()) {
            if loc.exists() {
                log::info!("Found Tor binary at: {}", loc.display());
                return Ok(loc.clone());
            }
        }

        Err(
            "Tor binary not found. Ensure tor is bundled in the resources directory or installed on the system."
                .to_string(),
        )
    }
}

/// Find an available TCP port
async fn find_free_port() -> Result<u16, String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind for port discovery: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local addr: {}", e))?
        .port();
    drop(listener);
    Ok(port)
}

/// Parse bootstrap progress from a Tor log line
fn parse_bootstrap_progress(line: &str) -> Option<u8> {
    // Matches: "Bootstrapped 50% (loading_descriptors): Loading relay descriptors"
    if let Some(start) = line.find("Bootstrapped ") {
        let rest = &line[start + 13..];
        if let Some(pct_end) = rest.find('%') {
            if let Ok(progress) = rest[..pct_end].trim().parse::<u8>() {
                return Some(progress);
            }
        }
    }
    None
}

/// Send a command to the Tor control port and read the response
async fn send_control_command(stream: &mut TcpStream, command: &str) -> Result<String, String> {
    let cmd = format!("{}\r\n", command);
    stream
        .write_all(cmd.as_bytes())
        .await
        .map_err(|e| format!("Write failed: {}", e))?;
    stream
        .flush()
        .await
        .map_err(|e| format!("Flush failed: {}", e))?;

    let mut response = vec![0u8; 4096];
    let n = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        stream.read(&mut response),
    )
    .await
    .map_err(|_| "Control command timed out".to_string())?
    .map_err(|e| format!("Read failed: {}", e))?;

    let resp_str = String::from_utf8_lossy(&response[..n]).to_string();

    if resp_str.starts_with("250") {
        Ok(resp_str)
    } else {
        Err(format!("Tor control error: {}", resp_str.trim()))
    }
}

/// Helper to encode bytes as hex (avoid external dep if hex crate not available)
mod hex {
    pub fn encode(data: &[u8]) -> String {
        data.iter().map(|b| format!("{:02x}", b)).collect()
    }
}
