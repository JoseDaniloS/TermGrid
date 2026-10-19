import { invoke, Channel } from '@tauri-apps/api/core';

/** Ponte com os comandos Rust (src-tauri/src/main.rs). */
export const api = {
  loadState: () => invoke('load_state'),
  saveState: (json) => invoke('save_state', { json }),
  defaultAgentsDir: () => invoke('default_agents_dir'),
  listAgentRoles: (dir) => invoke('list_agent_roles', { dir }),
  mcpConfigured: (folder) => invoke('mcp_configured', { folder }),
  mcpStatus: (folder) => invoke('mcp_status', { folder }),
  planUsage: () => invoke('plan_usage'),

  /** onEvent recebe { event: 'output', data: string } ou { event: 'exit', data: number|null }. */
  ptySpawn(id, spec, cols, rows, onEvent) {
    const channel = new Channel();
    channel.onmessage = onEvent;
    return invoke('pty_spawn', { id, spec, cols, rows, onEvent: channel });
  },
  ptyWrite: (id, data) => invoke('pty_write', { id, data }),
  ptyResize: (id, cols, rows) => invoke('pty_resize', { id, cols, rows }),
  ptyKill: (id) => invoke('pty_kill', { id }),
  /** { [id]: { alive, claudePid, peer } } — saúde das sessões dos agentes. */
  ptyHealth: (ids) => invoke('pty_health', { ids }),
};
