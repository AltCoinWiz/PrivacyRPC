use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};

#[derive(Deserialize, Debug)]
pub struct NativeMessage {
    pub action: String,
    #[serde(default)]
    pub rpc_url: Option<String>,
}

#[derive(Serialize)]
pub struct NativeResponse {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub running: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tor_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tor_connected: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tor_ip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bootstrap_progress: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rpc_provider: Option<String>,
}

impl NativeResponse {
    fn ok() -> Self {
        NativeResponse {
            status: "ok".to_string(),
            port: None,
            error: None,
            running: None,
            tor_enabled: None,
            tor_connected: None,
            tor_ip: None,
            bootstrap_progress: None,
            rpc_provider: None,
        }
    }

    fn error(msg: String) -> Self {
        NativeResponse {
            status: "error".to_string(),
            port: None,
            error: Some(msg),
            running: None,
            tor_enabled: None,
            tor_connected: None,
            tor_ip: None,
            bootstrap_progress: None,
            rpc_provider: None,
        }
    }
}

/// Read a native messaging message from stdin
fn read_message() -> io::Result<Option<NativeMessage>> {
    let mut stdin = io::stdin().lock();

    // Read 4-byte length header (little-endian)
    let mut len_bytes = [0u8; 4];
    match stdin.read_exact(&mut len_bytes) {
        Ok(_) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }

    let len = u32::from_le_bytes(len_bytes) as usize;
    if len == 0 || len > 1024 * 1024 {
        return Ok(None);
    }

    // Read message body
    let mut body = vec![0u8; len];
    stdin.read_exact(&mut body)?;

    // Parse JSON
    match serde_json::from_slice(&body) {
        Ok(msg) => Ok(Some(msg)),
        Err(e) => {
            eprintln!("Failed to parse message: {}", e);
            Ok(None)
        }
    }
}

/// Write a native messaging response to stdout
fn write_response(response: &NativeResponse) -> io::Result<()> {
    let json = serde_json::to_vec(response).unwrap();
    let len = json.len() as u32;

    let mut stdout = io::stdout().lock();
    stdout.write_all(&len.to_le_bytes())?;
    stdout.write_all(&json)?;
    stdout.flush()?;

    Ok(())
}

/// Run the native messaging host loop
pub fn run_native_host() {
    // Create a tokio runtime for async operations
    let rt = tokio::runtime::Runtime::new().unwrap();

    loop {
        match read_message() {
            Ok(Some(msg)) => {
                let response = rt.block_on(handle_message(msg));
                if let Err(e) = write_response(&response) {
                    eprintln!("Failed to write response: {}", e);
                    break;
                }
            }
            Ok(None) => {
                // EOF or invalid message, exit
                break;
            }
            Err(e) => {
                eprintln!("Failed to read message: {}", e);
                break;
            }
        }
    }
}

