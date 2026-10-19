import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createStore } from './lib/store.js';
import { App } from './components/App.js';

const store = createStore();
await store.load();

const app = App({ store });
document.getElementById('app').append(app.el);
app.restore();

// Garante que o estado (abas abertas, layout) seja gravado antes de fechar.
getCurrentWindow().onCloseRequested(async () => {
  await store.flush();
});
