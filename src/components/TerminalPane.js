import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { api } from '../lib/api.js';
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

const THEME = {
  background: '#1a1b23',
  foreground: '#d8dae5',
  cursor: '#c4a7ff',
  selectionBackground: '#4b4f6b',
  black: '#1a1b23',
  brightBlack: '#5c6078',
};

/**
 * Painel com cabeçalho e um terminal ligado a um PTY do backend.
 * spec: objeto PaneSpec aceito pelo comando Rust pty_spawn.
 * monitored: o status (círculo) e a reconexão ficam a cargo de um monitor externo (agentMonitor).
 * compactable: o painel roda o Claude Code e mostra o botão que envia /compact.
 * close: { title, icon } do botão de fechar (só aparece com onClose).
 * onToggleSpan('col' | 'row') e onResizeStart(event): tamanho do painel no grid.
 */
export function TerminalPane({
  ptyId,
  spec,
  title,
  badge,
  monitored = false,
  compactable = false,
  close = { title: 'Fechar terminal', icon: 'close' },
  onClose,
  onToggleMaximize,
  onToggleSpan,
  onResizeStart,
}) {
  const term = new Terminal({
    fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
    fontSize: 13,
    cursorBlink: true,
    scrollback: 10000,
    theme: THEME,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);

  let currentSpec = spec;
  let runId = 0;
  let started = false;
  let exited = false;
  let disposed = false;
  let lastSize = '';
  let startedAt = 0;
  let lastInputAt = 0;

  const status = h('span', { class: 'pane-status', title: 'Em execução' });
  const body = h('div', { class: 'pane-body' });
  const button = (name, label, onClick, extraClass = '') =>
    h('button', { class: `icon-btn ${extraClass}`.trim(), title: label, 'aria-label': label, onClick }, icon(name));
  const spanButtons = onToggleSpan && {
    col: button('spanCol', 'Largura dupla (ocupar 2 colunas)', () => onToggleSpan('col')),
    row: button('spanRow', 'Altura dupla (ocupar 2 linhas)', () => onToggleSpan('row')),
  };
  const actions = h(
    'div',
    { class: 'pane-actions' },
    compactable && button('compact', 'Compactar sessão (/compact)', () => compact()),
    button('restart', 'Reiniciar terminal', () => restart()),
    spanButtons?.col,
    spanButtons?.row,
    button('maximize', 'Maximizar / restaurar', () => onToggleMaximize?.()),
    onClose && button(close.icon, close.title, () => onClose(), 'danger'),
  );
  const header = h(
    'div',
    { class: 'pane-header', onDblClick: () => onToggleMaximize?.() },
    status,
    badge && h('span', { class: 'pane-badge' }, badge),
    h('span', { class: 'pane-title' }, title),
    actions,
  );
  const resizeHandle =
    onResizeStart &&
    h('div', { class: 'pane-resize', title: 'Arraste para ocupar 1 ou 2 células', onPointerDown: (event) => onResizeStart(event) });
  const el = h('section', { class: 'pane' }, header, body, resizeHandle);

  const setSpanState = (span) => {
    if (!spanButtons) return;
    spanButtons.col.classList.toggle('active', span.col > 1);
    spanButtons.row.classList.toggle('active', span.row > 1);
  };

  /** Envia /compact ao Claude Code. O Enter vai separado para não chegar como colagem. */
  function compact() {
    if (!started || exited) return;
    const run = runId;
    api
      .ptyWrite(ptyId, '/compact')
      .then(() => {
        setTimeout(() => {
          if (run === runId && !exited) api.ptyWrite(ptyId, '\r').catch(() => {});
        }, 150);
      })
      .catch(() => {});
    term.focus();
  }

  const setStatus = (state, label) => {
    status.dataset.state = state;
    status.title = label;
  };

  function start() {
    started = true;
    exited = false;
    const run = ++runId;
    startedAt = Date.now();
    if (monitored) setStatus('connecting', 'Conectando…');
    else setStatus('running', 'Em execução');
    const runSpec = currentSpec;
    // "Sessões novas" vale só para a primeira execução; reinícios retomam a sessão criada.
    if (currentSpec.fresh) currentSpec = { ...currentSpec, fresh: false };
    api
      .ptySpawn(ptyId, runSpec, term.cols, term.rows, (message) => {
        if (run !== runId || disposed) return;
        if (message.event === 'output') term.write(message.data);
        else if (message.event === 'exit') {
          exited = true;
          const code = message.data == null ? '' : ` (código ${message.data})`;
          if (monitored) {
            setStatus('disconnected', 'Desconectado');
            term.write(`\r\n\x1b[33m[agente desconectado${code}. Veja o status no círculo do painel]\x1b[0m\r\n`);
          } else {
            setStatus('exited', 'Encerrado');
            term.write(`\r\n\x1b[90m[processo encerrado${code}. Pressione Enter para reiniciar]\x1b[0m\r\n`);
          }
        }
      })
      .catch((error) => {
        if (run !== runId) return;
        exited = true;
        setStatus('error', 'Erro');
        term.write(`\x1b[31mNão foi possível iniciar o terminal: ${error}\x1b[0m\r\n`);
      });
  }

  function restart() {
    runId++;
    api.ptyKill(ptyId).catch(() => {});
    if (monitored) {
      // Mantém o histórico (inclusive o motivo da queda): só sai da tela alternativa e
      // faz um soft reset dos modos deixados pelo processo anterior.
      term.write('\x1b[?1049l\x1b[!p\r\n\x1b[90m──────── reconectando ────────\x1b[0m\r\n');
    } else {
      term.reset();
    }
    lastSize = '';
    start();
  }

  let resizeTimer = 0;
  function fitNow() {
    if (disposed) return;
    if (body.clientWidth < 20 || body.clientHeight < 20) {
      // Aba em segundo plano: inicia com o tamanho padrão e ajusta ao ficar visível.
      if (!started) start();
      return;
    }
    fit.fit();
    const size = `${term.cols}x${term.rows}`;
    if (!started) {
      lastSize = size;
      start();
    } else if (size !== lastSize && !exited) {
      lastSize = size;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!disposed && !exited) api.ptyResize(ptyId, term.cols, term.rows).catch(() => {});
      }, 60);
    }
  }

  let fitFrame = 0;
  const scheduleFit = () => {
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(fitNow);
  };
  const resizeObserver = new ResizeObserver(scheduleFit);

  term.onData((data) => {
    lastInputAt = Date.now();
    if (exited) {
      if (data === '\r') restart();
      return;
    }
    api.ptyWrite(ptyId, data).catch(() => {});
  });

  async function paste() {
    const text = await readText().catch(() => '');
    // Sem texto na área de transferência: repassa Ctrl+V para o Claude Code colar imagens.
    if (text) term.paste(text);
    else if (!exited) api.ptyWrite(ptyId, '\x16').catch(() => {});
  }

  function copySelection() {
    const text = term.getSelection();
    if (text) writeText(text).catch(() => {});
    term.clearSelection();
  }

  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown' || !event.ctrlKey || event.altKey) return true;
    const key = event.key.toLowerCase();
    if (key === 'c' && (event.shiftKey || term.hasSelection())) {
      event.preventDefault();
      copySelection();
      return false;
    }
    if (key === 'v') {
      event.preventDefault();
      paste();
      return false;
    }
    return true;
  });

  // Botão direito: copia a seleção ou cola (como no Windows Terminal).
  body.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (term.hasSelection()) copySelection();
    else paste();
  });

  return {
    el,
    mount() {
      term.open(body);
      resizeObserver.observe(body);
      scheduleFit();
    },
    focus: () => term.focus(),
    restart,
    compact,
    setStatus,
    setSpanState,
    /** Estado do processo para o monitor. */
    info: () => ({ started, exited, startedAt, lastInputAt }),
    refit: scheduleFit,
    dispose() {
      disposed = true;
      runId++;
      cancelAnimationFrame(fitFrame);
      clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      api.ptyKill(ptyId).catch(() => {});
      term.dispose();
      el.remove();
    },
  };
}
