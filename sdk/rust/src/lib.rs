//! PrivacyRPC SDK for Rust
//!
//! Secure RPC proxy and blockchain protection for Rust applications.
//!
//! # Example
//!
//! ```rust
//! use privacyrpc_sdk::{PrivacyRPC, Config, Chain};
//!
//! #[tokio::main]
//! async fn main() -> Result<(), Box<dyn std::error::Error>> {
//!     let config = Config::builder()
//!         .primary_rpc("https://mainnet.helius-rpc.com/?api-key=YOUR_KEY")
//!         .add_fallback("https://api.mainnet-beta.solana.com")
//!         .on_alert(|alert| println!("Alert: {:?}", alert))
//!         .build();
//!
//!     let privacy_rpc = PrivacyRPC::new(config);
//!     privacy_rpc.start().await?;
//!
//!     println!("Proxy URL: {}", privacy_rpc.proxy_url());
//!
//!     // Forward requests
//!     let response = privacy_rpc.forward_request(request).await?;
//!
//!     Ok(())
//! }
//! ```

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};

/// PrivacyRPC SDK main struct
pub struct PrivacyRPC {
    config: Config,
    running: AtomicBool,
    stats: Arc<RwLock<ProxyStats>>,
}

/// SDK Configuration
#[derive(Clone)]
pub struct Config {
    pub primary_rpc: String,
    pub fallback_rpcs: Vec<String>,
    pub proxy_port: u16,
    pub pinned_endpoints: Vec<String>,
    pub alert_handler: Option<Arc<dyn Fn(Alert) + Send + Sync>>,
}

impl Config {
    pub fn builder() -> ConfigBuilder {
        ConfigBuilder::default()
    }
}

/// Configuration builder
#[derive(Default)]
pub struct ConfigBuilder {
    primary_rpc: Option<String>,
    fallback_rpcs: Vec<String>,
    proxy_port: u16,
    pinned_endpoints: Vec<String>,
    alert_handler: Option<Arc<dyn Fn(Alert) + Send + Sync>>,
}

impl ConfigBuilder {
    pub fn primary_rpc(mut self, url: &str) -> Self {
        self.primary_rpc = Some(url.to_string());
        self
    }

    pub fn add_fallback(mut self, url: &str) -> Self {
        self.fallback_rpcs.push(url.to_string());
        self
    }

    pub fn proxy_port(mut self, port: u16) -> Self {
        self.proxy_port = port;
        self
    }

    pub fn pin_endpoint(mut self, hostname: &str) -> Self {
        self.pinned_endpoints.push(hostname.to_string());
        self
    }

    pub fn on_alert<F>(mut self, handler: F) -> Self
    where
        F: Fn(Alert) + Send + Sync + 'static,
    {
        self.alert_handler = Some(Arc::new(handler));
        self
    }

    /// Configure with Helius
    pub fn use_helius(mut self, api_key: &str) -> Self {
        self.primary_rpc = Some(format!(
            "https://mainnet.helius-rpc.com/?api-key={}",
            api_key
        ));
        self.pinned_endpoints.push("mainnet.helius-rpc.com".to_string());
        self
    }

    /// Configure with Alchemy
    pub fn use_alchemy(mut self, api_key: &str, chain: Chain) -> Self {
        let url = match chain {
            Chain::Solana => format!("https://solana-mainnet.g.alchemy.com/v2/{}", api_key),
            Chain::Ethereum => format!("https://eth-mainnet.g.alchemy.com/v2/{}", api_key),
            Chain::Polygon => format!("https://polygon-mainnet.g.alchemy.com/v2/{}", api_key),
            Chain::Arbitrum => format!("https://arb-mainnet.g.alchemy.com/v2/{}", api_key),
            Chain::Optimism => format!("https://opt-mainnet.g.alchemy.com/v2/{}", api_key),
            Chain::Base => format!("https://base-mainnet.g.alchemy.com/v2/{}", api_key),
        };
        self.primary_rpc = Some(url);
        self
    }

