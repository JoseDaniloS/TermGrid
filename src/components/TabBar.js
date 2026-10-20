import { h } from '../lib/dom.js';
import { icon as svgIcon } from '../lib/icons.js';

/**
 * Barra de abas no estilo navegador.
 * Eventos: onSelect(key), onClose(key), onAdd(), onRename(key, title).
 * trailing: elemento opcional exibido à direita (ex.: medidor de uso).
 */
export function TabBar({ onSelect, onClose, onAdd, onRename, trailing }) {
  const list = h('div', { class: 'tabs', role: 'tablist' });
  const addButton = h('button', { class: 'tab-add', title: 'Nova aba (Ctrl+Shift+T)', onClick: () => onAdd() }, svgIcon('plus'));
  const el = h('header', { class: 'tabbar' }, list, addButton, h('div', { class: 'tabbar-spacer' }), trailing);
  const tabs = new Map(); // key -> { el, label, renamable }

  function startRename(key) {
    const tab = tabs.get(key);
    const input = h('input', { class: 'tab-rename', value: tab.label.textContent });
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const title = input.value.trim();
      input.replaceWith(tab.label);
      if (commit && title) onRename(key, title);
    };
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') finish(true);
      if (event.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    tab.label.replaceWith(input);
    input.focus();
    input.select();
  }

  return {
    el,
    add(key, { title, tooltip, icon, renamable }) {
      const label = h('span', { class: 'tab-label' }, title);
      const tabEl = h(
        'div',
        {
          class: 'tab',
          role: 'tab',
          title: tooltip ?? title,
          onMouseDown: (event) => {
            if (event.button === 1) {
              event.preventDefault();
              onClose(key);
            } else if (event.button === 0) onSelect(key);
          },
          onDblClick: () => tabs.get(key)?.renamable && startRename(key),
        },
        h('span', { class: 'tab-icon' }, svgIcon(icon ?? 'workspace')),
        label,
        h(
          'button',
          {
            class: 'tab-close',
            title: 'Fechar aba (Ctrl+Shift+W)',
            onMouseDown: (event) => event.stopPropagation(),
            onClick: () => onClose(key),
          },
          svgIcon('close'),
        ),
      );
      tabs.set(key, { el: tabEl, label, renamable: Boolean(renamable) });
      list.append(tabEl);
    },
    remove(key) {
      tabs.get(key)?.el.remove();
      tabs.delete(key);
    },
    update(key, { title, tooltip, icon, renamable }) {
      const tab = tabs.get(key);
      if (!tab) return;
      if (title != null) tab.label.textContent = title;
      tab.el.title = tooltip ?? title ?? tab.el.title;
      if (icon != null) tab.el.querySelector('.tab-icon').replaceChildren(svgIcon(icon));
      if (renamable != null) tab.renamable = renamable;
    },
    setActive(key) {
      tabs.forEach((tab, tabKey) => {
        tab.el.classList.toggle('active', tabKey === key);
        tab.el.setAttribute('aria-selected', String(tabKey === key));
      });
      tabs.get(key)?.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    },
  };
}
