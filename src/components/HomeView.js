import { open } from '@tauri-apps/plugin-dialog';
import { api } from '../lib/api.js';
import { h } from '../lib/dom.js';

const formatDate = (ms) =>
  ms ? new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

/**
 * Tela de nova aba: abrir pasta, workspaces salvos e pasta AgentesClaude.
 * onOpen(workspaceId, { fresh }) abre o workspace nesta aba; onRemove(workspaceId) o remove dos salvos.
 */
export function HomeView({ store, onOpen, onRemove }) {
  const freshInput = h('input', { type: 'checkbox' });
  const agentsInfo = h('div', { class: 'agents-info' });
  const list = h('div', { class: 'ws-list' });

  async function openFolder() {
    const folder = await open({ directory: true, title: 'Escolha a pasta do workspace' });
    if (typeof folder !== 'string') return;
    const ws = store.workspaceForFolder(folder);
    onOpen(ws.id, { fresh: freshInput.checked });
  }

  async function chooseAgentsDir() {
    const dir = await open({ directory: true, title: 'Escolha a pasta AgentesClaude', defaultPath: store.state.agentsDir ?? undefined });
    if (typeof dir === 'string') store.update((s) => (s.agentsDir = dir));
  }

  let agentsRequest = 0;
  async function renderAgents() {
    const dir = store.state.agentsDir;
    const request = ++agentsRequest;
    agentsInfo.replaceChildren(
      h('div', { class: 'agents-path' }, dir ?? 'Pasta AgentesClaude não encontrada'),
      h('button', { class: 'btn', onClick: chooseAgentsDir }, dir ? 'Alterar' : 'Escolher pasta'),
    );
    if (!dir) return;
    const roles = await api.listAgentRoles(dir).catch((error) => String(error));
    if (request !== agentsRequest) return;
    agentsInfo.append(
      Array.isArray(roles)
        ? h('div', { class: 'chips' }, roles.map((role) => h('span', { class: 'chip' }, role)))
        : h('div', { class: 'error-text' }, roles),
    );
  }

  function renderList() {
    const workspaces = [...store.state.workspaces].sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0));
    if (workspaces.length === 0) {
      list.replaceChildren(h('p', { class: 'empty' }, 'Nenhum workspace salvo ainda. Abra uma pasta para começar.'));
      return;
    }
    list.replaceChildren(
      ...workspaces.map((ws) =>
        h(
          'div',
          { class: 'ws-item' },
          h(
            'button',
            { class: 'ws-main', title: 'Abrir e retomar as sessões', onClick: () => onOpen(ws.id, { fresh: false }) },
            h('span', { class: 'ws-name' }, ws.name),
            h('span', { class: 'ws-folder' }, ws.folder),
            h('span', { class: 'ws-meta' }, `Último acesso: ${formatDate(ws.lastOpenedAt)} · ${ws.panes.length} terminal(is) extra(s)`),
          ),
          h('button', { class: 'btn', title: 'Abrir com sessões novas dos agentes', onClick: () => onOpen(ws.id, { fresh: true }) }, 'Sessões novas'),
          h('button', { class: 'btn danger', title: 'Remover dos workspaces salvos', onClick: () => onRemove(ws.id) }, 'Remover'),
        ),
      ),
    );
  }

  let lastAgentsDir;
  const unsubscribe = store.subscribe((state) => {
    renderList();
    if (state.agentsDir !== lastAgentsDir) {
      lastAgentsDir = state.agentsDir;
      renderAgents();
    }
  });

  const el = h(
    'div',
    { class: 'home' },
    h(
      'div',
      { class: 'home-inner' },
      h('h1', {}, 'TermGrid'),
      h('p', { class: 'subtitle' }, 'Terminais PowerShell e Claude Code em grid, com workspaces salvos.'),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, 'Novo workspace'),
        h('p', { class: 'muted' }, 'Escolha uma pasta: os agentes da pasta AgentesClaude abrem nela automaticamente.'),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn primary', onClick: openFolder }, 'Abrir pasta e iniciar'),
          h('label', { class: 'check' }, freshInput, 'Iniciar com sessões novas'),
        ),
      ),
      h('section', { class: 'card' }, h('h2', {}, 'Agentes (AgentesClaude)'), agentsInfo),
      h('section', { class: 'card' }, h('h2', {}, 'Workspaces salvos'), list),
    ),
  );

  lastAgentsDir = store.state.agentsDir;
  renderAgents();
  renderList();

  return {
    el,
    dispose() {
      unsubscribe();
      el.remove();
    },
  };
}
