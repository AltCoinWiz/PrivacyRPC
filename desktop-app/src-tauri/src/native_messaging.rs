use directories::ProjectDirs;
use std::fs;
use std::path::PathBuf;
use thiserror::Error;

// Extension ID - update this after publishing to Chrome Web Store
// For development, we also allow all extensions with "*"
const EXTENSION_ID: &str = "fboajdepoolkoloabfbmcjlmonmflndf";
const HOST_NAME: &str = "com.privacyrpc.host";

#[derive(Error, Debug)]
pub enum NativeMessagingError {
    #[error("Failed to find app directory")]
    NoAppDir,
    #[error("Failed to get executable path")]
    NoExePath,
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Registry error: {0}")]
    Registry(String),
}

/// Get the path to the native messaging host manifest
fn get_manifest_path() -> Result<PathBuf, NativeMessagingError> {
    #[cfg(target_os = "windows")]
    {
        let app_data = std::env::var("LOCALAPPDATA")
            .map_err(|_| NativeMessagingError::NoAppDir)?;
        Ok(PathBuf::from(app_data)
            .join("PrivacyRPC")
            .join("native-messaging")
            .join(format!("{}.json", HOST_NAME)))
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME")
            .map_err(|_| NativeMessagingError::NoAppDir)?;
        Ok(PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("Google")
            .join("Chrome")
            .join("NativeMessagingHosts")
            .join(format!("{}.json", HOST_NAME)))
    }

    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME")
            .map_err(|_| NativeMessagingError::NoAppDir)?;
        Ok(PathBuf::from(home)
            .join(".config")
            .join("google-chrome")
            .join("NativeMessagingHosts")
            .join(format!("{}.json", HOST_NAME)))
    }
}

/// Get the current executable path
fn get_exe_path() -> Result<PathBuf, NativeMessagingError> {
    std::env::current_exe()
        .map_err(|_| NativeMessagingError::NoExePath)
}

/// Generate the native messaging host manifest JSON
fn generate_manifest(exe_path: &PathBuf) -> String {
    let exe_path_str = exe_path.to_string_lossy().replace("\\", "\\\\");

    format!(
        r#"{{
  "name": "{}",
  "description": "PrivacyRPC Native Messaging Host",
  "path": "{}",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://{}/"
  ]
}}"#,
        HOST_NAME, exe_path_str, EXTENSION_ID
    )
}

/// Install the native messaging host
pub fn install_native_host() -> Result<String, NativeMessagingError> {
    let manifest_path = get_manifest_path()?;
    let exe_path = get_exe_path()?;

    // Create parent directories
    if let Some(parent) = manifest_path.parent() {
        fs::create_dir_all(parent)?;
    }

    // Write manifest
    let manifest = generate_manifest(&exe_path);
    fs::write(&manifest_path, &manifest)?;

    // On Windows, we also need to add a registry entry
    #[cfg(target_os = "windows")]
    {
        install_windows_registry(&manifest_path)?;
    }

    log::info!("Native messaging host installed at {:?}", manifest_path);
    Ok(manifest_path.to_string_lossy().to_string())
}

/// Uninstall the native messaging host
pub fn uninstall_native_host() -> Result<(), NativeMessagingError> {
    let manifest_path = get_manifest_path()?;

    if manifest_path.exists() {
        fs::remove_file(&manifest_path)?;
    }

    // On Windows, remove registry entry
    #[cfg(target_os = "windows")]
    {
        uninstall_windows_registry()?;
    }

    log::info!("Native messaging host uninstalled");
    Ok(())
}

#[cfg(target_os = "windows")]
fn install_windows_registry(manifest_path: &PathBuf) -> Result<(), NativeMessagingError> {
    use std::process::Command;

    let key_path = format!(
        "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\{}",
        HOST_NAME
    );

    let manifest_path_str = manifest_path.to_string_lossy();

    // Use reg.exe to add the registry key
    let output = Command::new("reg")
        .args([
            "add",
            &key_path,
            "/ve",
            "/t",
            "REG_SZ",
            "/d",
            &manifest_path_str,
            "/f",
        ])
        .output()
        .map_err(|e| NativeMessagingError::Registry(e.to_string()))?;

    if !output.status.success() {
        return Err(NativeMessagingError::Registry(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn uninstall_windows_registry() -> Result<(), NativeMessagingError> {
    use std::process::Command;

    let key_path = format!(
        "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\{}",
        HOST_NAME
    );

    // Use reg.exe to delete the registry key
    let _ = Command::new("reg")
        .args(["delete", &key_path, "/f"])
        .output();

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn install_windows_registry(_: &PathBuf) -> Result<(), NativeMessagingError> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn uninstall_windows_registry() -> Result<(), NativeMessagingError> {
    Ok(())
}
