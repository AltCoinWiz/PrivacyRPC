use once_cell::sync::Lazy;
use parking_lot::Mutex;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

// Proxy server state
static SHUTDOWN_TX: Lazy<Mutex<Option<oneshot::Sender<()>>>> = Lazy::new(|| Mutex::new(None));

// Shared stats counters
pub static REQUESTS_PROXIED: AtomicU64 = AtomicU64::new(0);
pub static BYTES_TRANSFERRED: AtomicU64 = AtomicU64::new(0);

// Shared proxy configuration
pub struct ProxyConfig {
    pub tor_enabled: bool,
    pub tor_socks_port: u16,
    pub rpc_provider_url: Option<String>,
}

static PROXY_CONFIG: Lazy<Mutex<ProxyConfig>> = Lazy::new(|| {
    Mutex::new(ProxyConfig {
        tor_enabled: false,
        tor_socks_port: 0,
        rpc_provider_url: None,
    })
});

/// Enable or disable Tor SOCKS5 routing for the proxy
pub fn set_tor_routing(enabled: bool, socks_port: u16) {
    let mut config = PROXY_CONFIG.lock();
    config.tor_enabled = enabled;
    config.tor_socks_port = socks_port;
    log::info!(
        "Tor routing {}: SOCKS port {}",
        if enabled { "enabled" } else { "disabled" },
        socks_port
    );
}

/// Set a custom RPC provider URL (replaces default Solana mainnet)
pub fn set_rpc_provider(url: Option<String>) {
    let mut config = PROXY_CONFIG.lock();
    log::info!(
        "RPC provider set to: {}",
        url.as_deref().unwrap_or("default (api.mainnet-beta.solana.com)")
    );
    config.rpc_provider_url = url;
}

pub async fn start_proxy_server(port: u16) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));

    let listener = TcpListener::bind(addr).await?;
    log::info!("Proxy server listening on {}", addr);

    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
    *SHUTDOWN_TX.lock() = Some(shutdown_tx);

    // Spawn the server in a background task
    tokio::spawn(async move {
        loop {
            tokio::select! {
                result = listener.accept() => {
                    match result {
                        Ok((stream, _)) => {
                            tokio::spawn(async move {
                                if let Err(e) = handle_connection(stream).await {
                                    log::error!("Connection error: {}", e);
                                }
                            });
                        }
                        Err(e) => {
                            log::error!("Accept error: {}", e);
                        }
                    }
                }
                _ = &mut shutdown_rx => {
                    log::info!("Proxy server shutting down");
                    break;
                }
            }
        }
    });

    Ok(())
}

pub async fn stop_proxy_server() {
    if let Some(tx) = SHUTDOWN_TX.lock().take() {
        let _ = tx.send(());
    }
}

