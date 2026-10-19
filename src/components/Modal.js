import { h } from '../lib/dom.js';

/** Janela modal genérica: Modal({ title, body, actions }).open(). Fecha com Esc, ✕ ou clique fora. */
export function Modal({ title, body, actions = [], onClose }) {
  const closeButton = h('button', { class: 'icon-btn', title: 'Fechar (Esc)', onClick: () => close() }, '✕');
  const dialog = h(
    'div',
    { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
    h('div', { class: 'modal-header' }, h('h2', {}, title), h('div', { class: 'modal-actions' }, actions), closeButton),
    h('div', { class: 'modal-body' }, body),
  );
  const overlay = h('div', { class: 'modal-overlay', onMouseDown: (event) => event.target === overlay && close() }, dialog);

  let previousFocus = null;

  const onKey = (event) => {
    if (event.key !== 'Escape') return;
    event.stopImmediatePropagation();
    close();
  };

  function close() {
    if (!overlay.isConnected) return;
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    previousFocus?.focus?.();
    onClose?.();
  }

  return {
    get isOpen() {
      return overlay.isConnected;
    },
    open() {
      if (overlay.isConnected) return;
      previousFocus = document.activeElement;
      document.body.append(overlay);
      document.addEventListener('keydown', onKey, true);
      dialog.focus();
    },
    close,
  };
}
