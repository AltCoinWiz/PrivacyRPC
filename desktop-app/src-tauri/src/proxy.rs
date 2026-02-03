use crate::transaction_decoder;
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

// Shared proxy configuration (Tor routing + RPC endpoint)
pub struct ProxyConfig {
    pub running: bool,
    pub tor_enabled: bool,
    pub tor_socks_port: u16,
    pub rpc_endpoint: Option<String>,
}

pub static PROXY_CONFIG: Lazy<Mutex<ProxyConfig>> = Lazy::new(|| {
    Mutex::new(ProxyConfig {
        running: false,
        tor_enabled: false,
        tor_socks_port: 0,
        rpc_endpoint: None,
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

/// Set the RPC endpoint (called from main.rs)
pub fn set_rpc_endpoint(endpoint: Option<String>) {
    let mut config = PROXY_CONFIG.lock();
    log::info!(
        "RPC endpoint set to: {}",
        endpoint.as_deref().unwrap_or("default (api.mainnet-beta.solana.com)")
    );
    config.rpc_endpoint = endpoint;
}

/// Get the current RPC endpoint
pub fn get_rpc_endpoint() -> Option<String> {
    PROXY_CONFIG.lock().rpc_endpoint.clone()
}

pub async fn start_proxy_server(port: u16) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));

    let listener = TcpListener::bind(addr).await?;
    log::info!("Proxy server listening on {}", addr);

    // Mark as running
    PROXY_CONFIG.lock().running = true;

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
                    PROXY_CONFIG.lock().running = false;
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
    // Also mark as not running immediately
    PROXY_CONFIG.lock().running = false;
}

/// Test the full routing path for diagnostics
/// Returns detailed info about each step: Proxy → RPC Endpoint → Tor
async fn test_routing_path() -> serde_json::Value {
    let start_time = std::time::Instant::now();

    // Step 1: Get current config
    let (tor_enabled, tor_socks_port, rpc_endpoint) = {
        let config = PROXY_CONFIG.lock();
        (config.tor_enabled, config.tor_socks_port, config.rpc_endpoint.clone())
    };

    let final_rpc = rpc_endpoint.clone()
        .unwrap_or_else(|| "https://api.mainnet-beta.solana.com".to_string());

    // Step 2: Build routing path description
    let mut routing_steps = vec![
        serde_json::json!({
            "step": 1,
            "component": "Browser/Extension",
            "action": "Request intercepted by PAC script",
            "status": "ok"
        }),
        serde_json::json!({
            "step": 2,
            "component": "PrivacyRPC Proxy",
            "action": format!("Listening on 127.0.0.1:8899"),
            "status": "ok"
        }),
    ];

    // Step 3: RPC endpoint
    routing_steps.push(serde_json::json!({
        "step": 3,
        "component": "RPC Endpoint",
        "action": format!("Forward to: {}", final_rpc),
        "mode": if rpc_endpoint.is_some() { "private_rpc" } else { "default" },
        "status": "ok"
    }));

    // Step 4: Tor (if enabled)
    if tor_enabled && tor_socks_port > 0 {
        routing_steps.push(serde_json::json!({
            "step": 4,
            "component": "Tor Network",
            "action": format!("Route through SOCKS5 127.0.0.1:{}", tor_socks_port),
            "status": "ok"
        }));
    }

    // Step 5: Actually test the connection by getting our exit IP
    let mut exit_ip = "unknown".to_string();
    let mut ip_test_status = "skipped";
    let mut ip_test_error: Option<String> = None;

    // Build client (with or without Tor)
    let client_result = if tor_enabled && tor_socks_port > 0 {
        let proxy_url = format!("socks5h://127.0.0.1:{}", tor_socks_port);
        reqwest::Client::builder()
            .proxy(reqwest::Proxy::all(&proxy_url).unwrap())
            .timeout(std::time::Duration::from_secs(15))
            .build()
    } else {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
    };

    if let Ok(client) = client_result {
        // Test 1: Get exit IP from ip-api.com
        match client.get("http://ip-api.com/json").send().await {
            Ok(resp) => {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    exit_ip = json.get("query")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    ip_test_status = "ok";
                }
            }
            Err(e) => {
                ip_test_status = "error";
                ip_test_error = Some(e.to_string());
            }
        }

        // Test 2: Check if it's a Tor exit (only if Tor enabled)
        let is_tor_exit = if tor_enabled {
            match client.get("https://check.torproject.org/api/ip").send().await {
                Ok(resp) => {
                    if let Ok(json) = resp.json::<serde_json::Value>().await {
                        json.get("IsTor").and_then(|v| v.as_bool()).unwrap_or(false)
                    } else {
                        false
                    }
                }
                Err(_) => false,
            }
        } else {
            false
        };

        routing_steps.push(serde_json::json!({
            "step": routing_steps.len() + 1,
            "component": "Exit IP Test",
            "action": format!("Your requests appear from: {}", exit_ip),
            "is_tor_exit": is_tor_exit,
            "status": ip_test_status,
            "error": ip_test_error
        }));

        // Test 3: Actually hit the RPC endpoint with getHealth
        let rpc_test_result = client
            .post(&final_rpc)
            .header("Content-Type", "application/json")
            .body(r#"{"jsonrpc":"2.0","id":1,"method":"getHealth"}"#)
            .send()
            .await;

        let (rpc_status, rpc_response_time) = match rpc_test_result {
            Ok(resp) => {
                let status = resp.status();
                (
                    if status.is_success() { "ok" } else { "error" },
                    start_time.elapsed().as_millis()
                )
            }
            Err(_) => ("error", 0u128),
        };

        routing_steps.push(serde_json::json!({
            "step": routing_steps.len() + 1,
            "component": "RPC Connectivity Test",
            "action": format!("getHealth to {}", final_rpc),
            "response_time_ms": rpc_response_time,
            "status": rpc_status
        }));
    }

    let total_time = start_time.elapsed().as_millis();

    serde_json::json!({
        "test": "routing_path",
        "timestamp": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
        "config": {
            "tor_enabled": tor_enabled,
            "tor_socks_port": tor_socks_port,
            "rpc_endpoint": rpc_endpoint,
            "final_rpc": final_rpc
        },
        "routing_path": routing_steps,
        "exit_ip": exit_ip,
        "total_test_time_ms": total_time,
        "summary": format!(
            "Request flow: Browser → Proxy(:8899) → {}{}",
            if rpc_endpoint.is_some() { "Private RPC" } else { "Default RPC" },
            if tor_enabled { " → Tor Network" } else { "" }
        )
    })
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

    // Note: target_url logic moved to final_target below for clarity

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

    // Diagnostic endpoint to verify routing configuration
    if request_line.starts_with("GET /test-routing") {
        let test_result = test_routing_path().await;
        let body = serde_json::to_string(&test_result).unwrap_or_default();
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        writer.write_all(response.as_bytes()).await?;
        return Ok(());
    }

    if request_line.starts_with("GET /config") {
        // Get config values without holding lock across await
        let (endpoint, tor_enabled, tor_socks_port) = {
            let proxy_cfg = PROXY_CONFIG.lock();
            (proxy_cfg.rpc_endpoint.clone(), proxy_cfg.tor_enabled, proxy_cfg.tor_socks_port)
        };

        // Get Tor connection status from tor module
        let (tor_connected, tor_ip) = crate::tor::get_tor_status();

        let mode = if endpoint.is_some() { "private_rpc" } else { "proxy_only" };
        let config_json = serde_json::json!({
            "mode": mode,
            "rpcEndpoint": endpoint,
            "torEnabled": tor_enabled,
            "torConnected": tor_connected,
            "torIp": tor_ip,
            "torSocksPort": tor_socks_port
        });
        let body = serde_json::to_string(&config_json).unwrap_or_default();
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        writer.write_all(response.as_bytes()).await?;
        return Ok(());
    }

    if request_line.starts_with("OPTIONS") {
        let response = "HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, GET, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-Target-URL\r\nAccess-Control-Max-Age: 86400\r\nContent-Length: 0\r\n\r\n";
        writer.write_all(response.as_bytes()).await?;
        return Ok(());
    }

    // Handle transaction decode endpoint
    if request_line.starts_with("POST /decode") {
        // Read body
        let mut body = vec![0u8; content_length];
        if content_length > 0 {
            buf_reader.read_exact(&mut body).await?;
        }

        let result = if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&body) {
            if let Some(tx) = json.get("transaction").and_then(|v| v.as_str()) {
                match transaction_decoder::decode_transaction(tx) {
                    Ok(decoded) => serde_json::json!({
                        "success": true,
                        "decoded": decoded
                    }),
                    Err(e) => serde_json::json!({
                        "success": false,
                        "error": e
                    }),
                }
            } else {
                serde_json::json!({
                    "success": false,
                    "error": "Missing 'transaction' field"
                })
            }
        } else {
            serde_json::json!({
                "success": false,
                "error": "Invalid JSON"
            })
        };

        let body = serde_json::to_string(&result).unwrap_or_default();
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        writer.write_all(response.as_bytes()).await?;
        return Ok(());
    }

    // Read body for POST requests
    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        buf_reader.read_exact(&mut body).await?;
    }

    // Check if this is a transaction-related RPC call and decode it
    let decoded_tx_info = decode_rpc_transaction(&body);
    if let Some(ref info) = decoded_tx_info {
        log::info!("Decoded transaction: {}", info.summary);
        if !info.warnings.is_empty() {
            for warning in &info.warnings {
                log::warn!("TX Warning: {} - {}", warning.title, warning.message);
            }
        }
    }

    // Check if this is a Jito-specific RPC method
    // Jito methods must go to Jito's endpoint - they're not supported by standard RPCs like Helius
    const JITO_METHODS: &[&str] = &[
        "getTipAccounts",
        "sendBundle",
        "getBundleStatuses",
        "simulateBundle",
        "getInflightBundleStatuses",
    ];
    // Jito's JSON-RPC endpoint for all MEV/bundle operations
    const JITO_MAINNET_URL: &str = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";

    // Extract method from JSON-RPC body
    let rpc_method = if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&body) {
        json.get("method").and_then(|m| m.as_str()).map(|s| s.to_string())
    } else {
        None
    };

    let is_jito_method = rpc_method.as_ref()
        .map(|m| JITO_METHODS.iter().any(|jm| m == *jm))
        .unwrap_or(false);

    // Smart routing: Jito methods -> Jito block engine, everything else -> private RPC
    let final_target = if is_jito_method {
        log::info!("Routing Jito method '{}' to Jito block engine", rpc_method.as_deref().unwrap_or("unknown"));
        JITO_MAINNET_URL.to_string()
    } else if let Some(private_endpoint) = get_rpc_endpoint() {
        // Standard RPC methods go to user's private endpoint
        log::info!("Routing '{}' to private endpoint", rpc_method.as_deref().unwrap_or("unknown"));
        private_endpoint
    } else if let Some(ref header_url) = target_url_header {
        // No private endpoint, use the original target from extension
        log::info!("Forwarding to X-Target-URL: {}", header_url);
        header_url.clone()
    } else {
        // Fall back to default Solana RPC
        log::info!("Routing to default Solana RPC");
        "https://api.mainnet-beta.solana.com".to_string()
    };

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
        .post(&final_target)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await;

    match response {
        Ok(resp) => {
            let status = resp.status();
            let response_body = resp.bytes().await.unwrap_or_default();

            log::info!("=== PROXY RESPONSE ===");
            log::info!("Upstream status: {}", status);
            log::info!("Response body (first 300 chars): {}", String::from_utf8_lossy(&response_body[..std::cmp::min(300, response_body.len())]));

            // Update stats
            REQUESTS_PROXIED.fetch_add(1, Ordering::Relaxed);
            BYTES_TRANSFERRED.fetch_add(response_body.len() as u64, Ordering::Relaxed);

            // If we decoded a transaction, enrich the response with the decoded info
            let final_body = if let Some(ref decoded) = decoded_tx_info {
                // Parse the original response and add decoded info
                if let Ok(mut json) = serde_json::from_slice::<serde_json::Value>(&response_body) {
                    // Add decoded transaction info to the response
                    json["_privacyrpc"] = serde_json::json!({
                        "decoded": decoded,
                        "intercepted": true
                    });
                    serde_json::to_vec(&json).unwrap_or_else(|_| response_body.to_vec())
                } else {
                    response_body.to_vec()
                }
            } else {
                response_body.to_vec()
            };

            let http_response = format!(
                "HTTP/1.1 {} OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-Target-URL\r\nContent-Length: {}\r\n\r\n",
                status.as_u16(),
                final_body.len()
            );

            writer.write_all(http_response.as_bytes()).await?;
            writer.write_all(&final_body).await?;
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

/// Decode transaction from RPC request body if it's a transaction-related method
fn decode_rpc_transaction(body: &[u8]) -> Option<transaction_decoder::DecodedTransaction> {
    let json: serde_json::Value = serde_json::from_slice(body).ok()?;

    let method = json.get("method")?.as_str()?;

    // Methods that contain transactions we can decode
    match method {
        "signTransaction" | "signAllTransactions" | "sendTransaction" | "simulateTransaction" => {
            // Try to extract transaction(s) from params
            let params = json.get("params")?;

            // signTransaction: params is typically [transaction_base64] or {transaction: base64}
            // sendTransaction: params is typically [transaction_base64, options?]
            let tx_encoded = if let Some(arr) = params.as_array() {
                // First param is usually the transaction
                arr.first()?.as_str()
            } else if let Some(obj) = params.as_object() {
                // Could be {transaction: "..."} format
                obj.get("transaction")?.as_str()
            } else {
                params.as_str()
            }?;

            match transaction_decoder::decode_transaction(tx_encoded) {
                Ok(decoded) => Some(decoded),
                Err(e) => {
                    log::debug!("Failed to decode transaction: {}", e);
                    None
                }
            }
        }
        _ => None,
    }
}

/// Handle control endpoints for native host communication and extension
async fn handle_control_endpoint<W: AsyncWriteExt + Unpin>(
    request_line: &str,
    body: &[u8],
    writer: &mut W,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (status_code, response_body) = if request_line.starts_with("GET /status") {
        // Enhanced status endpoint with live Tor status
        let (tor_enabled, tor_socks_port, rpc_endpoint) = {
            let config = PROXY_CONFIG.lock();
            (config.tor_enabled, config.tor_socks_port, config.rpc_endpoint.clone())
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
            "rpc_endpoint": rpc_endpoint,
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
            set_rpc_endpoint(url.clone());
            let resp = serde_json::json!({"status": "ok", "rpc_endpoint": url});
            (200, resp.to_string())
        } else {
            (400, r#"{"error":"Invalid JSON body"}"#.to_string())
        }
    } else if request_line.starts_with("POST /control/clear_rpc") {
        set_rpc_endpoint(None);
        (200, r#"{"status":"ok","rpc_endpoint":null}"#.to_string())
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
