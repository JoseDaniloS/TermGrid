//! Servidores MCP do Claude Code: escopos lidos das configurações e status via `claude mcp list`.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

const STATUS_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Serialize)]
pub struct McpServer {
    name: String,
    /// "global" (~/.claude.json), "local" (~/.claude.json > projects) ou "project" (.mcp.json).
    scope: &'static str,
    transport: String,
    target: String,
}

#[derive(Serialize)]
pub struct McpStatus {
    name: String,
    target: String,
    status: String,
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn normalize(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// Só tipo e destino de cada servidor: env e headers podem conter segredos.
fn servers(config: &Value, scope: &'static str) -> Vec<McpServer> {
    let Some(map) = config.get("mcpServers").and_then(Value::as_object) else {
        return Vec::new();
    };
    map.iter()
        .map(|(name, server)| {
            let command = server["command"].as_str();
            let transport = server["type"]
                .as_str()
                .unwrap_or(if command.is_some() { "stdio" } else { "?" })
                .to_string();
            let target = match (server["url"].as_str(), command) {
                (Some(url), _) => url.to_string(),
                (None, Some(command)) => {
                    let args: Vec<&str> = server["args"]
                        .as_array()
                        .map(|a| a.iter().filter_map(Value::as_str).collect())
                        .unwrap_or_default();
                    std::iter::once(command).chain(args).collect::<Vec<_>>().join(" ")
                }
                _ => String::new(),
            };
            McpServer { name: name.clone(), scope, transport, target }
        })
        .collect()
}

pub fn configured(folder: &str) -> Vec<McpServer> {
    let mut result = Vec::new();
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
    if let Some(user_config) = home.and_then(|h| read_json(&h.join(".claude.json"))) {
        result.extend(servers(&user_config, "global"));
        let wanted = normalize(folder);
        let project = user_config["projects"]
            .as_object()
            .and_then(|projects| projects.iter().find(|(key, _)| normalize(key) == wanted))
            .map(|(_, value)| value);
        if let Some(project) = project {
            result.extend(servers(project, "local"));
        }
    }
    if let Some(project_file) = read_json(&Path::new(folder).join(".mcp.json")) {
        result.extend(servers(&project_file, "project"));
    }
    result
}

/// Executa `claude mcp list` na pasta (verifica a conexão de cada servidor; leva alguns segundos).
pub fn status(folder: &str) -> Result<Vec<McpStatus>, String> {
    let mut cmd = std::process::Command::new("claude");
    cmd.args(["mcp", "list"]).current_dir(folder);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    use std::io::Read;
    use std::process::Stdio;
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("não foi possível executar o claude: {e}"))?;

    // Lê as saídas em threads para o pipe não encher enquanto esperamos o processo.
    let stdout = child.stdout.take().ok_or("sem saída do claude")?;
    let stderr = child.stderr.take().ok_or("sem saída do claude")?;
    // Canais em vez de join: um servidor MCP filho que herde o pipe não pode travar a leitura.
    let read_all = |mut source: Box<dyn Read + Send>| {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = source.read_to_end(&mut buf);
            let _ = tx.send(buf);
        });
        rx
    };
    let out_rx = read_all(Box::new(stdout));
    let err_rx = read_all(Box::new(stderr));

    // Um servidor MCP travado não pode prender o painel para sempre.
    let deadline = Instant::now() + STATUS_TIMEOUT;
    let exit = loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(exit) => break exit,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("o claude mcp list não respondeu em {} s", STATUS_TIMEOUT.as_secs()));
            }
            None => std::thread::sleep(Duration::from_millis(100)),
        }
    };

    let stdout = out_rx.recv_timeout(Duration::from_secs(5)).unwrap_or_default();
    let stderr = err_rx.recv_timeout(Duration::from_secs(1)).unwrap_or_default();
    let list: Vec<McpStatus> = String::from_utf8_lossy(&stdout).lines().filter_map(parse_status_line).collect();
    if list.is_empty() && !exit.success() {
        return Err(String::from_utf8_lossy(&stderr).trim().to_string());
    }
    Ok(list)
}

/// Formato: "<nome>: <destino> - <símbolo> <status>".
fn parse_status_line(line: &str) -> Option<McpStatus> {
    let (left, status) = line.rsplit_once(" - ")?;
    // Servidor sem destino vem como "... (HTTP) - - Not configured".
    let left = left.trim_end().trim_end_matches(" -");
    let (name, target) = left.split_once(": ")?;
    let status = status
        .trim()
        .trim_start_matches(|c: char| !c.is_alphanumeric())
        .trim()
        .to_string();
    Some(McpStatus {
        name: name.trim().to_string(),
        target: target.trim().trim_end_matches("(HTTP)").trim().to_string(),
        status,
    })
}

#[cfg(test)]
mod tests {
    use super::parse_status_line;

    #[test]
    fn parses_mcp_list_lines() {
        let s = parse_status_line("plugin:design:slack: https://mcp.slack.com/mcp (HTTP) - ! Needs authentication").unwrap();
        assert_eq!(s.name, "plugin:design:slack");
        assert_eq!(s.target, "https://mcp.slack.com/mcp");
        assert_eq!(s.status, "Needs authentication");

        let s = parse_status_line("claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected").unwrap();
        assert_eq!(s.name, "claude.ai Gmail");
        assert_eq!(s.status, "Connected");

        let s = parse_status_line("plugin:design:gmail:  (HTTP) - - Not configured").unwrap();
        assert_eq!(s.name, "plugin:design:gmail");
        assert_eq!(s.target, "");
        assert_eq!(s.status, "Not configured");

        assert!(parse_status_line("Checking MCP server health…").is_none());
    }
}
