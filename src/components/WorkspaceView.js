import { ask } from '@tauri-apps/plugin-dialog';
import { api } from '../lib/api.js';
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { TerminalGrid } from './TerminalGrid.js';
import { TerminalPane } from './TerminalPane.js';
import { McpPanel } from './McpPanel.js';
import { createAgentMonitor } from '../lib/agentMonitor.js';

const EXTRA_PANES = {
  powershell: { title: 'PowerShell', badge: 'PS', icon: 'powershell' },
  claude: { title: 'Claude Code', badge: 'CC', icon: 'claude' },
  wsl: { title: 'Bash (WSL)', badge: 'WSL', icon: 'bash' },
};

/**
 * Aba de workspace: abre os agentes da pasta AgentesClaude e os terminais extras salvos.
 * fresh = true inicia os agentes com sessões novas (-Nova no IniciarSessoes.ps1).
 */
export function WorkspaceView({ store, workspaceId, fresh }) {
  const ws = store.getWorkspace(workspaceId);
  const panes = new Map(); // paneId -> TerminalPane
  let lastFocusedId = null;
  const monitor = createAgentMonitor();
  let mcpPanel = null;
  const notice = h('div', { class: 'notice', hidden: true });

  const grid = TerminalGrid({
    layout: ws.layout,
    onLayoutChange: (layout) => store.updateWorkspace(workspaceId, (w) => (w.layout = layout)),
    onSpanChange: (paneId, span) => panes.get(paneId)?.setSpanState(span),
  });

  const toolbar = h(
    'div',
    { class: 'toolbar' },
    h('span', { class: 'toolbar-path', title: ws.folder }, ws.folder),
    h('div', { class: 'toolbar-spacer' }),
    ...['powershell', 'wsl', 'claude'].map((kind) =>
      h('button', { class: 'btn', title: `Adicionar ${EXTRA_PANES[kind].title}`, onClick: () => addExtra(kind) }, icon(EXTRA_PANES[kind].icon), EXTRA_PANES[kind].title),
    ),
    h('button', { class: 'btn', title: 'Servidores MCP globais, locais e do projeto', onClick: () => (mcpPanel ??= McpPanel({ folder: ws.folder })).open() }, icon('plug'), 'MCPs'),
  );
  const el = h('div', { class: 'workspace' }, toolbar, notice, grid.el);

  function mountPane(paneId, options) {
    const pane = TerminalPane({
      ptyId: `${workspaceId}:${paneId}`,
      onToggleMaximize: () => grid.toggleMaximize(paneId),
      onToggleSpan: (axis) => {
        const span = grid.getSpan(paneId);
        grid.setSpan(paneId, { ...span, [axis]: span[axis] > 1 ? 1 : 2 });
      },
      onResizeStart: (event) => grid.startSpanDrag(paneId, event),
      ...options,
    });
    pane.el.addEventListener('focusin', () => (lastFocusedId = paneId));
    panes.set(paneId, pane);
    grid.add(paneId, pane.el);
    pane.setSpanState(grid.getSpan(paneId));
    pane.mount();
    return pane;
  }

  function extraSpec(pane) {
    if (pane.kind === 'claude') return { kind: 'claude', folder: ws.folder, sessionId: pane.sessionId };
    if (pane.kind === 'wsl') return { kind: 'wsl', folder: ws.folder };
    return { kind: 'powershell', folder: ws.folder };
  }

  function mountExtra(pane) {
    return mountPane(pane.id, {
      spec: extraSpec(pane),
      title: pane.title,
      badge: EXTRA_PANES[pane.kind]?.badge,
      compactable: pane.kind === 'claude',
      onClose: () => removeExtra(pane.id),
    });
  }

  function addExtra(kind) {
    const pane = { id: crypto.randomUUID(), kind, title: EXTRA_PANES[kind].title };
    if (kind === 'claude') pane.sessionId = crypto.randomUUID();
    store.updateWorkspace(workspaceId, (w) => w.panes.push(pane));
    mountExtra(pane).focus();
  }

  function removePane(paneId, options) {
    if (lastFocusedId === paneId) lastFocusedId = null;
    panes.get(paneId)?.dispose();
    panes.delete(paneId);
    grid.remove(paneId, options);
  }

  function removeExtra(paneId) {
    removePane(paneId, { forget: true });
    store.updateWorkspace(workspaceId, (w) => (w.panes = w.panes.filter((p) => p.id !== paneId)));
  }

  /** Encerra a sessão do agente e tira o painel; ele volta ao reabrir o workspace. */
  async function closeAgent(paneId, role) {
    const confirmed = await ask(
      `Encerrar o agente "${role}"?
O Claude Code desse painel será fechado. A sessão continua salva e é retomada ao reabrir o workspace.`,
      { title: 'Encerrar agente', kind: 'warning', okLabel: 'Encerrar', cancelLabel: 'Cancelar' },
    );
    if (!confirmed || disposed || !panes.has(paneId)) return;
    monitor.unregister(`${workspaceId}:${paneId}`);
    removePane(paneId);
  }

  function showNotice(text) {
    notice.textContent = text;
    notice.hidden = false;
  }

  async function start() {
    const agentsDir = store.state.agentsDir;
    let roles = [];
    if (!agentsDir) {
      showNotice('Pasta AgentesClaude não configurada. Defina-a na tela inicial (aba +).');
    } else {
      try {
        roles = await api.listAgentRoles(agentsDir);
      } catch (error) {
        showNotice(`Agentes não iniciados: ${error}`);
      }
    }
    if (disposed) return;
    for (const role of roles) {
      const paneId = `agent:${role}`;
      const pane = mountPane(paneId, {
        spec: { kind: 'agent', role, agentsDir, folder: ws.folder, fresh: Boolean(fresh), team: workspaceId.replace(/[^A-Za-z0-9]/g, '').slice(0, 4) },
        title: role,
        badge: 'AG',
        monitored: true,
        compactable: true,
        close: { title: 'Encerrar agente', icon: 'stop' },
        onClose: () => closeAgent(paneId, role),
      });
      monitor.register(`${workspaceId}:${paneId}`, pane);
    }
    ws.panes.forEach(mountExtra);
    panes.values().next().value?.focus();
  }

  let disposed = false;
  start();

  return {
    el,
    focus() {
      (panes.get(lastFocusedId) ?? panes.values().next().value)?.focus();
    },
    dispose() {
      disposed = true;
      monitor.dispose();
      panes.forEach((pane) => pane.dispose());
      panes.clear();
      el.remove();
    },
  };
}
