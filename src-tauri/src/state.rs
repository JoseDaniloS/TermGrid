//! Persistência do estado do app (workspaces, abas abertas, layout) em JSON.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

fn state_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("state.json"))
}

pub fn load(app: &AppHandle) -> Result<Option<String>, String> {
    let file = state_file(app)?;
    match std::fs::read_to_string(&file) {
        Ok(json) if serde_json::from_str::<serde_json::Value>(&json).is_ok() => Ok(Some(json)),
        Ok(_) => {
            // Estado corrompido: guarda uma cópia antes que o próximo salvamento o substitua.
            let _ = std::fs::copy(&file, file.with_extension("json.bak"));
            Ok(None)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Grava em arquivo temporário e renomeia, para não corromper o estado.
pub fn save(app: &AppHandle, json: &str) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(json).map_err(|e| e.to_string())?;
    let file = state_file(app)?;
    let tmp = file.with_extension("json.tmp");
    {
        use std::io::Write;
        let mut out = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        out.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
        out.sync_all().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, &file).map_err(|e| e.to_string())
}
