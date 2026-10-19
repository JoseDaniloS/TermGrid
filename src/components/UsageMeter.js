import { api } from '../lib/api.js';
import { h } from '../lib/dom.js';

const REFRESH_MS = 3 * 60 * 1000;

const LIMIT_LABELS = {
  session: 'Sessão atual (5 h)',
  weekly_all: 'Semanal · todos os modelos',
  weekly_opus: 'Semanal · Opus',
  weekly_sonnet: 'Semanal · Sonnet',
};
const SHORT_LABELS = { session: 'Sessão', weekly_all: 'Semana' };

const LEGACY_KEYS = [
  ['five_hour', 'session'],
  ['seven_day', 'weekly_all'],
  ['seven_day_opus', 'weekly_opus'],
  ['seven_day_sonnet', 'weekly_sonnet'],
];

/** Aceita o formato novo (limits[]) e o antigo (five_hour, seven_day...). */
function normalize(data) {
  if (Array.isArray(data?.limits) && data.limits.length) {
    return data.limits.map((l) => ({ kind: l.kind, percent: l.percent, resetsAt: l.resets_at, severity: l.severity }));
  }
  return LEGACY_KEYS.filter(([key]) => data?.[key]).map(([key, kind]) => ({
    kind,
    percent: data[key].utilization,
    resetsAt: data[key].resets_at,
  }));
}

function tone({ percent, severity }) {
  if (severity && severity !== 'normal') return severity === 'critical' ? 'danger' : 'warn';
  if (percent >= 90) return 'danger';
  if (percent >= 70) return 'warn';
  return 'ok';
}

function formatReset(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const minutes = Math.round((date - Date.now()) / 60000);
  if (minutes <= 0) return 'Redefinindo…';
  if (minutes < 60) return `Redefine em ${minutes} min`;
  if (minutes < 24 * 60) return `Redefine em ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return `Redefine ${date.toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
}

const bar = (limit) =>
  h('span', { class: `meter ${tone(limit)}` }, h('span', { class: 'meter-fill', style: { width: `${Math.min(100, Math.max(0, limit.percent ?? 0))}%` } }));

/** Medidor de uso do plano Claude no cabeçalho, com detalhes ao clicar. */
export function UsageMeter() {
  const summary = h('button', { class: 'usage', title: 'Uso do plano Claude', onClick: () => toggle() }, 'Uso…');
  const popover = h('div', { class: 'usage-popover', hidden: true });
  const el = h('div', { class: 'usage-wrap' }, summary, popover);

  let limits = [];
  let plan = null;
  let error = null;
  let updatedAt = null;
  let lastAttemptAt = 0;
  let loading = false;

  function renderSummary() {
    const shown = limits.filter((l) => SHORT_LABELS[l.kind]);
    if (error && !shown.length) {
      summary.replaceChildren(h('span', { class: 'usage-error' }, 'Uso indisponível'));
      summary.title = error;
      return;
    }
    // Falhou a última atualização: mantém os números, mas sinaliza que podem estar defasados.
    summary.classList.toggle('stale', Boolean(error));
    summary.title = error
      ? `Valores da última leitura (${updatedAt?.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) ?? '—'}). ${error}`
      : 'Uso do plano Claude (clique para detalhes)';
    summary.replaceChildren(
      ...shown.map((l) =>
        h('span', { class: 'usage-item' }, h('span', { class: 'usage-label' }, SHORT_LABELS[l.kind]), bar(l), h('span', { class: 'usage-value' }, `${Math.round(l.percent ?? 0)}%`)),
      ),
    );
  }

  function renderPopover() {
    popover.replaceChildren(
      h('div', { class: 'usage-head' }, h('strong', {}, 'Uso do plano'), plan && h('span', { class: 'chip' }, plan.toUpperCase())),
      ...limits.map((l) =>
        h(
          'div',
          { class: 'usage-row' },
          h('div', { class: 'usage-row-top' }, h('span', {}, LIMIT_LABELS[l.kind] ?? l.kind), h('span', { class: 'usage-value' }, `${Math.round(l.percent ?? 0)}% usado`)),
          bar(l),
          h('div', { class: 'muted small' }, formatReset(l.resetsAt)),
        ),
      ),
      error && h('div', { class: 'error-text' }, error),
      h(
        'div',
        { class: 'usage-foot' },
        h('span', { class: 'muted small' }, updatedAt ? `Atualizado às ${updatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''),
        h('button', { class: 'btn', disabled: loading, onClick: () => refresh() }, loading ? 'Atualizando…' : 'Atualizar'),
      ),
    );
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    lastAttemptAt = Date.now();
    renderPopover();
    try {
      const data = await api.planUsage();
      limits = normalize(data);
      plan = data?.plan ?? null;
      error = null;
      updatedAt = new Date();
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
      renderSummary();
      renderPopover();
    }
  }

  function toggle() {
    popover.hidden = !popover.hidden;
    if (!popover.hidden) {
      renderPopover();
      if (Date.now() - lastAttemptAt > 60_000) refresh();
    }
  }

  document.addEventListener('mousedown', (event) => {
    if (!popover.hidden && !el.contains(event.target)) popover.hidden = true;
  });
  window.addEventListener('focus', () => {
    // Também limitado a 1 por minuto quando a API falha (evita 429).
    if (Date.now() - lastAttemptAt > 60_000) refresh();
  });

  refresh();
  setInterval(refresh, REFRESH_MS);

  return { el, refresh };
}
