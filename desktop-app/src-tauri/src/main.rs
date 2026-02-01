#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod proxy;
mod native_messaging;
mod native_host;
mod transaction_decoder;

pub use transaction_decoder::{decode_transaction, DecodedTransaction};

use parking_lot::Mutex;
use std::net::TcpListener;
use std::sync::Arc;
use std::time::Instant;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State,
};

// Application state
pub struct AppState {
    pub proxy_running: Mutex<bool>,
    pub proxy_port: Mutex<u16>,
    pub tor_enabled: Mutex<bool>,
    pub tor_connected: Mutex<bool>,
    pub stats: Mutex<ProxyStats>,
    pub started_at: Mutex<Option<Instant>>,
    pub rpc_endpoint: Mutex<Option<String>>,
}

#[derive(Default, Clone, serde::Serialize)]
pub struct ProxyStats {
    pub requests_proxied: u64,
    pub bytes_transferred: u64,
    pub uptime_seconds: u64,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            proxy_running: Mutex::new(false),
            proxy_port: Mutex::new(8899),
            tor_enabled: Mutex::new(false),
            tor_connected: Mutex::new(false),
            stats: Mutex::new(ProxyStats::default()),
            started_at: Mutex::new(None),
            rpc_endpoint: Mutex::new(None),
        }
    }
}

/// Try to acquire single-instance lock by binding to a local port.
/// Returns the listener if we got the lock (first instance), None if already running.
fn try_acquire_instance_lock() -> Option<TcpListener> {
    match TcpListener::bind("127.0.0.1:18899") {
        Ok(listener) => Some(listener), // We got the lock
        Err(_) => None,                 // Port taken = already running
    }
}

