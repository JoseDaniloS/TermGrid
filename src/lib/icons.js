/** Ícones de traço (16 px, currentColor) usados nos botões. */
const PATHS = {
  restart: '<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5v3h-3"/>',
  compact: '<path d="M2.5 9.5h4v4M13.5 6.5h-4v-4M6.5 9.5 2 14M9.5 6.5 14 2"/>',
  spanCol: '<rect x="1.5" y="3.5" width="13" height="9" rx="1.5"/><path d="M4.5 8h7M6 6.5 4.5 8 6 9.5M10 6.5 11.5 8 10 9.5"/>',
  spanRow: '<rect x="3.5" y="1.5" width="9" height="13" rx="1.5"/><path d="M8 4.5v7M6.5 6 8 4.5 9.5 6M6.5 10 8 11.5 9.5 10"/>',
  maximize: '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>',
  stop: '<rect x="3.5" y="3.5" width="9" height="9" rx="1.5"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  powershell: '<path d="M3.5 4.5 7.5 8l-4 3.5M8.5 11.5h4"/>',
  bash: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M4.5 6.5 6.5 8l-2 1.5M8 10h3"/>',
  claude: '<path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2"/>',
  plug: '<path d="M6 1.5v3M10 1.5v3M4 4.5h8v3a4 4 0 0 1-8 0zM8 11.5v3"/>',
  home: '<path d="M8 1.5l1.6 4.9 4.9 1.6-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6z"/>',
  workspace: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M8 2.5v11M1.5 8h13"/>',
};

export function icon(name) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`;
  return span;
}