    pub fn build(self) -> Config {
        Config {
            primary_rpc: self.primary_rpc.unwrap_or_else(|| {
                "https://api.mainnet-beta.solana.com".to_string()
            }),
            fallback_rpcs: self.fallback_rpcs,
            proxy_port: if self.proxy_port == 0 { 8899 } else { self.proxy_port },
            pinned_endpoints: self.pinned_endpoints,
            alert_handler: self.alert_handler,
        }
    }
}

impl PrivacyRPC {
    /// Create a new PrivacyRPC instance
    pub fn new(config: Config) -> Self {
        Self {
            config,
            running: AtomicBool::new(false),
            stats: Arc::new(RwLock::new(ProxyStats::default())),
        }
    }

    /// Get the proxy URL
    pub fn proxy_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.config.proxy_port)
    }

    /// Check if running
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// Start the proxy server
    pub async fn start(&self) -> Result<(), Error> {
        if self.is_running() {
            return Ok(());
        }

        self.running.store(true, Ordering::SeqCst);

        // Emit start alert
        if let Some(handler) = &self.config.alert_handler {
            handler(Alert {
                alert_type: AlertType::ProxyStarted,
                severity: Severity::Info,
                message: format!("PrivacyRPC proxy started on port {}", self.config.proxy_port),
                hostname: None,
                details: None,
                timestamp: chrono::Utc::now().timestamp_millis() as u64,
            });
        }

        // Start the HTTP server
        self.run_server().await
    }

    /// Stop the proxy server
    pub async fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);

        if let Some(handler) = &self.config.alert_handler {
            handler(Alert {
                alert_type: AlertType::ProxyStopped,
                severity: Severity::Info,
                message: "PrivacyRPC proxy stopped".to_string(),
                hostname: None,
                details: None,
                timestamp: chrono::Utc::now().timestamp_millis() as u64,
            });
        }
    }

    /// Get proxy statistics
    pub async fn get_stats(&self) -> ProxyStats {
        self.stats.read().await.clone()
    }

    /// Set primary RPC endpoint
    pub fn set_primary_rpc(&mut self, url: String) {
        self.config.primary_rpc = url;
    }

    /// Forward a single RPC request
    pub async fn forward_request(&self, request: RpcRequest) -> Result<RpcResponse, Error> {
        self.send_to_rpc(&request).await
    }

    async fn run_server(&self) -> Result<(), Error> {
        use hyper::service::{make_service_fn, service_fn};
        use hyper::{Body, Request, Response, Server, Method, StatusCode};

        let config = self.config.clone();
        let stats = self.stats.clone();
        let running = &self.running;

        let make_svc = make_service_fn(move |_| {
            let config = config.clone();
            let stats = stats.clone();

            async move {
                Ok::<_, hyper::Error>(service_fn(move |req: Request<Body>| {
                    let config = config.clone();
                    let stats = stats.clone();

                    async move {
                        // Handle CORS
                        if req.method() == Method::OPTIONS {
                            return Ok::<_, hyper::Error>(
                                Response::builder()
                                    .status(StatusCode::NO_CONTENT)
                                    .header("Access-Control-Allow-Origin", "*")
                                    .header("Access-Control-Allow-Methods", "POST, OPTIONS")
                                    .header("Access-Control-Allow-Headers", "Content-Type")
                                    .body(Body::empty())
                                    .unwrap()
                            );
                        }

                        // Read body
                        let body_bytes = hyper::body::to_bytes(req.into_body()).await?;
                        let body_str = String::from_utf8_lossy(&body_bytes);

                        // Parse request
                        let rpc_request: RpcRequest = match serde_json::from_str(&body_str) {
                            Ok(r) => r,
                            Err(_) => {
                                return Ok(Response::builder()
                                    .status(StatusCode::BAD_REQUEST)
                                    .body(Body::from(r#"{"error":"Invalid JSON"}"#))
                                    .unwrap());
                            }
                        };

                        // Update stats
                        {
                            let mut s = stats.write().await;
                            s.total_requests += 1;
                            s.last_request_time = chrono::Utc::now().timestamp_millis() as u64;
                            *s.method_stats.entry(rpc_request.method.clone()).or_insert(0) += 1;
                        }

                        // Forward to RPC
                        let response = forward_to_rpc(&config, &rpc_request).await;

                        let response_json = serde_json::to_string(&response).unwrap();

                        Ok(Response::builder()
                            .status(StatusCode::OK)
                            .header("Content-Type", "application/json")
                            .header("Access-Control-Allow-Origin", "*")
                            .body(Body::from(response_json))
                            .unwrap())
                    }
                }))
            }
        });

        let addr = ([127, 0, 0, 1], self.config.proxy_port).into();
        let server = Server::bind(&addr).serve(make_svc);

        server.await.map_err(|e| Error::ServerError(e.to_string()))
    }

    async fn send_to_rpc(&self, request: &RpcRequest) -> Result<RpcResponse, Error> {
        forward_to_rpc(&self.config, request).await
    }
}

async fn forward_to_rpc(config: &Config, request: &RpcRequest) -> Result<RpcResponse, Error> {
    let client = reqwest::Client::new();
    let rpcs: Vec<&str> = std::iter::once(config.primary_rpc.as_str())
        .chain(config.fallback_rpcs.iter().map(|s| s.as_str()))
        .collect();

    for rpc in rpcs {
        match client
            .post(rpc)
            .json(request)
            .send()
            .await
        {
            Ok(resp) => {
                if let Ok(rpc_response) = resp.json::<RpcResponse>().await {
                    return Ok(rpc_response);
                }
            }
            Err(_) => continue,
        }
    }

    Ok(RpcResponse {
        jsonrpc: "2.0".to_string(),
        id: request.id.clone(),
        result: None,
        error: Some(RpcError {
            code: -32000,
            message: "All RPC endpoints failed".to_string(),
            data: None,
        }),
    })
}

/// Supported blockchain networks
#[derive(Debug, Clone, Copy)]
pub enum Chain {
    Solana,
    Ethereum,
    Polygon,
    Arbitrum,
    Optimism,
    Base,
}

/// JSON-RPC Request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcRequest {
    pub jsonrpc: String,
    pub id: Option<serde_json::Value>,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

/// JSON-RPC Response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcResponse {
    pub jsonrpc: String,
    pub id: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

/// JSON-RPC Error
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

/// PrivacyRPC Alert
#[derive(Debug, Clone)]
pub struct Alert {
    pub alert_type: AlertType,
    pub severity: Severity,
    pub message: String,
    pub hostname: Option<String>,
    pub details: Option<HashMap<String, String>>,
    pub timestamp: u64,
}

/// Alert types
#[derive(Debug, Clone, Copy)]
pub enum AlertType {
    MitmDetected,
    CertificateMismatch,
    DnsHijacking,
    SslStripping,
    SuspiciousCertificate,
    PublicRpcDetected,
    RpcFailover,
    RpcAllFailed,
    ProxyError,
    ProxyStarted,
    ProxyStopped,
}

/// Alert severity
#[derive(Debug, Clone, Copy)]
pub enum Severity {
    Info,
    Low,
    Medium,
    High,
    Critical,
}

/// Proxy statistics
#[derive(Debug, Clone, Default)]
pub struct ProxyStats {
    pub is_running: bool,
    pub port: u16,
    pub primary_rpc: String,
    pub total_requests: u64,
    pub total_errors: u64,
    pub method_stats: HashMap<String, u64>,
    pub last_request_time: u64,
    pub uptime_ms: u64,
}

/// SDK Errors
#[derive(Debug, serde::Serialize)]
pub enum Error {
    ServerError(String),
    RpcError(String),
    ConfigError(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::ServerError(msg) => write!(f, "Server error: {}", msg),
            Error::RpcError(msg) => write!(f, "RPC error: {}", msg),
            Error::ConfigError(msg) => write!(f, "Config error: {}", msg),
        }
    }
}

impl std::error::Error for Error {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_builder() {
        let config = Config::builder()
            .primary_rpc("https://example.com")
            .add_fallback("https://fallback.com")
            .proxy_port(9000)
            .build();

        assert_eq!(config.primary_rpc, "https://example.com");
        assert_eq!(config.fallback_rpcs.len(), 1);
        assert_eq!(config.proxy_port, 9000);
    }

    #[test]
    fn test_helius_config() {
        let config = Config::builder()
            .use_helius("test-key")
            .build();

        assert!(config.primary_rpc.contains("helius"));
        assert!(config.primary_rpc.contains("test-key"));
    }
}
