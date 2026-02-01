use futures_util::{SinkExt, StreamExt};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_tungstenite::{accept_async, tungstenite::Message};

const WS_PORT: u16 = 8898;

// Client ID counter
static CLIENT_ID: AtomicU64 = AtomicU64::new(1);

// Connected clients - map of client_id -> sender channel
static CLIENTS: Lazy<Mutex<HashMap<u64, mpsc::UnboundedSender<String>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// State update message sent to extension
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StateUpdate {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub proxy_running: bool,
    pub proxy_mode: String,
    pub rpc_endpoint: Option<String>,
    pub tor_enabled: bool,
    pub tor_connected: bool,
    pub tor_ip: Option<String>,
}

/// Start the WebSocket server for extension communication
pub async fn start_websocket_server() {
    let addr = format!("127.0.0.1:{}", WS_PORT);

    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            log::error!("Failed to bind WebSocket server to {}: {}", addr, e);
            return;
        }
    };

    log::info!("WebSocket server listening on ws://{}", addr);

    while let Ok((stream, peer)) = listener.accept().await {
        log::info!("New WebSocket connection from {}", peer);
        tokio::spawn(handle_connection(stream));
    }
}

/// Handle a single WebSocket connection
async fn handle_connection(stream: TcpStream) {
    let ws_stream = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            log::error!("WebSocket handshake failed: {}", e);
            return;
        }
    };

    let client_id = CLIENT_ID.fetch_add(1, Ordering::SeqCst);
    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    // Create channel for sending messages to this client
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    // Register client
    {
        let mut clients = CLIENTS.lock();
        clients.insert(client_id, tx);
        log::info!("Client {} connected. Total clients: {}", client_id, clients.len());
    }

    // Send initial state
    if let Some(state) = get_current_state() {
        let json = serde_json::to_string(&state).unwrap_or_default();
        let _ = ws_sender.send(Message::Text(json)).await;
    }

    // Spawn task to forward messages from channel to WebSocket
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sender.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    // Handle incoming messages (ping/pong, close, etc.)
    while let Some(msg) = ws_receiver.next().await {
        match msg {
            Ok(Message::Close(_)) => break,
            Ok(Message::Ping(data)) => {
                // Respond with pong - need to get sender back
                // For simplicity, we just ignore pings as the channel handles it
            }
            Ok(Message::Text(text)) => {
                // Handle requests from extension if needed
                log::debug!("Received from client {}: {}", client_id, text);
            }
            Err(e) => {
                log::error!("WebSocket error for client {}: {}", client_id, e);
                break;
            }
            _ => {}
        }
    }

    // Cleanup
    {
        let mut clients = CLIENTS.lock();
        clients.remove(&client_id);
        log::info!("Client {} disconnected. Total clients: {}", client_id, clients.len());
    }

    send_task.abort();
}

/// Broadcast state update to all connected clients
pub fn broadcast_state_update(update: StateUpdate) {
    let json = match serde_json::to_string(&update) {
        Ok(j) => j,
        Err(e) => {
            log::error!("Failed to serialize state update: {}", e);
            return;
        }
    };

    let clients = CLIENTS.lock();
    for (client_id, tx) in clients.iter() {
        if let Err(e) = tx.send(json.clone()) {
            log::warn!("Failed to send to client {}: {}", client_id, e);
        }
    }

    if !clients.is_empty() {
        log::debug!("Broadcast state update to {} clients", clients.len());
    }
}

/// Get current state from proxy config
fn get_current_state() -> Option<StateUpdate> {
    let proxy_cfg = crate::proxy::PROXY_CONFIG.lock();
    let (tor_connected, tor_ip) = crate::tor::get_tor_status();

    Some(StateUpdate {
        msg_type: "STATE_UPDATE".to_string(),
        proxy_running: proxy_cfg.running,
        proxy_mode: if proxy_cfg.rpc_endpoint.is_some() {
            "private_rpc".to_string()
        } else {
            "proxy_only".to_string()
        },
        rpc_endpoint: proxy_cfg.rpc_endpoint.clone(),
        tor_enabled: proxy_cfg.tor_enabled,
        tor_connected,
        tor_ip,
    })
}

/// Helper to broadcast current state (call after any state change)
pub fn broadcast_current_state() {
    if let Some(state) = get_current_state() {
        broadcast_state_update(state);
    }
}
