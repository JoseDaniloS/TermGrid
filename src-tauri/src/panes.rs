//! Tradução do tipo de painel pedido pelo frontend em um comando de terminal.

use std::path::{Path, PathBuf};

use portable_pty::CommandBuilder;
use serde::Deserialize;

use crate::agents::{self, is_safe_name};

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum PaneSpec {
    /// Sessão de um agente, aberta pelo IniciarSessoes.ps1 da pasta AgentesClaude.
    Agent {
        role: String,
        agents_dir: String,
        folder: String,
        fresh: bool,
    },
    /// PowerShell simples na pasta do workspace.
    Powershell { folder: String },
    /// Claude Code avulso, com sessão própria que é retomada ao reabrir.
    Claude { folder: String, session_id: String },
    /// Bash do WSL (distro padrão) na pasta do workspace.
    Wsl { folder: String },
}

fn existing_dir(folder: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(folder);
    if path.is_dir() {
        Ok(path)
    } else {
        Err(format!("pasta não encontrada: {folder}"))
    }
}

fn shell(program: impl AsRef<std::ffi::OsStr>, cwd: &Path) -> CommandBuilder {
    let mut cmd = CommandBuilder::new(program);
    cmd.cwd(cwd);
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "TermGrid");
    cmd
}

fn powershell(cwd: &Path) -> CommandBuilder {
    let mut cmd = shell("powershell.exe", cwd);
    cmd.arg("-NoLogo");
    cmd
}

impl PaneSpec {
    pub fn into_command(self) -> Result<CommandBuilder, String> {
        match self {
            PaneSpec::Agent { role, agents_dir, folder, fresh } => {
                if !is_safe_name(&role) {
                    return Err(format!("nome de agente inválido: {role}"));
                }
                let cwd = existing_dir(&folder)?;
                let script = agents::sessions_script(Path::new(&agents_dir))?;
                let mut cmd = powershell(&cwd);
                cmd.args(["-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]);
                cmd.arg(script);
                cmd.args(["-Papel", role.as_str(), "-Pasta"]);
                cmd.arg(&cwd);
                if fresh {
                    cmd.arg("-Nova");
                }
                Ok(cmd)
            }
            PaneSpec::Powershell { folder } => Ok(powershell(&existing_dir(&folder)?)),
            PaneSpec::Wsl { folder } => {
                let cwd = existing_dir(&folder)?;
                let mut cmd = shell("wsl.exe", &cwd);
                // O wsl converte o caminho do Windows para /mnt/<drive>/...
                cmd.arg("--cd");
                cmd.arg(&cwd);
                Ok(cmd)
            }
            PaneSpec::Claude { folder, session_id } => {
                if !is_safe_name(&session_id) {
                    return Err("id de sessão inválido".into());
                }
                let cwd = existing_dir(&folder)?;
                let flag = if agents::claude_session_exists(&session_id) {
                    "--resume"
                } else {
                    "--session-id"
                };
                let mut cmd = powershell(&cwd);
                cmd.args(["-NoExit", "-Command", &format!("claude {flag} {session_id}")]);
                Ok(cmd)
            }
        }
    }
}
