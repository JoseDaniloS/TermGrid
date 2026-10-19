import { api } from './api.js';
import { basename } from './dom.js';

const DEFAULT_STATE = { version: 1, agentsDir: null, workspaces: [], openTabs: [], activeTab: null };

const sameFolder = (a, b) => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase();

/**
 * Estado persistido em %APPDATA%\dev.termgrid.desktop\state.json.
 * workspace = { id, name, folder, panes: [{ id, kind, title, sessionId? }], layout, createdAt, lastOpenedAt }
 */
export function createStore() {
  let state = structuredClone(DEFAULT_STATE);
  let saveTimer = null;
  const listeners = new Set();

  const notify = () => listeners.forEach((listener) => listener(state));

  const store = {
    get state() {
      return state;
    },

    async load() {
      try {
        const raw = await api.loadState();
        if (raw) state = { ...structuredClone(DEFAULT_STATE), ...JSON.parse(raw) };
      } catch (error) {
        console.error('Falha ao carregar o estado', error);
      }
      if (!state.agentsDir) state.agentsDir = await api.defaultAgentsDir();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    update(mutate) {
      mutate(state);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => store.flush(), 300);
      notify();
    },

    async flush() {
      clearTimeout(saveTimer);
      try {
        await api.saveState(JSON.stringify(state, null, 2));
      } catch (error) {
        console.error('Falha ao salvar o estado', error);
      }
    },

    getWorkspace(id) {
      return state.workspaces.find((ws) => ws.id === id);
    },

    /** Reaproveita o workspace da mesma pasta, se já existir. */
    workspaceForFolder(folder) {
      const existing = state.workspaces.find((ws) => sameFolder(ws.folder, folder));
      if (existing) return existing;
      const ws = {
        id: crypto.randomUUID(),
        name: basename(folder),
        folder,
        panes: [],
        layout: null,
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
      };
      store.update((s) => s.workspaces.push(ws));
      return ws;
    },

    updateWorkspace(id, mutate) {
      store.update(() => {
        const ws = store.getWorkspace(id);
        if (ws) mutate(ws);
      });
    },

    removeWorkspace(id) {
      store.update((s) => {
        s.workspaces = s.workspaces.filter((ws) => ws.id !== id);
        s.openTabs = s.openTabs.filter((tabId) => tabId !== id);
      });
    },
  };
  return store;
}