async fn handle_connection(
    mut stream: TcpStream,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Peek at the first line to determine request type
    let mut peek_buf = [0u8; 8];
    let n = stream.peek(&mut peek_buf).await?;

    // Check if this is a CONNECT request
    if n >= 7 && &peek_buf[..7] == b"CONNECT" {
        return handle_connect(stream).await;
    }

    // For other requests, use buffered reading
    let (reader, mut writer) = stream.split();
    let mut buf_reader = BufReader::new(reader);

    // Read the HTTP request
    let mut request_line = String::new();
    buf_reader.read_line(&mut request_line).await?;

    // Read headers
    let mut content_length = 0usize;
    let mut target_url_header: Option<String> = None;

    loop {
        let mut line = String::new();
        buf_reader.read_line(&mut line).await?;
        if line == "\r\n" || line.is_empty() {
            break;
        }

        // Parse headers
        if let Some((key, value)) = line.split_once(':') {
            let key = key.trim().to_lowercase();
            let value = value.trim();

            if key == "content-length" {
                content_length = value.parse().unwrap_or(0);
            } else if key == "x-target-url" {
                target_url_header = Some(value.to_string());
            }
        }
    }

    // Determine target URL: X-Target-URL header > custom RPC provider > default
    let target_url = if let Some(ref header_url) = target_url_header {
        header_url.clone()
    } else {
        let config = PROXY_CONFIG.lock();
        config
            .rpc_provider_url
            .clone()
            .unwrap_or_else(|| "https://api.mainnet-beta.solana.com".to_string())
    };

    // Handle control endpoints
    if request_line.starts_with("POST /control/") || request_line.starts_with("GET /status") {
        // Read body for POST requests
        let mut body = vec![0u8; content_length];
        if content_length > 0 {
            buf_reader.read_exact(&mut body).await?;
        }
        return handle_control_endpoint(&request_line, &body, &mut writer).await;
    }

    // Handle different request types
    if request_line.starts_with("GET /health") {
        let response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 35\r\n\r\n{\"status\":\"ok\",\"proxy\":\"running\"}";
        writer.write_all(response.as_bytes()).await?;
        return Ok(());
    }

    if request_line.starts_with("OPTIONS") {
        let response = "HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, GET, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-Target-URL\r\nAccess-Control-Max-Age: 86400\r\nContent-Length: 0\r\n\r\n";
        writer.write_all(response.as_bytes()).await?;
        return Ok(());
    }

    // Read body for POST requests
    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        buf_reader.read_exact(&mut body).await?;
    }

    // Build HTTP client — with or without Tor SOCKS5 proxy
    let client = {
        let config = PROXY_CONFIG.lock();
        if config.tor_enabled && config.tor_socks_port > 0 {
            let proxy_url = format!("socks5h://127.0.0.1:{}", config.tor_socks_port);
            let proxy = reqwest::Proxy::all(&proxy_url).map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
                Box::new(e)
            })?;
            reqwest::Client::builder()
                .proxy(proxy)
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::new(e) })?
        } else {
            reqwest::Client::new()
        }
    };

    // Forward to target RPC
    let response = client
        .post(&target_url)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await;

    match response {
        Ok(resp) => {
            let status = resp.status();
            let body = resp.bytes().await.unwrap_or_default();

            // Update stats
            REQUESTS_PROXIED.fetch_add(1, Ordering::Relaxed);
            BYTES_TRANSFERRED.fetch_add(body.len() as u64, Ordering::Relaxed);

            let http_response = format!(
                "HTTP/1.1 {} OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-Target-URL\r\nContent-Length: {}\r\n\r\n",
                status.as_u16(),
                body.len()
            );

            writer.write_all(http_response.as_bytes()).await?;
            writer.write_all(&body).await?;
        }
        Err(e) => {
            let error_body = format!(r#"{{"error":"Proxy error: {}"}}"#, e);
            let response = format!(
                "HTTP/1.1 502 Bad Gateway\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\n\r\n{}",
                error_body.len(),
                error_body
            );
            writer.write_all(response.as_bytes()).await?;
        }
    }

    Ok(())
}

