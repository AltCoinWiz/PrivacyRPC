use std::io::{self, Read, Write};
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Debug)]
pub struct NativeMessage {
    pub action: String,
    #[serde(default)]
    pub port: Option<u16>,
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
                    error: None,
                    running: Some(true),
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
                        error: None,
                        running: Some(running),
                    }
                }
                Err(e) => NativeResponse {
                    status: "error".to_string(),
                    port: None,
                    error: Some(format!("Failed to launch app: {}", e)),
                    running: Some(false),
                },
            }
        }
        "stop" => {
            // Don't actually stop - just report status
            // User should stop from GUI app
            let running = check_proxy_running().await;
            NativeResponse {
                status: "ok".to_string(),
                port: Some(8899),
                error: None,
                running: Some(running),
            }
        }
        "status" => {
            let running = check_proxy_running().await;
            NativeResponse {
                status: "ok".to_string(),
                port: Some(8899),
                error: None,
                running: Some(running),
            }
        }
        _ => NativeResponse {
            status: "error".to_string(),
            port: None,
            error: Some(format!("Unknown action: {}", msg.action)),
            running: None,
        },
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
