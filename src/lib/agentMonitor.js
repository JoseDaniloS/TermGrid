import { api } from './api.js';

const POLL_MS = 4000;
/** Tempo para o claude subir e registrar a sessão peer antes de contar como problema. */
const STARTUP_GRACE_MS = 45_000;
/** Logo após (re)iniciar o terminal, o PTY ainda pode não existir no backend. */
const SPAWN_GRACE_MS = 3_000;
/** Polls seguidos sem claude no terminal antes de relançar (~20 s). */
const MISSING_POLLS_BEFORE_RELAUNCH = 5;
/** Não relança o claude enquanto o usuário estiver digitando no painel. */
const RECENT_INPUT_MS = 30_000;
const BACKOFF_MS = [5_000, 15_000, 30_000, 60_000];
/** Depois disso para de tentar sozinho e pede ação do usuário (↻). */
const MAX_ATTEMPTS = 6;

/**
 * Mantém as sessões peer dos agentes conectadas e reflete o estado no círculo do painel:
 * verde = claude vivo e registrado para mensagens entre sessões; amarelo = conectando ou
 * vivo sem registro; vermelho = desconectado.
 *
 * Só reinicia o painel quando o terminal morreu ou quando o claude não está mais rodando
 * nele (e o usuário não está digitando). Um claude vivo nunca é encerrado pelo monitor.
 * O IniciarSessoes.ps1 retoma a mesma sessão com --resume.
 */
export function createAgentMonitor() {
  const entries = new Map(); // ptyId -> { pane, missing, attempts, lastReconnect }
  let timer = null;
  let polling = false;

  function relaunch(entry, reason) {
    if (entry.attempts >= MAX_ATTEMPTS) {
      entry.pane.setStatus('disconnected', `Desconectado: ${reason}. Reconexão automática esgotada; clique em ↻`);
      return;
    }
    const wait = BACKOFF_MS[Math.min(entry.attempts, BACKOFF_MS.length - 1)];
    const since = Date.now() - entry.lastReconnect;
    if (since < wait) {
      const seconds = Math.ceil((wait - since) / 1000);
      entry.pane.setStatus('disconnected', `Desconectado: ${reason}. Reconectando em ${seconds} s`);
      return;
    }
    entry.attempts++;
    entry.missing = 0;
    entry.lastReconnect = Date.now();
    entry.pane.restart();
    entry.pane.setStatus('reconnecting', `Reconectando (tentativa ${entry.attempts} de ${MAX_ATTEMPTS})…`);
  }

  function apply(entry, health, pollStartedAt) {
    const { started, exited, startedAt, lastInputAt } = entry.pane.info();
    // Reiniciado (↻ manual ou monitor) durante a consulta: o resultado é do processo antigo.
    if (!started || startedAt >= pollStartedAt - 50) return;
    const age = Date.now() - startedAt;
    // Reinício manual (↻ ou Enter) libera novas tentativas automáticas.
    if (startedAt > entry.lastReconnect + 1000) entry.attempts = 0;

    if (exited || !health?.alive) {
      if (age < SPAWN_GRACE_MS && !exited) return;
      relaunch(entry, 'terminal encerrado');
      return;
    }
    if (health.peer) {
      entry.missing = 0;
      entry.attempts = 0;
      entry.pane.setStatus('running', `Conectado · sessão peer ativa (claude PID ${health.claudePid})`);
      return;
    }
    if (age < STARTUP_GRACE_MS) {
      entry.pane.setStatus(entry.attempts ? 'reconnecting' : 'connecting', 'Conectando…');
      return;
    }
    if (health.claudePid) {
      // Vivo mas não alcançável para mensagens: só sinaliza, nunca derruba a sessão.
      entry.missing = 0;
      entry.attempts = 0;
      entry.pane.setStatus('connecting', `Claude ativo (PID ${health.claudePid}), mas a sessão peer não está registrada`);
      return;
    }
    entry.missing++;
    const typing = Date.now() - lastInputAt < RECENT_INPUT_MS;
    if (entry.missing >= MISSING_POLLS_BEFORE_RELAUNCH && !typing) relaunch(entry, 'claude não está em execução');
    else entry.pane.setStatus('disconnected', 'Desconectado: claude não está em execução');
  }

  async function poll() {
    if (polling || entries.size === 0) return;
    polling = true;
    const pollStartedAt = Date.now();
    try {
      const ids = [...entries.keys()];
      const result = await api.ptyHealth(ids);
      for (const id of ids) {
        const entry = entries.get(id);
        if (entry) apply(entry, result[id], pollStartedAt);
      }
    } catch (error) {
      console.error('Falha ao verificar as sessões dos agentes', error);
    } finally {
      polling = false;
    }
  }

  return {
    register(ptyId, pane) {
      entries.set(ptyId, { pane, missing: 0, attempts: 0, lastReconnect: 0 });
      timer ??= setInterval(poll, POLL_MS);
    },
    unregister(ptyId) {
      entries.delete(ptyId);
    },
    dispose() {
      clearInterval(timer);
      timer = null;
      entries.clear();
    },
  };
}
