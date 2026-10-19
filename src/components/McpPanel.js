import { api } from '../lib/api.js';
import { h } from '../lib/dom.js';
import { Modal } from './Modal.js';

const SCOPES = {
  global: { label: 'Global (usuário)', hint: '~/.claude.json' },
  local: { label: 'Local (este projeto, só você)', hint: '~/.claude.json › projects' },
  project: { label: 'Projeto (compartilhado)', hint: '.mcp.json na pasta' },
  connector: { label: 'Conectores claude.ai', hint: 'conta Claude' },
  plugin: { label: 'Plugins', hint: '~/.claude/plugins' },
  other: { label: 'Outros', hint: '' },
};

const STATUS = {
  connected: { label: 'Conectado', tone: 'ok' },
  'needs authentication': { label: 'Requer autenticação', tone: 'warn' },
  'not configured': { label: 'Não configurado', tone: 'muted' },
  failed: { label: 'Falhou', tone: 'danger' },
  'failed to connect': { label: 'Falhou', tone: 'danger' },
};

/** Trechos longos parecidos com chaves (ex.: em URLs de conectores) são abreviados. */
const maskSecrets = (text) => text.replace(/[A-Za-z0-9_-]{24,}/g, (m) => `${m.slice(0, 4)}…`);

function scopeOf(name, configuredByName) {
  if (name.startsWith('claude.ai ')) return 'connector';
  if (name.startsWith('plugin:')) return 'plugin';
  return configuredByName.get(name)?.scope ?? 'other';
}

function displayName(name) {
  if (name.startsWith('claude.ai ')) return name.slice('claude.ai '.length);
  const plugin = name.match(/^plugin:([^:]+):(.+)$/);
  return plugin ? `${plugin[2]}  ·  ${plugin[1]}` : name;
}

/**
 * Lista os servidores MCP vistos pelo Claude Code na pasta do workspace.
 * Mostra primeiro as configurações (instantâneo) e depois o status do `claude mcp list`.
 */
export function McpPanel({ folder }) {
  const content = h('div', { class: 'mcp' });
  let request = 0;

  function render(configured, statuses, loading, error) {
    const configuredByName = new Map(configured.map((s) => [s.name, s]));
    const rows = statuses
      ? statuses.map((s) => ({ ...s, scope: scopeOf(s.name, configuredByName), transport: configuredByName.get(s.name)?.transport }))
      : configured.map((s) => ({ ...s, status: null }));
    // Configurados que o `claude mcp list` não listou (ex.: desativados).
    if (statuses) {
      const listed = new Set(statuses.map((s) => s.name));
      configured.filter((s) => !listed.has(s.name)).forEach((s) => rows.push({ ...s, status: 'não listado' }));
    }

    const groups = Object.keys(SCOPES)
      .map((scope) => [scope, rows.filter((r) => r.scope === scope)])
      .filter(([, items]) => items.length);

    content.replaceChildren(
      h('p', { class: 'muted' }, `Pasta: ${folder}`),
      loading && h('div', { class: 'mcp-loading' }, h('span', { class: 'spinner' }), 'Verificando conexões com "claude mcp list"…'),
      error && h('div', { class: 'error-text' }, `Não foi possível verificar o status: ${error}`),
      groups.length === 0 && !loading ? h('p', { class: 'empty' }, 'Nenhum servidor MCP encontrado.') : null,
      ...groups.map(([scope, items]) =>
        h(
          'section',
          { class: 'mcp-group' },
          h('h3', {}, SCOPES[scope].label, ' ', h('span', { class: 'mcp-count' }, items.length), h('span', { class: 'mcp-hint' }, SCOPES[scope].hint)),
          ...items.map((item) => {
            const status = item.status && (STATUS[item.status.toLowerCase()] ?? { label: item.status, tone: 'muted' });
            return h(
              'div',
              { class: 'mcp-row' },
              h('span', { class: 'mcp-name' }, displayName(item.name)),
              item.transport && h('span', { class: 'pane-badge' }, item.transport),
              h('span', { class: 'mcp-target', title: maskSecrets(item.target) }, maskSecrets(item.target) || '—'),
              status && h('span', { class: `status-pill ${status.tone}` }, status.label),
            );
          }),
        ),
      ),
    );
  }

  // Uma verificação por vez: cada uma executa um processo `claude mcp list`.
  let checking = null;

  async function refresh() {
    if (checking) return;
    const current = ++request;
    const configured = await api.mcpConfigured(folder).catch(() => []);
    if (current !== request) return;
    render(configured, null, true, null);
    checking = api.mcpStatus(folder);
    try {
      const statuses = await checking;
      if (current === request) render(configured, statuses, false, null);
    } catch (error) {
      if (current === request) render(configured, null, false, String(error));
    } finally {
      checking = null;
    }
  }

  const modal = Modal({
    title: 'Servidores MCP',
    body: content,
    actions: [h('button', { class: 'btn', onClick: refresh }, 'Atualizar')],
  });

  return {
    open() {
      if (modal.isOpen) return;
      modal.open();
      refresh();
    },
  };
}