/// Kill any existing PrivacyRPC processes using the port
fn kill_old_instances(port: u16) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;

        // Find process using the port using netstat
        let output = Command::new("cmd")
            .args(["/C", &format!("netstat -ano | findstr :{}", port)])
            .output()
            .map_err(|e| e.to_string())?;

        let output_str = String::from_utf8_lossy(&output.stdout);

        for line in output_str.lines() {
            // Parse PID from netstat output (last column)
            let parts: Vec<&str> = line.split_whitespace().collect();
            if let Some(pid_str) = parts.last() {
                if let Ok(pid) = pid_str.parse::<u32>() {
                    // Check if this PID is privacyrpc.exe
                    let check = Command::new("cmd")
                        .args(["/C", &format!("tasklist /FI \"PID eq {}\" /FO CSV /NH", pid)])
                        .output();

                    if let Ok(check_output) = check {
                        let process_info = String::from_utf8_lossy(&check_output.stdout);
                        if process_info.to_lowercase().contains("privacyrpc") {
                            log::info!("Killing old PrivacyRPC instance (PID: {})", pid);
                            let _ = Command::new("taskkill")
                                .args(["/F", "/PID", pid_str])
                                .output();
                            // Wait a moment for port to be released
                            std::thread::sleep(std::time::Duration::from_millis(500));
                        }
                    }
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        use std::process::Command;

        // Use lsof on Unix-like systems
        let output = Command::new("lsof")
            .args(["-i", &format!(":{}", port), "-t"])
            .output();

        if let Ok(output) = output {
            let pids = String::from_utf8_lossy(&output.stdout);
            for pid in pids.lines() {
                // Check if it's privacyrpc
                let check = Command::new("ps")
                    .args(["-p", pid, "-o", "comm="])
                    .output();

                if let Ok(check_output) = check {
                    let process_name = String::from_utf8_lossy(&check_output.stdout);
                    if process_name.to_lowercase().contains("privacyrpc") {
                        log::info!("Killing old PrivacyRPC instance (PID: {})", pid);
                        let _ = Command::new("kill").args(["-9", pid]).output();
                        std::thread::sleep(std::time::Duration::from_millis(500));
                    }
                }
            }
        }
    }

    Ok(())
}

// Tauri commands
#[tauri::command]
async fn start_proxy(state: State<'_, Arc<AppState>>) -> Result<bool, String> {
    let port = *state.proxy_port.lock();

    // First attempt to start
    match proxy::start_proxy_server(port).await {
        Ok(_) => {
            *state.proxy_running.lock() = true;
            *state.started_at.lock() = Some(Instant::now());
            log::info!("Proxy server started on port {}", port);
            Ok(true)
        }
        Err(e) => {
            let err_str = e.to_string();

            // Check if it's a port-in-use error (Windows error 10048 or 10049)
            if err_str.contains("10048") || err_str.contains("10049") ||
               err_str.contains("address already in use") || err_str.contains("Address already in use") {
                log::warn!("Port {} in use, attempting to kill old instances...", port);

                // Try to kill old instances
                if let Err(kill_err) = kill_old_instances(port) {
                    log::warn!("Failed to kill old instances: {}", kill_err);
                }

                // Retry starting the proxy
                match proxy::start_proxy_server(port).await {
                    Ok(_) => {
                        *state.proxy_running.lock() = true;
                        *state.started_at.lock() = Some(Instant::now());
                        log::info!("Proxy server started on port {} (after killing old instance)", port);
                        Ok(true)
                    }
                    Err(retry_err) => {
                        log::error!("Failed to start proxy after retry: {}", retry_err);
                        Err(format!("Port {} still in use. Please close other applications using this port.", port))
                    }
                }
            } else {
                log::error!("Failed to start proxy: {}", e);
                Err(e.to_string())
            }
        }
    }
}

#[tauri::command]
async fn stop_proxy(state: State<'_, Arc<AppState>>) -> Result<bool, String> {
    proxy::stop_proxy_server().await;
    *state.proxy_running.lock() = false;
    *state.started_at.lock() = None;
    log::info!("Proxy server stopped");
    Ok(true)
}

#[tauri::command]
fn get_status(state: State<'_, Arc<AppState>>) -> serde_json::Value {
    let running = *state.proxy_running.lock();
    let port = *state.proxy_port.lock();
    let tor_enabled = *state.tor_enabled.lock();
    let tor_connected = *state.tor_connected.lock();
    let rpc_endpoint = state.rpc_endpoint.lock().clone();

    // Read live stats from proxy counters
    let requests = proxy::REQUESTS_PROXIED.load(std::sync::atomic::Ordering::Relaxed);
    let bytes = proxy::BYTES_TRANSFERRED.load(std::sync::atomic::Ordering::Relaxed);
    let mut uptime = 0u64;
    if let Some(started) = *state.started_at.lock() {
        uptime = started.elapsed().as_secs();
    }

    serde_json::json!({
        "running": running,
        "port": port,
        "torEnabled": tor_enabled,
        "torConnected": tor_connected,
        "rpcEndpoint": rpc_endpoint,
        "stats": {
            "requests_proxied": requests,
            "bytes_transferred": bytes,
            "uptime_seconds": uptime
        }
    })
}

#[tauri::command]
fn set_port(port: u16, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    if port < 1024 || port > 65535 {
        return Err("Port must be between 1024 and 65535".to_string());
    }
    *state.proxy_port.lock() = port;
    Ok(())
}

#[tauri::command]
fn set_rpc_endpoint(endpoint: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let endpoint = endpoint.trim().to_string();
    if endpoint.is_empty() {
        *state.rpc_endpoint.lock() = None;
        // Clear the global config
        proxy::set_rpc_endpoint(None);
        save_config_file(None);
    } else {
        // Basic validation - should be a URL
        if !endpoint.starts_with("http://") && !endpoint.starts_with("https://") {
            return Err("RPC endpoint must be a valid URL starting with http:// or https://".to_string());
        }
        *state.rpc_endpoint.lock() = Some(endpoint.clone());
        // Update the global proxy config
        proxy::set_rpc_endpoint(Some(endpoint.clone()));
        save_config_file(Some(&endpoint));
        log::info!("RPC endpoint set to: {}", endpoint);
    }
    Ok(())
}

/// Save config to file for persistence and sharing with proxy
fn save_config_file(endpoint: Option<&str>) {
    if let Some(config_dir) = directories::ProjectDirs::from("com", "privacyrpc", "PrivacyRPC") {
        let config_path = config_dir.config_dir().join("config.json");
        if let Some(parent) = config_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let config = serde_json::json!({
            "rpcEndpoint": endpoint
        });
        let _ = std::fs::write(&config_path, serde_json::to_string_pretty(&config).unwrap_or_default());
        log::info!("Config saved to {:?}", config_path);
    }
}

/// Load config from file on startup
fn load_config_file() -> Option<String> {
    if let Some(config_dir) = directories::ProjectDirs::from("com", "privacyrpc", "PrivacyRPC") {
        let config_path = config_dir.config_dir().join("config.json");
        if let Ok(content) = std::fs::read_to_string(&config_path) {
            if let Ok(config) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(endpoint) = config.get("rpcEndpoint").and_then(|v| v.as_str()) {
                    return Some(endpoint.to_string());
                }
            }
        }
    }
    None
}