/// Handle control endpoints for native host communication and extension
async fn handle_control_endpoint<W: AsyncWriteExt + Unpin>(
    request_line: &str,
    body: &[u8],
    writer: &mut W,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (status_code, response_body) = if request_line.starts_with("GET /status") {
        // Enhanced status endpoint with live Tor status
        let (tor_enabled, tor_socks_port, rpc_provider) = {
            let config = PROXY_CONFIG.lock();
            (config.tor_enabled, config.tor_socks_port, config.rpc_provider_url.clone())
        };
        let tor_status = crate::tor::global_get_status().await;
        let body = serde_json::json!({
            "running": true,
            "version": "1.0.0",
            "tor_enabled": tor_enabled,
            "tor_socks_port": tor_socks_port,
            "tor_connected": tor_status.is_bootstrapped,
            "tor_ip": tor_status.exit_ip,
            "bootstrap_progress": tor_status.bootstrap_progress,
            "rpc_provider": rpc_provider,
            "requests_proxied": REQUESTS_PROXIED.load(Ordering::Relaxed),
            "bytes_transferred": BYTES_TRANSFERRED.load(Ordering::Relaxed),
        });
        (200, body.to_string())
    } else if request_line.starts_with("POST /control/enable_tor") {
        // Start Tor globally (manages process + proxy routing)
        match crate::tor::global_enable_tor().await {
            Ok(status) => {
                let resp = serde_json::json!({
                    "status": "ok",
                    "tor_enabled": true,
                    "tor_connected": status.is_bootstrapped,
                    "bootstrap_progress": status.bootstrap_progress,
                    "exit_ip": status.exit_ip,
                    "socks_port": status.socks_port,
                });
                (200, resp.to_string())
            }
            Err(e) => (500, format!(r#"{{"error":"{}"}}"#, e)),
        }
    } else if request_line.starts_with("POST /control/disable_tor") {
        match crate::tor::global_disable_tor().await {
            Ok(_) => (200, r#"{"status":"ok","tor_enabled":false}"#.to_string()),
            Err(e) => (500, format!(r#"{{"error":"{}"}}"#, e)),
        }
    } else if request_line.starts_with("POST /control/new_circuit") {
        match crate::tor::global_new_circuit().await {
            Ok(ip) => {
                let resp = serde_json::json!({"status": "ok", "exitIp": ip});
                (200, resp.to_string())
            }
            Err(e) => (500, format!(r#"{{"error":"{}"}}"#, e)),
        }
    } else if request_line.starts_with("POST /control/set_rpc") {
        if let Ok(json) = serde_json::from_slice::<serde_json::Value>(body) {
            let url = json
                .get("url")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            set_rpc_provider(url.clone());
            let resp = serde_json::json!({"status": "ok", "rpc_provider": url});
            (200, resp.to_string())
        } else {
            (400, r#"{"error":"Invalid JSON body"}"#.to_string())
        }
    } else if request_line.starts_with("POST /control/clear_rpc") {
        set_rpc_provider(None);
        (200, r#"{"status":"ok","rpc_provider":null}"#.to_string())
    } else {
        (404, r#"{"error":"Unknown control endpoint"}"#.to_string())
    };

    let http_response = format!(
        "HTTP/1.1 {} OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\n\r\n{}",
        status_code,
        response_body.len(),
        response_body
    );
    writer.write_all(http_response.as_bytes()).await?;
    Ok(())
}

/// Handle CONNECT requests for HTTPS tunneling
async fn handle_connect(
    mut stream: TcpStream,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut buf_reader = BufReader::new(&mut stream);

    // Read the CONNECT request line
    let mut request_line = String::new();
    buf_reader.read_line(&mut request_line).await?;

    // Parse: CONNECT host:port HTTP/1.1
    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 {
        return Err("Invalid CONNECT request".into());
    }
    let target = parts[1].to_string();
    log::info!("CONNECT tunnel requested to: {}", target);

    // Read and discard headers until empty line
    loop {
        let mut line = String::new();
        buf_reader.read_line(&mut line).await?;
        if line == "\r\n" || line.is_empty() {
            break;
        }
    }

    // Drop the buf_reader to release the borrow
    drop(buf_reader);

    // Check if Tor routing is enabled
    let (tor_enabled, tor_socks_port) = {
        let config = PROXY_CONFIG.lock();
        (config.tor_enabled, config.tor_socks_port)
    };

    // Connect to target — either directly or via Tor SOCKS5
    let connect_result = if tor_enabled && tor_socks_port > 0 {
        // Parse host:port for SOCKS5 connection
        let parts: Vec<&str> = target.splitn(2, ':').collect();
        if parts.len() != 2 {
            stream
                .write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n")
                .await?;
            return Err("Invalid CONNECT target format".into());
        }
        let host = parts[0];
        let port: u16 = parts[1].parse().unwrap_or(443);

        log::info!("CONNECT via Tor SOCKS5 to {}:{}", host, port);
        tokio_socks::tcp::Socks5Stream::connect(
            format!("127.0.0.1:{}", tor_socks_port).as_str(),
            (host, port),
        )
        .await
        .map(|s| s.into_inner())
        .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::new(e) })
    } else {
        TcpStream::connect(&target)
            .await
            .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::new(e) })
    };

    match connect_result {
        Ok(target_stream) => {
            // Send 200 Connection established
            stream
                .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                .await?;
            stream.flush().await?;

            // Update stats
            REQUESTS_PROXIED.fetch_add(1, Ordering::Relaxed);

            // Tunnel: copy data bidirectionally
            let (mut client_read, mut client_write) = stream.into_split();
            let (mut target_read, mut target_write) = target_stream.into_split();

            let client_to_target = async {
                let mut buf = [0u8; 8192];
                loop {
                    match client_read.read(&mut buf).await {
                        Ok(0) => break,
                        Ok(n) => {
                            BYTES_TRANSFERRED.fetch_add(n as u64, Ordering::Relaxed);
                            if target_write.write_all(&buf[..n]).await.is_err() {
                                break;
                            }
                            let _ = target_write.flush().await;
                        }
                        Err(_) => break,
                    }
                }
            };

            let target_to_client = async {
                let mut buf = [0u8; 8192];
                loop {
                    match target_read.read(&mut buf).await {
                        Ok(0) => break,
                        Ok(n) => {
                            BYTES_TRANSFERRED.fetch_add(n as u64, Ordering::Relaxed);
                            if client_write.write_all(&buf[..n]).await.is_err() {
                                break;
                            }
                            let _ = client_write.flush().await;
                        }
                        Err(_) => break,
                    }
                }
            };

            // Run both directions concurrently until one ends
            tokio::select! {
                _ = client_to_target => {}
                _ = target_to_client => {}
            }

            Ok(())
        }
        Err(e) => {
            log::error!("Failed to connect to {}: {}", target, e);
            stream
                .write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
                .await?;
            Err(e)
        }
    }
}
