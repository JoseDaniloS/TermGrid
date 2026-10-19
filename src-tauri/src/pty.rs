//! Gerenciamento dos pseudo-terminais (ConPTY via portable-pty).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::ipc::Channel;

/// Eventos enviados ao frontend pelo canal de cada terminal.
#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum PtyEvent {
    Output(String),
    Exit(Option<u32>),
}

struct PtySession {
    generation: u64,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    pid: Option<u32>,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
    next_generation: AtomicU64,
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(2),
        cols: cols.max(10),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

impl PtyManager {
    pub fn spawn(
        &self,
        id: String,
        cmd: CommandBuilder,
        cols: u16,
        rows: u16,
        on_event: Channel<PtyEvent>,
    ) -> Result<(), String> {
        // Reiniciar um terminal reaproveita o mesmo id: encerra o anterior.
        self.kill(&id);

        let pair = native_pty_system().openpty(size(cols, rows)).map_err(err)?;
        // Leitor e escritor antes do processo: uma falha aqui não deixa filho órfão.
        let reader = pair.master.try_clone_reader().map_err(err)?;
        let writer = pair.master.take_writer().map_err(err)?;
        let mut child = pair.slave.spawn_command(cmd).map_err(err)?;
        drop(pair.slave);
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
        let exit_code = Arc::new(Mutex::new(None));

        self.sessions.lock().unwrap().insert(
            id.clone(),
            PtySession {
                generation,
                master: pair.master,
                writer,
                killer: child.clone_killer(),
                pid: child.process_id(),
            },
        );

        // Leitura da saída. O evento de saída do processo é enviado só no EOF,
        // garantindo que chegue depois de toda a saída.
        let code_slot = exit_code.clone();
        thread::spawn(move || read_loop(reader, on_event, code_slot));

        // Ao terminar o processo, remove a sessão; isso fecha o ConPTY e
        // libera o EOF para a thread de leitura.
        let sessions = self.sessions.clone();
        thread::spawn(move || {
            let code = child.wait().ok().map(|s| s.exit_code());
            *exit_code.lock().unwrap() = code;
            let mut map = sessions.lock().unwrap();
            if map.get(&id).is_some_and(|s| s.generation == generation) {
                let session = map.remove(&id);
                drop(map);
                drop(session);
            }
        });

        Ok(())
    }

    pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
        let mut map = self.sessions.lock().unwrap();
        let session = map.get_mut(id).ok_or("terminal não encontrado")?;
        session.writer.write_all(data.as_bytes()).map_err(err)?;
        session.writer.flush().map_err(err)
    }

    /// PID do processo raiz de cada terminal (None se não estiver rodando).
    pub fn pids(&self, ids: Vec<String>) -> Vec<(String, Option<u32>)> {
        let map = self.sessions.lock().unwrap();
        ids.into_iter()
            .map(|id| {
                let pid = map.get(&id).and_then(|s| s.pid);
                (id, pid)
            })
            .collect()
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let map = self.sessions.lock().unwrap();
        let session = map.get(id).ok_or("terminal não encontrado")?;
        session.master.resize(size(cols, rows)).map_err(err)
    }

    /// Encerra em segundo plano: o taskkill é lento e os comandos rodam na thread da UI.
    pub fn kill(&self, id: &str) {
        let session = self.sessions.lock().unwrap().remove(id);
        if let Some(session) = session {
            thread::spawn(move || terminate(session));
        }
    }

    /// Usado na saída do app: encerra todos em paralelo e espera terminar.
    pub fn kill_all(&self) {
        let sessions: Vec<_> = self.sessions.lock().unwrap().drain().map(|(_, s)| s).collect();
        let handles: Vec<_> = sessions
            .into_iter()
            .map(|session| thread::spawn(move || terminate(session)))
            .collect();
        for handle in handles {
            let _ = handle.join();
        }
    }
}

/// Encerra a árvore de processos (powershell -> claude -> ...) e fecha o PTY.
fn terminate(mut session: PtySession) {
    #[cfg(windows)]
    if let Some(pid) = session.pid {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = std::process::Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    let _ = session.killer.kill();
}

fn read_loop(
    mut reader: Box<dyn Read + Send>,
    on_event: Channel<PtyEvent>,
    exit_code: Arc<Mutex<Option<u32>>>,
) {
    let mut buf = [0u8; 16 * 1024];
    let mut pending: Vec<u8> = Vec::new();
    loop {
        match reader.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                pending.extend_from_slice(&buf[..n]);
                let text = decode_utf8(&mut pending);
                if !text.is_empty() && on_event.send(PtyEvent::Output(text)).is_err() {
                    break;
                }
            }
        }
    }
    if !pending.is_empty() {
        let _ = on_event.send(PtyEvent::Output(String::from_utf8_lossy(&pending).into_owned()));
    }
    let code = *exit_code.lock().unwrap();
    let _ = on_event.send(PtyEvent::Exit(code));
}

/// Decodifica o máximo possível de `pending`, mantendo nele uma sequência
/// UTF-8 incompleta no final (que será completada na próxima leitura).
fn decode_utf8(pending: &mut Vec<u8>) -> String {
    let mut out = String::new();
    loop {
        let (valid, invalid_len) = match std::str::from_utf8(pending) {
            Ok(_) => (pending.len(), None),
            Err(e) => (e.valid_up_to(), Some(e.error_len())),
        };
        // `valid` bytes são UTF-8 válido por definição.
        out.push_str(std::str::from_utf8(&pending[..valid]).unwrap_or_default());
        match invalid_len {
            None => {
                pending.clear();
                return out;
            }
            Some(Some(len)) => {
                out.push('\u{FFFD}');
                pending.drain(..valid + len);
            }
            Some(None) => {
                pending.drain(..valid);
                return out;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::decode_utf8;

    #[test]
    fn keeps_incomplete_sequence() {
        let bytes = "ação".as_bytes();
        let mut pending = bytes[..2].to_vec(); // "a" + 1º byte de "ç"
        assert_eq!(decode_utf8(&mut pending), "a");
        assert_eq!(pending.len(), 1);
        pending.extend_from_slice(&bytes[2..]);
        assert_eq!(decode_utf8(&mut pending), "ção");
        assert!(pending.is_empty());
    }

    #[test]
    fn replaces_invalid_bytes() {
        let mut pending = vec![b'a', 0xff, b'b'];
        assert_eq!(decode_utf8(&mut pending), "a\u{FFFD}b");
        assert!(pending.is_empty());
    }
}
