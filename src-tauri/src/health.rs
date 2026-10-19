//! Saúde das sessões peer: o painel tem um `claude.exe` vivo registrado para mensagens entre sessões?
//!
//! O Claude Code registra cada sessão viva em `~/.claude/sessions/<PID>.<hash>.key`
//! (o arquivo some quando a sessão termina).

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneHealth {
    /// O processo do terminal (powershell) está vivo.
    pub alive: bool,
    /// PID do claude.exe encontrado na árvore de processos do terminal.
    pub claude_pid: Option<u32>,
    /// A sessão do claude está registrada (alcançável por ListAgents/SendMessage).
    pub peer: bool,
}

struct Process {
    parent: u32,
    name: String,
}

#[cfg(windows)]
fn snapshot() -> HashMap<u32, Process> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };

    let mut processes = HashMap::new();
    // SAFETY: chamadas Win32 com handle verificado e estrutura inicializada com dwSize.
    unsafe {
        let handle = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if handle == INVALID_HANDLE_VALUE {
            return processes;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut ok = Process32FirstW(handle, &mut entry) != 0;
        while ok {
            let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            processes.insert(
                entry.th32ProcessID,
                Process {
                    parent: entry.th32ParentProcessID,
                    name: String::from_utf16_lossy(&entry.szExeFile[..len]).to_lowercase(),
                },
            );
            ok = Process32NextW(handle, &mut entry) != 0;
        }
        CloseHandle(handle);
    }
    processes
}

#[cfg(not(windows))]
fn snapshot() -> HashMap<u32, Process> {
    HashMap::new()
}

/// PIDs com sessão registrada em ~/.claude/sessions.
fn registered_pids() -> HashSet<u32> {
    let Some(dir) = std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join(".claude").join("sessions")) else {
        return HashSet::new();
    };
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|e| e.file_name().to_string_lossy().split('.').next()?.parse().ok())
                .collect()
        })
        .unwrap_or_default()
}

/// Avalia um terminal: procura os claude.exe descendentes de `root` (em largura, os mais
/// próximos primeiro). Um claude pode ter vários claude.exe filhos; a sessão é peer se
/// qualquer um deles estiver registrado.
fn analyze(
    root: Option<u32>,
    processes: &HashMap<u32, Process>,
    children: &HashMap<u32, Vec<u32>>,
    registered: &HashSet<u32>,
) -> PaneHealth {
    let alive = root.is_some_and(|pid| processes.contains_key(&pid));
    let mut found = Vec::new();
    if let (true, Some(root)) = (alive, root) {
        let mut queue = VecDeque::from([root]);
        let mut seen = HashSet::new();
        while let Some(pid) = queue.pop_front() {
            if !seen.insert(pid) {
                continue;
            }
            for &child in children.get(&pid).into_iter().flatten() {
                if processes.get(&child).is_some_and(|p| p.name == "claude.exe") {
                    found.push(child);
                }
                queue.push_back(child);
            }
        }
    }
    let registered_pid = found.iter().copied().find(|pid| registered.contains(pid));
    PaneHealth {
        alive,
        claude_pid: registered_pid.or_else(|| found.first().copied()),
        peer: registered_pid.is_some(),
    }
}

fn children_of(processes: &HashMap<u32, Process>) -> HashMap<u32, Vec<u32>> {
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for (&pid, process) in processes {
        // O Windows reaproveita PIDs: ignora "pais" que são o próprio processo.
        if process.parent != pid {
            children.entry(process.parent).or_default().push(pid);
        }
    }
    children
}

pub fn check(roots: Vec<(String, Option<u32>)>) -> HashMap<String, PaneHealth> {
    let processes = snapshot();
    let registered = registered_pids();
    let children = children_of(&processes);
    roots
        .into_iter()
        .map(|(id, root)| (id, analyze(root, &processes, &children, &registered)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree(entries: &[(u32, u32, &str)]) -> HashMap<u32, Process> {
        entries
            .iter()
            .map(|&(pid, parent, name)| (pid, Process { parent, name: name.into() }))
            .collect()
    }

    #[test]
    fn finds_registered_claude_among_many() {
        // powershell(10) -> claude(20) -> claude(30), claude(31); só o 20 registrado.
        let processes = tree(&[
            (10, 1, "powershell.exe"),
            (20, 10, "claude.exe"),
            (30, 20, "claude.exe"),
            (31, 20, "claude.exe"),
        ]);
        let health = analyze(Some(10), &processes, &children_of(&processes), &HashSet::from([20]));
        assert!(health.alive && health.peer);
        assert_eq!(health.claude_pid, Some(20));

        // Registrado é um filho: ainda é peer.
        let health = analyze(Some(10), &processes, &children_of(&processes), &HashSet::from([31]));
        assert!(health.peer);
        assert_eq!(health.claude_pid, Some(31));
    }

    #[test]
    fn claude_missing_or_not_registered() {
        let processes = tree(&[(10, 1, "powershell.exe"), (20, 10, "claude.exe")]);
        let health = analyze(Some(10), &processes, &children_of(&processes), &HashSet::new());
        assert!(health.alive && !health.peer);
        assert_eq!(health.claude_pid, Some(20));

        let only_shell = tree(&[(10, 1, "powershell.exe")]);
        let health = analyze(Some(10), &only_shell, &children_of(&only_shell), &HashSet::new());
        assert!(health.alive && health.claude_pid.is_none());

        let health = analyze(Some(99), &only_shell, &children_of(&only_shell), &HashSet::new());
        assert!(!health.alive);
    }

    #[test]
    fn survives_parent_cycles() {
        // PIDs reaproveitados podem formar ciclos de "pais".
        let processes = tree(&[(10, 20, "powershell.exe"), (20, 10, "conhost.exe")]);
        let health = analyze(Some(10), &processes, &children_of(&processes), &HashSet::new());
        assert!(health.alive && health.claude_pid.is_none());
    }
}
