import { h } from '../lib/dom.js';

const GUTTER = 6;
const MIN_TRACK = 80;

const equal = (n) => Array.from({ length: n }, () => 1);

function dimensions(count) {
  const cols = count <= 1 ? 1 : Math.ceil(Math.sqrt(count));
  return { cols, rows: Math.max(1, Math.ceil(count / cols)) };
}

/** "1fr 6px 1fr ..." alternando trilhas de conteúdo e divisórias. */
function template(fractions) {
  return fractions.map((f) => `minmax(0, ${f}fr)`).join(` ${GUTTER}px `);
}

/**
 * Grid de painéis com divisórias arrastáveis.
 * O layout ({ cols: number[], rows: number[] }) guarda as frações de cada trilha.
 */
export function TerminalGrid({ layout, onLayoutChange }) {
  const el = h('div', { class: 'grid' });
  const items = []; // { id, el }
  // Layout salvo: aplicado quando o número de trilhas bate (os painéis entram um a um).
  let saved = layout ?? null;
  let cols = [];
  let rows = [];
  let maximizedId = null;

  function applyTemplate() {
    el.style.gridTemplateColumns = template(cols);
    el.style.gridTemplateRows = template(rows);
  }

  function relayout() {
    const dims = dimensions(items.length);
    if (cols.length !== dims.cols) cols = saved?.cols?.length === dims.cols ? [...saved.cols] : equal(dims.cols);
    if (rows.length !== dims.rows) rows = saved?.rows?.length === dims.rows ? [...saved.rows] : equal(dims.rows);
    applyTemplate();

    el.querySelectorAll(':scope > .gutter').forEach((g) => g.remove());
    const lastRowCount = items.length - (dims.rows - 1) * dims.cols;

    items.forEach((item, index) => {
      const row = Math.floor(index / dims.cols);
      const col = index % dims.cols;
      const isLast = index === items.length - 1;
      item.el.style.gridRow = `${2 * row + 1}`;
      item.el.style.gridColumn = isLast ? `${2 * col + 1} / -1` : `${2 * col + 1}`;
    });

    for (let i = 0; i < dims.cols - 1; i++) {
      // Na última linha incompleta o último painel ocupa o resto: a divisória para antes.
      const fullHeight = dims.rows === 1 || i < lastRowCount - 1;
      const gridRow = fullHeight ? '1 / -1' : `1 / ${2 * dims.rows - 2}`;
      el.append(gutter('col', i, { gridColumn: `${2 * i + 2}`, gridRow }));
    }
    for (let j = 0; j < dims.rows - 1; j++) {
      el.append(gutter('row', j, { gridRow: `${2 * j + 2}`, gridColumn: '1 / -1' }));
    }
  }

  function layoutChanged() {
    saved = { cols: [...cols], rows: [...rows] };
    onLayoutChange?.(saved);
  }

  function gutter(axis, index, style) {
    const g = h('div', {
      class: `gutter gutter-${axis}`,
      style,
      onPointerDown: (event) => startDrag(event, axis, index),
      onDblClick: () => {
        if (axis === 'col') cols = equal(cols.length);
        else rows = equal(rows.length);
        applyTemplate();
        layoutChanged();
      },
    });
    return g;
  }

  function startDrag(event, axis, index) {
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    target.classList.add('dragging');
    el.classList.add(axis === 'col' ? 'resizing-col' : 'resizing-row');

    const fractions = axis === 'col' ? cols : rows;
    const computed = getComputedStyle(el)[axis === 'col' ? 'gridTemplateColumns' : 'gridTemplateRows']
      .split(' ')
      .map(parseFloat);
    const a = computed[2 * index];
    const b = computed[2 * index + 2];
    const totalFr = fractions[index] + fractions[index + 1];
    const startPos = axis === 'col' ? event.clientX : event.clientY;

    const onMove = (moveEvent) => {
      const delta = (axis === 'col' ? moveEvent.clientX : moveEvent.clientY) - startPos;
      const min = Math.min(MIN_TRACK, (a + b) / 2);
      const nextA = Math.min(Math.max(a + delta, min), a + b - min);
      fractions[index] = (totalFr * nextA) / (a + b);
      fractions[index + 1] = totalFr - fractions[index];
      applyTemplate();
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      target.classList.remove('dragging');
      el.classList.remove('resizing-col', 'resizing-row');
      layoutChanged();
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  }

  return {
    el,
    add(id, paneEl) {
      items.push({ id, el: paneEl });
      el.append(paneEl);
      relayout();
    },
    remove(id) {
      const index = items.findIndex((item) => item.id === id);
      if (index === -1) return;
      const [item] = items.splice(index, 1);
      item.el.remove();
      if (maximizedId === id) this.toggleMaximize(id);
      relayout();
    },
    toggleMaximize(id) {
      items.forEach((item) => item.el.classList.remove('maximized'));
      maximizedId = maximizedId === id ? null : id;
      const item = items.find((i) => i.id === maximizedId);
      item?.el.classList.add('maximized');
      el.classList.toggle('has-maximized', Boolean(item));
    },
  };
}