#[tauri::command]
fn get_rpc_endpoint(state: State<'_, Arc<AppState>>) -> Option<String> {
    state.rpc_endpoint.lock().clone()
}

#[tauri::command]
async fn enable_tor(state: State<'_, Arc<AppState>>) -> Result<bool, String> {
    *state.tor_enabled.lock() = true;
    log::info!("Tor routing enabled");
    Ok(true)
}

#[tauri::command]
async fn disable_tor(state: State<'_, Arc<AppState>>) -> Result<bool, String> {
    *state.tor_enabled.lock() = false;
    *state.tor_connected.lock() = false;
    log::info!("Tor routing disabled");
    Ok(true)
}

#[tauri::command]
fn decode_tx(encoded_tx: String) -> Result<serde_json::Value, String> {
    match transaction_decoder::decode_transaction(&encoded_tx) {
        Ok(decoded) => serde_json::to_value(decoded).map_err(|e| e.to_string()),
        Err(e) => Err(e),
    }
}

#[tauri::command]
fn install_native_host() -> Result<String, String> {
    native_messaging::install_native_host().map_err(|e| e.to_string())
}

#[tauri::command]
fn uninstall_native_host() -> Result<(), String> {
    native_messaging::uninstall_native_host().map_err(|e| e.to_string())
}

fn main() {
    env_logger::init();

    // Check if launched for native messaging (Chrome passes extension ID as arg)
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 && args[1].starts_with("chrome-extension://") {
        // Running as native messaging host
        native_host::run_native_host();
        return;
    }

    // Check for --autostart flag (launched from extension)
    let autostart = args.iter().any(|a| a == "--autostart");

    // Single instance check - bind port 18899 as a lock
    let _instance_lock = match try_acquire_instance_lock() {
        Some(listener) => listener,
        None => {
            log::info!("PrivacyRPC already running, exiting duplicate");
            return;
        }
    };

    let state = Arc::new(AppState::default());

    // Load saved config on startup
    if let Some(endpoint) = load_config_file() {
        log::info!("Loaded saved RPC endpoint: {}", endpoint);
        *state.rpc_endpoint.lock() = Some(endpoint.clone());
        proxy::set_rpc_endpoint(Some(endpoint));
    }

    let state_clone = state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(state)
        .setup(move |app| {
            // Auto-start proxy if launched with --autostart flag
            if autostart {
                let state = state_clone.clone();
                tauri::async_runtime::spawn(async move {
                    log::info!("Auto-starting proxy (launched from extension)");
                    let port = *state.proxy_port.lock();
                    match proxy::start_proxy_server(port).await {
                        Ok(_) => {
                            *state.proxy_running.lock() = true;
                            *state.started_at.lock() = Some(Instant::now());
                            log::info!("Proxy auto-started on port {}", port);
                        }
                        Err(e) => log::error!("Failed to auto-start proxy: {}", e),
                    }
                });
            }

            // Create tray menu
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "Hide Window", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&show, &hide, &quit])?;

            // Create tray icon
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Hide window instead of closing
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            start_proxy,
            stop_proxy,
            get_status,
            set_port,
            set_rpc_endpoint,
            get_rpc_endpoint,
            enable_tor,
            disable_tor,
            install_native_host,
            uninstall_native_host,
            decode_tx,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
