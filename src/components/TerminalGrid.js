import { h } from '../lib/dom.js';
import { computeLayout, gutterSegments, normalizeSpan } from './gridLayout.js';

const GUTTER = 6;
const MIN_TRACK = 80;

const equal = (n) => Array.from({ length: n }, () => 1);
const isDefaultSpan = (span) => span.col === 1 && span.row === 1;

/** "1fr 6px 1fr ..." alternando trilhas de conteúdo e divisórias. */
function template(fractions) {
  return fractions.map((f) => `minmax(0, ${f}fr)`).join(` ${GUTTER}px `);
}

/**
 * Grid de painéis com divisórias arrastáveis.
 * O layout ({ cols: number[], rows: number[], spans?: { [id]: { col, row } } }) guarda as
 * frações de cada trilha e quantas células (1 ou 2) cada painel ocupa.
 */
export function TerminalGrid({ layout, onLayoutChange, onSpanChange }) {
  const el = h('div', { class: 'grid' });
  const items = []; // { id, el }
  // Layout salvo: aplicado quando o número de trilhas bate (os painéis entram um a um).
  let saved = layout ?? null;
  let cols = [];
  let rows = [];
  let maximizedId = null;
  const spans = new Map(Object.entries(layout?.spans ?? {}).map(([id, span]) => [id, normalizeSpan(span)]));
  const spanOf = (id) => spans.get(id) ?? { col: 1, row: 1 };

  function applyTemplate() {
    el.style.gridTemplateColumns = template(cols);
    el.style.gridTemplateRows = template(rows);
  }

  // Células n..m (inclusivo) em linhas do CSS grid, contando as trilhas das divisórias.
  const cells = (from, to) => `${2 * from + 1} / ${2 * to + 2}`;

  function relayout() {
    const dims = computeLayout(items.map((item) => spanOf(item.id)));
    if (cols.length !== dims.cols) cols = saved?.cols?.length === dims.cols ? [...saved.cols] : equal(dims.cols);
    if (rows.length !== dims.rows) rows = saved?.rows?.length === dims.rows ? [...saved.rows] : equal(dims.rows);
    applyTemplate();

    el.querySelectorAll(':scope > .gutter').forEach((g) => g.remove());

    items.forEach((item, index) => {
      const place = dims.places[index];
      item.el.style.gridRow = cells(place.row, place.row + place.rowSpan - 1);
      item.el.style.gridColumn = cells(place.col, place.col + place.colSpan - 1);
    });

    for (const { axis, index, from, to } of gutterSegments(dims)) {
      const style =
        axis === 'col'
          ? { gridColumn: `${2 * index + 2}`, gridRow: cells(from, to) }
          : { gridRow: `${2 * index + 2}`, gridColumn: cells(from, to) };
      el.append(gutter(axis, index, style));
    }
  }

  function layoutChanged() {
    saved = { cols: [...cols], rows: [...rows] };
    // Inclui painéis fora do grid agora (agente encerrado): o span volta ao reabrir.
    if (spans.size) saved.spans = Object.fromEntries(spans);
    onLayoutChange?.(saved);
  }

  function setSpan(id, span) {
    const next = normalizeSpan(span);
    const current = spanOf(id);
    if (next.col === current.col && next.row === current.row) return;
    if (isDefaultSpan(next)) spans.delete(id);
    else spans.set(id, next);
    relayout();
    layoutChanged();
    onSpanChange?.(id, next);
  }

  /** Arrasta o canto do painel: o tamanho encaixa em 1 ou 2 células em cada direção. */
  function startSpanDrag(id, event) {
    const item = items.find((i) => i.id === id);
    if (!item || maximizedId) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    el.classList.add('resizing-span');

    const startRect = item.el.getBoundingClientRect();
    const start = spanOf(id);
    // Tamanho de uma célula do painel (aproximado pelas frações atuais).
    const cellW = startRect.width / start.col;
    const cellH = startRect.height / start.row;

    const onMove = (moveEvent) => {
      // Relido a cada movimento: o relayout pode mudar o painel de lugar durante o arraste.
      const rect = item.el.getBoundingClientRect();
      const width = moveEvent.clientX - rect.left;
      const height = moveEvent.clientY - rect.top;
      setSpan(id, { col: width > cellW * 1.5 ? 2 : 1, row: height > cellH * 1.5 ? 2 : 1 });
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      el.classList.remove('resizing-span');
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
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
    /** forget = true apaga o span salvo (painel removido de vez, não só encerrado). */
    remove(id, { forget = false } = {}) {
      const index = items.findIndex((item) => item.id === id);
      if (index === -1) return;
      const [item] = items.splice(index, 1);
      item.el.remove();
      if (maximizedId === id) this.toggleMaximize(id);
      relayout();
      if (forget && spans.delete(id)) layoutChanged();
    },
    getSpan: spanOf,
    setSpan,
    startSpanDrag,
    toggleMaximize(id) {
      items.forEach((item) => item.el.classList.remove('maximized'));
      maximizedId = maximizedId === id ? null : id;
      const item = items.find((i) => i.id === maximizedId);
      item?.el.classList.add('maximized');
      el.classList.toggle('has-maximized', Boolean(item));
    },
  };
}
