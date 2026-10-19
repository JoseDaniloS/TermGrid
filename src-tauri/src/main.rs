#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agents;
mod health;
mod mcp;
mod panes;
mod pty;
mod state;
mod usage;

use std::path::Path;

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, RunEvent, State};

use panes::PaneSpec;
use pty::{PtyEvent, PtyManager};

#[tauri::command]
fn pty_spawn(
    ptys: State<'_, PtyManager>,
    id: String,
    spec: PaneSpec,
    cols: u16,
    rows: u16,
    on_event: Channel<PtyEvent>,
) -> Result<(), String> {
    ptys.spawn(id, spec.into_command()?, cols, rows, on_event)
}

#[tauri::command]
fn pty_write(ptys: State<'_, PtyManager>, id: String, data: String) -> Result<(), String> {
    ptys.write(&id, &data)
}

#[tauri::command]
fn pty_resize(ptys: State<'_, PtyManager>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    ptys.resize(&id, cols, rows)
}

#[tauri::command]
fn pty_kill(ptys: State<'_, PtyManager>, id: String) {
    ptys.kill(&id)
}

/// async: varre a lista de processos fora da thread da UI.
#[tauri::command(async)]
fn pty_health(
    ptys: State<'_, PtyManager>,
    ids: Vec<String>,
) -> std::collections::HashMap<String, health::PaneHealth> {
    health::check(ptys.pids(ids))
}

#[tauri::command]
fn load_state(app: AppHandle) -> Result<Option<String>, String> {
    state::load(&app)
}

#[tauri::command]
fn save_state(app: AppHandle, json: String) -> Result<(), String> {
    state::save(&app, &json)
}

/// Pasta AgentesClaude do usuário ou, se não houver, o kit embutido no instalador.
#[tauri::command]
fn default_agents_dir(app: AppHandle) -> Option<String> {
    agents::default_agents_dir().or_else(|| {
        let resources = app.path().resource_dir().ok()?;
        let data = app.path().app_data_dir().ok()?;
        agents::bundled_agents_dir(&resources, &data)
    })
}

#[tauri::command]
fn list_agent_roles(dir: String) -> Result<Vec<String>, String> {
    agents::list_agent_roles(Path::new(&dir))
}

#[tauri::command]
fn mcp_configured(folder: String) -> Vec<mcp::McpServer> {
    mcp::configured(&folder)
}

/// async: roda fora da thread da UI (o claude leva alguns segundos para checar os servidores).
#[tauri::command(async)]
fn mcp_status(folder: String) -> Result<Vec<mcp::McpStatus>, String> {
    mcp::status(&folder)
}

#[tauri::command]
async fn plan_usage() -> Result<serde_json::Value, String> {
    usage::fetch().await
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(PtyManager::default())
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            pty_health,
            load_state,
            save_state,
            default_agents_dir,
            list_agent_roles,
            mcp_configured,
            mcp_status,
            plan_usage,
        ])
        .build(tauri::generate_context!())
        .expect("falha ao iniciar o TermGrid")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<PtyManager>().kill_all();
            }
        });
}
