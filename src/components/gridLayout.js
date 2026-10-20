/** Posicionamento dos painéis no grid, sem DOM (usado pelo TerminalGrid). */

const MAX_SPAN = 2;

const clampSpan = (value) => Math.min(MAX_SPAN, Math.max(1, Math.round(value) || 1));

/** Normaliza o span pedido para um painel: { col: 1|2, row: 1|2 }. */
export function normalizeSpan(span) {
  return { col: clampSpan(span?.col), row: clampSpan(span?.row) };
}

function fits(occ, cols, r, c, w, hgt) {
  if (c + w > cols) return false;
  for (let rr = r; rr < r + hgt; rr++) {
    for (let cc = c; cc < c + w; cc++) if (occ[rr]?.[cc] != null && occ[rr][cc] !== -1) return false;
  }
  return true;
}

function fill(occ, cols, r, c, w, hgt, index) {
  for (let rr = r; rr < r + hgt; rr++) {
    occ[rr] ??= Array(cols).fill(-1);
    for (let cc = c; cc < c + w; cc++) occ[rr][cc] = index;
  }
}

/**
 * Estende os painéis vizinhos de células vazias numa direção: axis 'col' (dir 1 = direita,
 * -1 = esquerda) ou 'row' (dir 1 = baixo, -1 = cima). Só cresce se a faixa inteira estiver vazia.
 */
function growInto(occ, places, axis, dir) {
  const [pos, span, crossPos, crossSpan] = axis === 'col' ? ['col', 'colSpan', 'row', 'rowSpan'] : ['row', 'rowSpan', 'col', 'colSpan'];
  const limit = axis === 'col' ? occ[0].length : occ.length;
  const cell = (k, cross) => (axis === 'col' ? occ[cross][k] : occ[k][cross]);
  const set = (k, cross, value) => (axis === 'col' ? (occ[cross][k] = value) : (occ[k][cross] = value));
  let changed = true;
  while (changed) {
    changed = false;
    places.forEach((p, index) => {
      const k = dir > 0 ? p[pos] + p[span] : p[pos] - 1;
      if (k < 0 || k >= limit) return;
      for (let x = p[crossPos]; x < p[crossPos] + p[crossSpan]; x++) if (cell(k, x) !== -1) return;
      for (let x = p[crossPos]; x < p[crossPos] + p[crossSpan]; x++) set(k, x, index);
      if (dir < 0) p[pos]--;
      p[span]++;
      changed = true;
    });
  }
}

/**
 * Distribui os painéis (na ordem dada) num grid de células.
 * spans: [{ col, row }] por painel. Retorna as dimensões, a posição de cada painel
 * (em células) e a matriz de ocupação (índice do painel ou -1).
 */
export function computeLayout(spans) {
  const count = spans.length;
  if (count === 0) return { cols: 1, rows: 1, places: [], occ: [[-1]] };
  const area = spans.reduce((sum, s) => sum + s.col * s.row, 0);
  const widest = Math.max(...spans.map((s) => s.col));
  const cols = count <= 1 ? 1 : Math.max(widest, Math.ceil(Math.sqrt(area)));

  const occ = [];
  const places = spans.map((s, index) => {
    const w = Math.min(s.col, cols);
    for (let r = 0; ; r++) {
      for (let c = 0; c + w <= cols; c++) {
        if (fits(occ, cols, r, c, w, s.row)) {
          fill(occ, cols, r, c, w, s.row, index);
          return { row: r, col: c, colSpan: w, rowSpan: s.row };
        }
      }
    }
  });
  const rows = occ.length;
  for (let r = 0; r < rows; r++) occ[r] ??= Array(cols).fill(-1);
  // Células que sobraram ficam com o painel ao lado (como o último painel de uma linha
  // incompleta) ou, ao lado de um painel de altura dupla, com o painel de cima ou de baixo.
  growInto(occ, places, 'col', 1);
  growInto(occ, places, 'col', -1);
  growInto(occ, places, 'row', 1);
  growInto(occ, places, 'row', -1);
  return { cols, rows, places, occ };
}

/**
 * Trechos das divisórias: uma divisória não passa por dentro de um painel que ocupa
 * as duas células vizinhas. Retorna [{ axis, index, from, to }] em células (to inclusivo).
 */
export function gutterSegments({ cols, rows, occ }) {
  const segments = [];
  const runs = (axis, index, length, isOpen) => {
    let start = -1;
    for (let k = 0; k <= length; k++) {
      const open = k < length && isOpen(k);
      if (open && start === -1) start = k;
      if (!open && start !== -1) {
        segments.push({ axis, index, from: start, to: k - 1 });
        start = -1;
      }
    }
  };
  for (let i = 0; i < cols - 1; i++) runs('col', i, rows, (r) => occ[r][i] !== occ[r][i + 1]);
  for (let j = 0; j < rows - 1; j++) runs('row', j, cols, (c) => occ[j][c] !== occ[j + 1][c]);
  return segments;
}