async fn handle_message(msg: NativeMessage) -> NativeResponse {
    match msg.action.as_str() {
        "start" => {
            // Check if proxy is already running
            if check_proxy_running().await {
                return NativeResponse {
                    status: "started".to_string(),
                    port: Some(8899),
                    running: Some(true),
                    ..NativeResponse::ok()
                };
            }

            // Proxy not running - launch the GUI app with --autostart flag
            let exe_path = std::env::current_exe().unwrap_or_default();
            match std::process::Command::new(&exe_path)
                .arg("--autostart")
                .spawn()
            {
                Ok(_) => {
                    // Wait a bit for proxy to start
                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                    let running = check_proxy_running().await;
                    NativeResponse {
                        status: if running { "started" } else { "starting" }.to_string(),
                        port: Some(8899),
                        running: Some(running),
                        ..NativeResponse::ok()
                    }
                }
                Err(e) => NativeResponse::error(format!("Failed to launch app: {}", e)),
            }
        }
        "stop" => {
            // Don't actually stop - just report status
            let running = check_proxy_running().await;
            NativeResponse {
                status: "ok".to_string(),
                port: Some(8899),
                running: Some(running),
                ..NativeResponse::ok()
            }
        }
        "status" | "get_status" => {
            // Get full status including tor and rpc info
            match get_full_status().await {
                Some(status) => status,
                None => {
                    let running = check_proxy_running().await;
                    NativeResponse {
                        status: "ok".to_string(),
                        port: Some(8899),
                        running: Some(running),
                        ..NativeResponse::ok()
                    }
                }
            }
        }
        "enable_tor" => {
            // Forward to proxy control endpoint
            match proxy_control_post("/control/enable_tor", None).await {
                Ok(json) => {
                    let tor_enabled = json
                        .get("tor_enabled")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);

                    // Now get the full status to get exit IP etc.
                    let status = get_full_status().await;
                    if let Some(mut s) = status {
                        s.tor_enabled = Some(tor_enabled);
                        s
                    } else {
                        NativeResponse {
                            status: "ok".to_string(),
                            tor_enabled: Some(tor_enabled),
                            ..NativeResponse::ok()
                        }
                    }
                }
                Err(e) => NativeResponse::error(format!("Failed to enable Tor: {}", e)),
            }
        }
        "disable_tor" => {
            match proxy_control_post("/control/disable_tor", None).await {
                Ok(_) => NativeResponse {
                    status: "ok".to_string(),
                    tor_enabled: Some(false),
                    tor_connected: Some(false),
                    tor_ip: None,
                    ..NativeResponse::ok()
                },
                Err(e) => NativeResponse::error(format!("Failed to disable Tor: {}", e)),
            }
        }
        "new_circuit" => {
            match proxy_control_post("/control/new_circuit", None).await {
                Ok(json) => {
                    let exit_ip = json
                        .get("exitIp")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    NativeResponse {
                        status: "ok".to_string(),
                        tor_ip: exit_ip,
                        ..NativeResponse::ok()
                    }
                }
                Err(e) => NativeResponse::error(format!("Failed to create new circuit: {}", e)),
            }
        }
        "set_rpc" => {
            let rpc_url = msg.rpc_url.unwrap_or_default();
            let body = serde_json::json!({"url": rpc_url});
            match proxy_control_post("/control/set_rpc", Some(body)).await {
                Ok(json) => {
                    let provider = json
                        .get("rpc_provider")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    NativeResponse {
                        status: "ok".to_string(),
                        rpc_provider: provider,
                        ..NativeResponse::ok()
                    }
                }
                Err(e) => NativeResponse::error(format!("Failed to set RPC: {}", e)),
            }
        }
        "clear_rpc" => {
            match proxy_control_post("/control/clear_rpc", None).await {
                Ok(_) => NativeResponse {
                    status: "ok".to_string(),
                    rpc_provider: None,
                    ..NativeResponse::ok()
                },
                Err(e) => NativeResponse::error(format!("Failed to clear RPC: {}", e)),
            }
        }
        _ => NativeResponse::error(format!("Unknown action: {}", msg.action)),
    }
}

async fn check_proxy_running() -> bool {
    match reqwest::Client::new()
        .get("http://127.0.0.1:8899/health")
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
    {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}

/// Get full status from the proxy's /status endpoint
async fn get_full_status() -> Option<NativeResponse> {
    let client = reqwest::Client::new();
    let resp = client
        .get("http://127.0.0.1:8899/status")
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
        .ok()?;

    let json: serde_json::Value = resp.json().await.ok()?;

    Some(NativeResponse {
        status: "ok".to_string(),
        port: Some(8899),
        error: None,
        running: json.get("running").and_then(|v| v.as_bool()),
        tor_enabled: json.get("tor_enabled").and_then(|v| v.as_bool()),
        tor_connected: None, // Will be set by caller if needed
        tor_ip: json
            .get("tor_ip")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        bootstrap_progress: json
            .get("bootstrap_progress")
            .and_then(|v| v.as_u64())
            .map(|v| v as u8),
        rpc_provider: json
            .get("rpc_provider")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    })
}

/// POST to a proxy control endpoint
async fn proxy_control_post(
    path: &str,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:8899{}", path);

    let mut req = client
        .post(&url)
        .timeout(std::time::Duration::from_secs(30));

    if let Some(body) = body {
        req = req
            .header("Content-Type", "application/json")
            .body(body.to_string());
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Control endpoint returned {}", resp.status()));
    }

    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())
}
