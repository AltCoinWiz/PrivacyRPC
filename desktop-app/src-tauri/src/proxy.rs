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

// Global RPC endpoint config
static RPC_ENDPOINT: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

/// Set the RPC endpoint (called from main.rs)
pub fn set_rpc_endpoint(endpoint: Option<String>) {
    *RPC_ENDPOINT.lock() = endpoint;
}

/// Get the current RPC endpoint
pub fn get_rpc_endpoint() -> Option<String> {
    RPC_ENDPOINT.lock().clone()
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
    let mut target_url = String::from("https://api.mainnet-beta.solana.com");

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
                target_url = value.to_string();
            }
        }
    }

    // Handle different request types
    if request_line.starts_with("GET /health") {
        let response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 35\r\n\r\n{\"status\":\"ok\",\"proxy\":\"running\"}";
        writer.write_all(response.as_bytes()).await?;
        return Ok(());
    }

    if request_line.starts_with("GET /status") {
        let response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 36\r\n\r\n{\"running\":true,\"version\":\"1.0.0\"}";
        writer.write_all(response.as_bytes()).await?;
        return Ok(());
    }

    if request_line.starts_with("GET /config") {
        let endpoint = get_rpc_endpoint();
        let mode = if endpoint.is_some() { "private_rpc" } else { "proxy_only" };
        let config_json = serde_json::json!({
            "mode": mode,
            "rpcEndpoint": endpoint,
            "torEnabled": false
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

    // Check if user has configured a private RPC endpoint - if so, route there
    let final_target = if let Some(private_endpoint) = get_rpc_endpoint() {
        // User has a private RPC configured - route all Solana RPC traffic there
        log::info!("Routing RPC request to private endpoint: {}", private_endpoint);
        private_endpoint
    } else {
        // No private endpoint - use original target (default or from header)
        target_url
    };

    // Forward to target RPC
    let client = reqwest::Client::new();
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

    // Connect to target
    match TcpStream::connect(&target).await {
        Ok(mut target_stream) => {
            // Send 200 Connection established
            stream.write_all(b"HTTP/1.1 200 Connection established\r\n\r\n").await?;
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
            stream.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n").await?;
            Err(e.into())
        }
    }
}
