import { ask, message } from '@tauri-apps/plugin-dialog';
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { TabBar } from './TabBar.js';
import { HomeView } from './HomeView.js';
import { WorkspaceView } from './WorkspaceView.js';
import { UsageMeter } from './UsageMeter.js';

const HOME_TAB = { title: 'Nova aba', tooltip: 'Nova aba', icon: 'home', renamable: false };

const workspaceTab = (ws) => ({ title: ws.name, tooltip: ws.folder, icon: 'workspace', renamable: true });

/** Raiz do app: barra de abas + conteúdo de cada aba (todas montadas, só a ativa visível). */
export function App({ store }) {
  const tabs = new Map(); // key -> { kind: 'home' | 'workspace', workspaceId?, view }
  let activeKey = null;
  let homeCounter = 0;

  const content = h('main', { class: 'content' });
  const usage = UsageMeter();
  const tabBar = TabBar({
    onSelect: activate,
    onClose: closeTab,
    onAdd: openHome,
    onRename: renameTab,
    trailing: usage.el,
  });
  const el = h('div', { class: 'app' }, tabBar.el, content);

  function persistTabs() {
    store.update((s) => {
      s.openTabs = [...tabs.values()].filter((t) => t.kind === 'workspace').map((t) => t.workspaceId);
      const active = tabs.get(activeKey);
      s.activeTab = active?.kind === 'workspace' ? active.workspaceId : null;
    });
  }

  function activate(key) {
    if (!tabs.has(key)) return;
    activeKey = key;
    tabs.forEach((tab, tabKey) => tab.view.el.classList.toggle('hidden', tabKey !== key));
    tabBar.setActive(key);
    persistTabs();
    const view = tabs.get(key).view;
    requestAnimationFrame(() => activeKey === key && view.focus?.());
  }

  function openHome() {
    const key = `home-${++homeCounter}`;
    const view = HomeView({
      store,
      onOpen: (id, options) => openWorkspace(id, { ...options, replaceKey: key }),
      onRemove: removeWorkspace,
    });
    tabs.set(key, { kind: 'home', view });
    content.append(view.el);
    tabBar.add(key, HOME_TAB);
    activate(key);
  }

  function openWorkspace(workspaceId, { fresh = false, replaceKey = null, focus = true } = {}) {
    const existing = [...tabs].find(([, tab]) => tab.workspaceId === workspaceId);
    if (existing) {
      if (focus) activate(existing[0]);
      if (fresh) {
        message('Este workspace já está aberto. Feche a aba dele para reiniciá-lo com sessões novas.', {
          title: 'Workspace aberto',
        });
      }
      return;
    }
    const ws = store.getWorkspace(workspaceId);
    if (!ws) return;
    store.updateWorkspace(workspaceId, (w) => (w.lastOpenedAt = Date.now()));

    const view = WorkspaceView({ store, workspaceId, fresh });
    view.el.classList.add('hidden');
    content.append(view.el);

    // Abrir a partir de uma "Nova aba" transforma a própria aba, como num navegador.
    const replaced = replaceKey && tabs.get(replaceKey);
    const key = replaced ? replaceKey : `ws-${workspaceId}`;
    if (replaced) {
      replaced.view.dispose();
      tabBar.update(key, workspaceTab(ws));
    } else {
      tabBar.add(key, workspaceTab(ws));
    }
    tabs.set(key, { kind: 'workspace', workspaceId, view });

    if (focus) activate(key);
    else persistTabs();
  }

  async function closeTab(key) {
    const tab = tabs.get(key);
    if (!tab) return;
    if (tab.kind === 'workspace') {
      const ws = store.getWorkspace(tab.workspaceId);
      const confirmed = await ask(
        `Fechar o workspace "${ws?.name ?? ''}"?\nOs terminais serão encerrados; o workspace e as sessões do Claude continuam salvos.`,
        { title: 'Fechar workspace', kind: 'warning', okLabel: 'Fechar', cancelLabel: 'Cancelar' },
      );
      if (!confirmed || !tabs.has(key)) return;
    }

    disposeTab(key);
  }

  function disposeTab(key) {
    const tab = tabs.get(key);
    const keys = [...tabs.keys()];
    const index = keys.indexOf(key);
    tab.view.dispose();
    tabs.delete(key);
    tabBar.remove(key);

    if (tabs.size === 0) openHome();
    else if (activeKey === key) activate(keys[index + 1] ?? keys[index - 1]);
    else persistTabs();
  }

  async function removeWorkspace(workspaceId) {
    const ws = store.getWorkspace(workspaceId);
    const openKey = [...tabs].find(([, tab]) => tab.workspaceId === workspaceId)?.[0];
    const closing = openKey ? '\nA aba aberta será fechada e seus terminais encerrados.' : '';
    const confirmed = await ask(
      `Remover "${ws?.name ?? ''}" dos workspaces salvos?${closing}\nAs sessões do Claude não são apagadas.`,
      { title: 'Remover workspace', kind: 'warning', okLabel: 'Remover', cancelLabel: 'Cancelar' },
    );
    if (!confirmed) return;
    if (openKey && tabs.has(openKey)) disposeTab(openKey);
    store.removeWorkspace(workspaceId);
  }

  function renameTab(key, title) {
    const tab = tabs.get(key);
    if (tab?.kind !== 'workspace') return;
    store.updateWorkspace(tab.workspaceId, (w) => (w.name = title));
    tabBar.update(key, { title, tooltip: store.getWorkspace(tab.workspaceId)?.folder });
  }

  function cycle(step) {
    const keys = [...tabs.keys()];
    if (keys.length < 2) return;
    const index = keys.indexOf(activeKey);
    activate(keys[(index + step + keys.length) % keys.length]);
  }

  // Atalhos em fase de captura, antes de o terminal consumir as teclas.
  window.addEventListener(
    'keydown',
    (event) => {
      if (!event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      let handled = true;
      if (event.shiftKey && key === 't') openHome();
      else if (event.shiftKey && key === 'w') closeTab(activeKey);
      else if (key === 'tab') cycle(event.shiftKey ? -1 : 1);
      else if (key === 'pagedown') cycle(1);
      else if (key === 'pageup') cycle(-1);
      else handled = false;
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );

  return {
    el,
    /** Reabre as abas da última execução. */
    restore() {
      const { openTabs, activeTab } = store.state;
      openTabs.filter((id) => store.getWorkspace(id)).forEach((id) => openWorkspace(id, { focus: false }));
      const activeEntry = [...tabs].find(([, tab]) => tab.workspaceId === activeTab) ?? [...tabs][0];
      if (activeEntry) activate(activeEntry[0]);
      else openHome();
    },
  };
}
