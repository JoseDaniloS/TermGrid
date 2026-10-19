//! Integração com a pasta AgentesClaude e com as sessões salvas do Claude Code.

use std::path::{Path, PathBuf};

const SESSIONS_SCRIPT: &str = "IniciarSessoes.ps1";

/// Nomes aceitos como papel/id de sessão: viram argumentos de linha de comando.
pub fn is_safe_name(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('-')
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").map(PathBuf::from)
}

/// Procura a pasta AgentesClaude nas áreas de trabalho do usuário.
pub fn default_agents_dir() -> Option<String> {
    let home = home()?;
    [
        home.join("OneDrive").join("Desktop"),
        home.join("OneDrive").join("Área de Trabalho"),
        home.join("Desktop"),
    ]
    .into_iter()
    .map(|desktop| desktop.join("AgentesClaude"))
    .find(|dir| dir.join(SESSIONS_SCRIPT).is_file())
    .map(|dir| dir.to_string_lossy().into_owned())
}

/// Kit de agentes embutido no instalador (examples/AgentesClaude). Na primeira
/// execução é copiado para a pasta de dados do app, que é gravável (o script
/// guarda os IDs das sessões em `sessoes\`).
pub fn bundled_agents_dir(resource_dir: &Path, data_dir: &Path) -> Option<String> {
    let target = data_dir.join("AgentesClaude");
    if !target.exists() {
        // Copia para uma pasta temporária e renomeia no fim: uma cópia interrompida
        // não deixa um kit pela metade que pareça completo.
        let source = resource_dir.join("AgentesClaude");
        if !source.join(SESSIONS_SCRIPT).is_file() {
            return None;
        }
        let tmp = data_dir.join("AgentesClaude.tmp");
        let _ = std::fs::remove_dir_all(&tmp);
        copy_dir(&source, &tmp).ok()?;
        std::fs::rename(&tmp, &target).ok()?;
    }
    target
        .join(SESSIONS_SCRIPT)
        .is_file()
        .then(|| target.to_string_lossy().into_owned())
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let dest = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &dest)?;
        } else {
            std::fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}

pub fn sessions_script(agents_dir: &Path) -> Result<PathBuf, String> {
    let script = agents_dir.join(SESSIONS_SCRIPT);
    if script.is_file() {
        Ok(script)
    } else {
        Err(format!("{SESSIONS_SCRIPT} não encontrado em {}", agents_dir.display()))
    }
}

/// Papéis na mesma ordem usada pelo IniciarSessoes.ps1:
/// o orquestrador seguido das subpastas de `agentes\subagentes`.
pub fn list_agent_roles(agents_dir: &Path) -> Result<Vec<String>, String> {
    sessions_script(agents_dir)?;
    let agentes = agents_dir.join("agentes");
    if !agentes.join("orquestrador").is_dir() {
        return Err(format!("pasta agentes\\orquestrador não encontrada em {}", agents_dir.display()));
    }
    let mut workers: Vec<String> = std::fs::read_dir(agentes.join("subagentes"))
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| e.path().is_dir())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|name| is_safe_name(name))
                .collect()
        })
        .unwrap_or_default();
    workers.sort_by_key(|name| name.to_lowercase());

    let mut roles = vec!["orquestrador".to_string()];
    roles.extend(workers);
    Ok(roles)
}

/// Verifica se existe `~/.claude/projects/*/<id>.jsonl` (sessão retomável).
pub fn claude_session_exists(session_id: &str) -> bool {
    let Some(projects) = home().map(|h| h.join(".claude").join("projects")) else {
        return false;
    };
    let file_name = format!("{session_id}.jsonl");
    std::fs::read_dir(projects)
        .map(|entries| entries.flatten().any(|e| e.path().join(&file_name).is_file()))
        .unwrap_or(false)
}
