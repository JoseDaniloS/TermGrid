/* Vídeo de demonstração do TermGrid — UI recriada em HTML + GSAP.
   Uma única timeline mestre (window.TL). Todo estado visual é função do tempo. */
(function () {
  'use strict';
  var CAPTURE = new URLSearchParams(location.search).has('capture');
  var DURATION = 44.5;
  var REELS = new URLSearchParams(location.search).get('fmt') === 'reels';
  var SW = REELS ? 1080 : 1280, AX = 540, AY = 880;
  if (REELS) document.body.className = 'reels';

  /* ---------- utilitários ---------- */
  function h(tag, props) {
    var e = document.createElement(tag);
    props = props || {};
    for (var k in props) {
      if (k === 'class') e.className = props[k];
      else if (k === 'text') e.textContent = props[k];
      else e.setAttribute(k, props[k]);
    }
    (function add(list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c == null) continue;
        if (Array.isArray(c)) add(c);
        else e.append(c.nodeType ? c : document.createTextNode(c));
      }
    })(Array.prototype.slice.call(arguments, 2));
    return e;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rl(A, B, t) { return [lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t), lerp(A[3], B[3], t)]; }
  function rectOf(el) { return el.getBoundingClientRect(); }
  function ctr(el, dx, dy) { var r = rectOf(el); return { x: r.left + r.width / 2 + (dx || 0), y: r.top + r.height / 2 + (dy || 0) }; }
  function $(s) { return document.querySelector(s); }

  var stage = $('#stage'), win = $('#win'), winbody = $('#winbody');
  if (REELS) { stage.style.width = '1080px'; stage.style.height = '1920px'; }
  var cursorEl = $('#cursor'), ripple = $('#ripple');
  var arrowSvg = cursorEl.querySelector('.arrow'), ewSvg = cursorEl.querySelector('.ew'), nsSvg = cursorEl.querySelector('.ns');

  /* ---------- terminal ---------- */
  var BW = 44;
  function padTo(s, n) { while (s.length < n) s += ' '; return s; }
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function L(html, cls) { var d = h('div', { class: 'tl' + (cls ? ' ' + cls : '') }); d.innerHTML = html; return d; }
  function bannerLines(cwd) {
    var top = '╭' + '─'.repeat(BW) + '╮', bot = '╰' + '─'.repeat(BW) + '╯';
    function row(s, welcome) {
      var inner = padTo(s, BW);
      if (welcome) return L('<span class="bd">│</span> <span class="acc" style="display:inline-block;width:1ch;overflow:visible">✻</span> ' + esc(padTo('Welcome to Claude Code!', BW - 3)) + '<span class="bd">│</span>');
      return L('<span class="bd">│</span>' + esc(inner) + '<span class="bd">│</span>');
    }
    return [
      L('<span class="bd">' + top + '</span>'),
      row('', true),
      row(''),
      row('   /help for help, /status for your setup'),
      row(''),
      row('   cwd: ' + cwd),
      L('<span class="bd">' + bot + '</span>')
    ];
  }
  function boxLines() {
    var top = '╭' + '─'.repeat(BW) + '╮', bot = '╰' + '─'.repeat(BW) + '╯';
    return [
      L('<span class="bd">' + top + '</span>'),
      L('<span class="bd">│</span> <span class="acc">&gt;</span> <span class="tcur"></span>' + esc(padTo('', BW - 4)) + '<span class="bd">│</span>'),
      L('<span class="bd">' + bot + '</span>'),
      L('<span class="dim">  ? for shortcuts</span>')
    ];
  }
  function cmdLine(prompt) {
    var typed = h('span');
    var d = L(''); d.append(h('span', { text: prompt }), typed);
    return { el: d, typed: typed };
  }

  /* ---------- peças de UI ---------- */
  function makeTab(label, icon, active) {
    var icon_ = h('span', { class: 'tab-icon', text: icon }), label_ = h('span', { class: 'tab-label', text: label });
    var close = h('button', { class: 'tab-close', title: 'Fechar aba (Ctrl+Shift+W)', text: '✕' });
    var el = h('div', { class: 'tab' + (active ? ' active' : ''), role: 'tab' }, icon_, label_, close);
    return { el: el, icon: icon_, label: label_ };
  }

  function makeMeter(label, pct) {
    var fill = h('span', { class: 'meter-fill' }); fill.style.width = '0%';
    var item = h('span', { class: 'usage-item' }, h('span', { class: 'usage-label', text: label }), h('span', { class: 'meter' }, fill), h('span', { class: 'usage-value', text: pct + '%' }));
    return { item: item, fill: fill, pct: pct };
  }
  function popRow(label, pct, reset) {
    var fill = h('span', { class: 'meter-fill' }); fill.style.width = '0%';
    var el = h('div', { class: 'usage-row' },
      h('div', { class: 'usage-row-top' }, h('span', { text: label }), h('span', { class: 'muted small', text: pct + '% usado' })),
      h('span', { class: 'meter' }, fill),
      h('span', { class: 'muted small', text: reset }));
    return { el: el, fill: fill, pct: pct };
  }

  var m1 = makeMeter('Sessão', 34), m2 = makeMeter('Semana', 12);
  var usageBtn = h('button', { class: 'usage', title: 'Uso do plano Claude' }, m1.item, m2.item);
  var rows = [popRow('Sessão atual (5 h)', 34, 'Redefine em 2 h 41 min'), popRow('Semanal · todos os modelos', 12, 'Redefine sex 09:00'),
    popRow('Semanal · Opus', 8, 'Redefine sex 09:00'), popRow('Semanal · Sonnet', 15, 'Redefine sex 09:00')];
  var popover = h('div', { class: 'usage-popover' },
    h('div', { class: 'usage-head' }, h('strong', { text: 'Uso do plano' })),
    rows.map(function (r) { return r.el; }),
    h('div', { class: 'usage-foot' }, h('span', { class: 'muted small', text: 'Atualizado às 14:32' }), h('button', { class: 'btn', text: 'Atualizar' })));
  popover.style.opacity = '0'; popover.style.visibility = 'hidden';
  var usageWrap = h('div', { class: 'usage-wrap' }, usageBtn, popover);

  var T1 = makeTab('Nova aba', '✦', true), T2 = makeTab('Nova aba', '✦', false);
  T2.el.style.width = '0px'; T2.el.style.minWidth = '0px'; T2.el.style.paddingLeft = '0px'; T2.el.style.paddingRight = '0px'; T2.el.style.opacity = '0';
  var tabAdd = h('button', { class: 'tab-add', title: 'Nova aba (Ctrl+Shift+T)', text: '+' });
  var tabbar = h('header', { class: 'tabbar' }, h('div', { class: 'tabs', role: 'tablist' }, T1.el, T2.el), tabAdd, h('div', { class: 'tabbar-spacer' }), usageWrap);
  var content = h('main', { class: 'content' });
  winbody.append(h('div', { class: 'app' }, tabbar, content));

  /* ---------- tela inicial ---------- */
  function makeHome(meuMeta) {
    var primary = h('button', { class: 'btn primary', text: 'Abrir pasta e iniciar' });
    var chips = ['orquestrador', 'leitor', 'marketing', 'revisor'].map(function (n) { return h('span', { class: 'chip', text: n }); });
    function wsItem(name, folder, meta) {
      var metaEl = h('span', { class: 'ws-meta', text: meta });
      var main = h('button', { class: 'ws-main', title: 'Abrir e retomar as sessões' }, h('span', { class: 'ws-name', text: name }), h('span', { class: 'ws-folder', text: folder }), metaEl);
      return { el: h('div', { class: 'ws-item' }, main, h('button', { class: 'btn', title: 'Abrir com sessões novas dos agentes', text: 'Sessões novas' }), h('button', { class: 'btn danger', title: 'Remover dos workspaces salvos', text: 'Remover' })), main: main, meta: metaEl };
    }
    var meu = wsItem('meu-app', 'C:\\Projetos\\meu-app', meuMeta), api = wsItem('api-loja', 'C:\\Projetos\\api-loja', 'Último acesso: 17/10/2026 · 1 terminal extra');
    var root = h('div', { class: 'home view' }, h('div', { class: 'home-inner' },
      h('h1', { text: 'TermGrid' }),
      h('p', { class: 'subtitle', text: 'Terminais PowerShell e Claude Code em grid, com workspaces salvos.' }),
      h('section', { class: 'card' }, h('h2', { text: 'Novo workspace' }),
        h('p', { class: 'muted', text: 'Escolha uma pasta: os agentes da pasta AgentesClaude abrem nela automaticamente.' }),
        h('div', { class: 'row' }, primary, h('label', { class: 'check' }, h('input', { type: 'checkbox' }), h('span', { text: 'Iniciar com sessões novas' })))),
      h('section', { class: 'card' }, h('h2', { text: 'Agentes (AgentesClaude)' }),
        h('div', { class: 'agents-info' }, h('span', { class: 'agents-path', text: 'C:\\Projetos\\AgentesClaude' }), h('button', { class: 'btn', text: 'Alterar' }), h('div', { class: 'chips' }, chips))),
      h('section', { class: 'card' }, h('h2', { text: 'Workspaces salvos' }), h('div', { class: 'ws-list' }, meu.el, api.el))));
    return { root: root, primary: primary, chip0: chips[0], meu: meu, api: api };
  }

  /* ---------- workspace ---------- */
  var ROLES = ['orquestrador', 'leitor', 'marketing', 'revisor'];
  var RESUMED = {
    orquestrador: ['> distribuir as tarefas da semana', '● Tarefas enviadas aos agentes.'],
    leitor: ['> mapear as rotas de pedidos', '● Rotas de pedidos mapeadas.'],
    marketing: ['> escrever o texto do checkout', '● Texto do checkout pronto.'],
    revisor: ['> revisar o PR de frete', '● Revisão concluída, sem bloqueios.']
  };
  function iconBtn(txt, title, danger) { return h('button', { class: 'icon-btn' + (danger ? ' danger' : ''), title: title, text: txt }); }

  function makeWorkspace(cwd, resumed) {
    var ws = { cwd: cwd, panes: [], S: { c: 0.5, r: 0.5, cB: 1 / 3, rB: 0.5, blend: resumed ? 1 : 0, maxP: 0, maxId: -1, gapp: resumed ? 1 : 0 } };
    var mcpBtn = h('button', { class: 'btn', title: 'Servidores MCP globais, locais e do projeto', text: 'MCPs' });
    var btnPS = h('button', { class: 'btn', text: '+ PowerShell' });
    var toolbar = h('div', { class: 'toolbar' }, h('span', { class: 'toolbar-path', text: cwd }), h('div', { class: 'toolbar-spacer' }), btnPS, h('button', { class: 'btn', text: '+ Bash (WSL)' }), h('button', { class: 'btn', text: '+ Claude Code' }), mcpBtn);
    var grid = h('div', { class: 'grid' });
    ws.root = h('div', { class: 'workspace view' }, toolbar, grid);
    ws.grid = grid; ws.btnPS = btnPS; ws.mcpBtn = mcpBtn;
    ws.gCol1 = h('div', { class: 'gutter gutter-col' }); ws.gRow = h('div', { class: 'gutter gutter-row' }); ws.gCol2 = h('div', { class: 'gutter gutter-col' });
    grid.append(ws.gCol1, ws.gRow, ws.gCol2);

    function pane(title, badge, extra) {
      var p = { appear: resumed ? 0 : 0, lines: {} };
      p.status = h('span', { class: 'pane-status', 'data-state': resumed ? 'running' : 'connecting' });
      p.maxBtn = iconBtn('⛶', 'Maximizar / restaurar');
      var actions = h('div', { class: 'pane-actions' }, iconBtn('↻', 'Reiniciar terminal'), p.maxBtn);
      if (extra) actions.append(iconBtn('✕', 'Fechar terminal', true));
      p.term = h('div', { class: 'term' });
      p.el = h('section', { class: 'pane' },
        h('div', { class: 'pane-header' }, p.status, h('span', { class: 'pane-badge', text: badge }), h('span', { class: 'pane-title', text: title }), actions),
        h('div', { class: 'pane-body' }, h('div', { class: 'xterm' }, p.term)));
      p.el.style.opacity = '0';
      grid.append(p.el);
      return p;
    }
    ROLES.forEach(function (role) {
      var p = pane(role, 'AG', false);
      p.cmd = cmdLine('PS ' + cwd + '> '); if (resumed) p.cmd.typed.textContent = 'claude --continue';
      p.banner = bannerLines(cwd); p.box = boxLines(); p.extra = [];
      p.term.append(p.cmd.el);
      p.banner.forEach(function (l) { p.term.append(l); });
      if (resumed) {
        var rs = RESUMED[role];
        p.extra = [L('<span class="acc">' + esc(rs[0]) + '</span>'), L(esc(rs[1])), L('')];
        p.extra.forEach(function (l) { p.term.append(l); });
      }
      p.box.forEach(function (l) { p.term.append(l); });
      ws.panes.push(p);
    });
    var ps = pane('PowerShell', 'PS', true);
    ps.head = [L('Windows PowerShell'), L('Copyright (C) Microsoft Corporation. Todos os direitos reservados.'), L('')];
    ps.cmd = cmdLine('PS ' + cwd + '> ');
    ps.out = [L('On branch main'), L('nothing to commit, working tree clean'), L('')];
    ps.prompt2 = L(esc('PS ' + cwd + '> ') + '<span class="tcur"></span>');
    ps.head.forEach(function (l) { ps.term.append(l); });
    ps.term.append(ps.cmd.el);
    ps.out.forEach(function (l) { ps.term.append(l); });
    ps.term.append(ps.prompt2);
    ws.panes.push(ps);
    ws.ps = ps;
    return ws;
  }

  /* ---------- montagem ---------- */
  var home1 = makeHome('Último acesso: 18/10/2026'), home2 = makeHome('Último acesso: 19/10/2026 · 1 terminal extra');
  var ws1 = makeWorkspace('C:\\Projetos\\meu-app', false), ws2 = makeWorkspace('C:\\Projetos\\api-loja', true);
  [home1, ws1, home2, ws2].forEach(function (v) { content.append(v.root); });
  [ws1, home2, ws2].forEach(function (v) { v.root.style.opacity = '0'; v.root.style.visibility = 'hidden'; });

  // resumed: conteúdo já visível, painéis aparecem escalonados
  ws2.panes.forEach(function (p) {
    p.term.querySelectorAll('.tl').forEach(function (l) { l.style.display = 'block'; });
  });
  ws2.panes[4].status.setAttribute('data-state', 'running');
  ws2.panes[4].prompt2.innerHTML = esc('PS C:\\Projetos\\api-loja> ') + '<span class="tcur"></span>';
  ws2.panes[4].out.forEach(function (l) { l.style.display = 'none'; });
  ws2.panes[4].cmd.el.style.display = 'none';
  ws2.panes[4].head.forEach(function (l) { l.style.display = 'block'; });
  ws2.panes[4].cmd.el.style.display = 'block';
  ws2.panes[4].cmd.typed.textContent = 'npm test';
  ws2.panes[4].out[0].textContent = 'Todos os testes passaram.'; ws2.panes[4].out[0].style.display = 'block';
  ws2.panes[4].out[1].style.display = 'none'; ws2.panes[4].out[2].style.display = 'block';

  // dimensões do grid (medidas uma vez; iguais para os dois workspaces)
  ws1.root.style.visibility = 'hidden';
  var GW = ws1.grid.clientWidth, GH = ws1.grid.clientHeight;

  /* ---------- render determinístico do grid ---------- */
  var G = 6, X0 = 6, Y0 = 6;
  function render(ws) {
    var S = ws.S, iw = GW - 12, ih = GH - 12;
    var cw1 = (iw - G) * S.c, cw2 = iw - G - cw1, rh1 = (ih - G) * S.r, rh2 = ih - G - rh1;
    var A = [[X0, Y0, cw1, rh1], [X0 + cw1 + G, Y0, cw2, rh1], [X0, Y0 + rh1 + G, cw1, rh2], [X0 + cw1 + G, Y0 + rh1 + G, cw2, rh2]];
    var gA = [[X0 + cw1, Y0, G, ih], [X0, Y0 + rh1, iw, G]];
    var w1 = (iw - 2 * G) * S.cB, w2 = (iw - 2 * G - w1) / 2, rb1 = (ih - G) * S.rB, rb2 = ih - G - rb1;
    var B = [[X0, Y0, w1, rb1], [X0 + w1 + G, Y0, w2, rb1], [X0 + w1 + w2 + 2 * G, Y0, w2, rb1], [X0, Y0 + rb1 + G, w1, rb2], [X0 + w1 + G, Y0 + rb1 + G, 2 * w2 + G, rb2]];
    var gB = [[X0 + w1, Y0, G, ih], [X0, Y0 + rb1, iw, G], [X0 + w1 + G + w2, Y0, G, rb1]];
    var full = [X0, Y0, iw, ih], mx = S.maxId >= 0;
    ws.panes.forEach(function (p, i) {
      var r = i < 4 ? rl(A[i], B[i], S.blend) : B[i];
      var op = (i === 4 ? S.blend : 1) * p.appear;
      if (mx && S.maxId === i) r = rl(r, full, S.maxP);
      else if (mx) op *= 1 - S.maxP;
      var st = p.el.style;
      st.left = Math.round(r[0]) + 'px'; st.top = Math.round(r[1]) + 'px'; st.width = Math.round(r[2]) + 'px'; st.height = Math.round(r[3]) + 'px';
      st.opacity = String(op); st.zIndex = (mx && S.maxId === i) ? 5 : 1;
      st.transform = 'translateY(' + ((1 - p.appear) * 14).toFixed(2) + 'px)';
      st.visibility = op > 0.001 ? 'visible' : 'hidden';
    });
    var gs = [[ws.gCol1, rl(gA[0], gB[0], S.blend), 1], [ws.gRow, rl(gA[1], gB[1], S.blend), 1], [ws.gCol2, gB[2], S.blend]];
    gs.forEach(function (g) {
      var st = g[0].style, r = g[1], op = g[2] * S.gapp * (mx ? 1 - S.maxP : 1);
      st.left = Math.round(r[0]) + 'px'; st.top = Math.round(r[1]) + 'px'; st.width = Math.round(r[2]) + 'px'; st.height = Math.round(r[3]) + 'px';
      st.opacity = String(op); st.visibility = op > 0.001 ? 'visible' : 'hidden';
    });
  }

  /* ---------- cursor ---------- */
  var cur = REELS ? { x: 900, y: 1050 } : { x: 980, y: 610 }, follow = null;
  var cam = { s: 0.9, fx: 600, fy: 358 };
  function renderCam() {
    var s = cam.s, halfW = (SW / 2) / s, fx = cam.fx;
    if (halfW < 600) fx = Math.max(halfW - 20, Math.min(1220 - halfW, fx));
    win.style.transform = 'translate(' + (AX - fx * s).toFixed(2) + 'px,' + (AY - cam.fy * s).toFixed(2) + 'px) scale(' + s.toFixed(4) + ')';
  }
  var CUES = []; window.CUES = CUES;
  function cue(t, type, dur, n) { CUES.push({ t: t, type: type, dur: dur || 0, n: n || 0 }); }
  function renderAll() {
    render(ws1); render(ws2);
    if (follow) follow();
    if (REELS) renderCam();
    cursorEl.style.transform = 'translate(' + cur.x.toFixed(1) + 'px,' + cur.y.toFixed(1) + 'px)' + (REELS ? ' scale(1.5)' : '');
  }

  /* ---------- timeline ---------- */
  var tl = gsap.timeline({ paused: CAPTURE, defaults: { ease: 'power3.out' } });
  window.TL = tl;
  tl.eventCallback('onUpdate', renderAll);
  renderAll();

  function cls(el, t, add, rem) {
    tl.call(function () { if (rem) el.classList.remove(rem); if (add) el.classList.add(add); }, null, t);
  }
  function show(el, t) { tl.set(el, { display: 'block' }, t); }
  function showAll(list, t) { list.forEach(function (l) { show(l, t); }); }
  function type(el, text, t, dur) {
    cue(t, 'keys', dur, text.length);
    var o = { p: 0 };
    tl.to(o, { p: 1, duration: dur, ease: 'none', onUpdate: function () { el.textContent = text.slice(0, Math.round(o.p * text.length)); } }, t);
  }
  function move(t, dur, to, ease) {
    var o = { p: 0 }, from = null, d0 = null;
    tl.to(o, {
      p: 1, duration: dur, ease: ease || 'power2.inOut',
      onStart: function () { from = { x: cur.x, y: cur.y }; },
      onUpdate: function () {
        if (!from) from = { x: cur.x, y: cur.y };
        var d = to(), dx = d.x - from.x, dy = d.y - from.y, len = Math.sqrt(dx * dx + dy * dy);
        var arc = Math.sin(Math.PI * o.p) * len * 0.05;
        cur.x = from.x + dx * o.p + (dy / (len || 1)) * arc * -1;
        cur.y = from.y + dy * o.p + (dx / (len || 1)) * arc;
      }
    }, t);
  }
  function click(t) {
    cue(t, 'click');
    tl.fromTo(arrowSvg, { scale: 1 }, { scale: 0.8, transformOrigin: '0 0', duration: 0.09, yoyo: true, repeat: 1, ease: 'power1.inOut', immediateRender: false }, t);
    var o = { p: 0 };
    tl.to(o, {
      p: 1, duration: 0.55, ease: 'power2.out',
      onStart: function () { ripple.style.left = cur.x + 'px'; ripple.style.top = cur.y + 'px'; },
      onUpdate: function () { gsap.set(ripple, { scale: 0.3 + 1.2 * o.p, opacity: 0.75 * (1 - o.p) }); }
    }, t);
  }
  function cmode(t, m) {
    tl.set(arrowSvg, { opacity: m === 'arrow' ? 1 : 0 }, t);
    tl.set(ewSvg, { opacity: m === 'ew' ? 1 : 0 }, t);
    tl.set(nsSvg, { opacity: m === 'ns' ? 1 : 0 }, t);
  }
  function status(p, t, st) { tl.set(p.status, { attr: { 'data-state': st } }, t); }

  /* legendas */
  var capsEl = $('#caps');
  function cap(t0, t1, text) {
    var el = h('div', { class: 'cap' });
    text.split(' ').forEach(function (w) { el.append(h('span', { class: 'w', text: w })); });
    capsEl.append(el);
    var ws_ = el.querySelectorAll('.w');
    cue(t0, 'tick');
    tl.set(el, { opacity: 1 }, t0);
    tl.fromTo(ws_, { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: 'expo.out', stagger: 0.07, immediateRender: false }, t0);
    tl.to(el, { opacity: 0, duration: 0.35, ease: 'power1.in' }, t1 - 0.35);
  }
  var kbdEl = $('#kbd');
  function kbd(t0, t1, keys) {
    var el = h('div', { class: 'kbdc' });
    el.style.cssText = 'position:absolute;right:0;top:0;display:flex;align-items:center;gap:8px;color:#8a8fa8;opacity:0;font-size:14px;white-space:nowrap';
    keys.forEach(function (k, i) { if (i) el.append(h('span', { text: '+' })); el.append(h('kbd', { text: k })); });
    kbdEl.append(el);
    tl.fromTo(el, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.35, immediateRender: false }, t0);
    tl.to(el, { opacity: 0, duration: 0.3 }, t1);
  }
  function camS(t, dur, sc, fx, fy) { if (REELS) tl.to(cam, { s: sc, fx: fx, fy: fy, duration: dur, ease: 'power3.inOut' }, t); }
  function viewSwap(out, inn, t, dur) {
    out.forEach(function (v) { tl.to(v.root, { autoAlpha: 0, duration: dur || 0.3, ease: 'power1.inOut' }, t); });
    inn.forEach(function (v) { tl.to(v.root, { autoAlpha: 1, duration: dur || 0.3, ease: 'power1.inOut' }, t); });
  }

  // pulsos globais (cursor de texto e status "conectando"), finitos para caber na timeline
  tl.fromTo(document.documentElement, { '--pulse': 1 }, { '--pulse': 0.35, duration: 0.6, ease: 'sine.inOut', repeat: Math.floor(DURATION / 0.6) - 2, yoyo: true, immediateRender: false }, 0);
  tl.fromTo(document.documentElement, { '--blink': 1 }, { '--blink': 0, duration: 0.01, ease: 'none', repeat: Math.floor(DURATION / 1.1) - 2, repeatDelay: 0.55, yoyo: true, immediateRender: false }, 0);

  gsap.set(win, { opacity: 0 });
  gsap.set(arrowSvg, { opacity: 1 }); gsap.set([ewSvg, nsSvg], { opacity: 0 });
  gsap.set(ripple, { opacity: 0 });

  /* ===== CENA 1 — tela inicial (0–5) ===== */
  if (REELS) tl.fromTo(win, { opacity: 0 }, { opacity: 1, duration: 1.1, ease: 'power2.out', immediateRender: false }, 0);
  else tl.fromTo(win, { opacity: 0, scale: 0.965, y: 14 }, { opacity: 1, scale: 1, y: 0, duration: 1.3, ease: 'expo.out', immediateRender: false }, 0);
  cue(0.0, 'whoosh', 1.0); cue(0.6, 'open');
  tl.to(m1.fill, { width: '34%', duration: 1.2 }, 0.5);
  tl.to(m2.fill, { width: '12%', duration: 1.2 }, 0.6);
  cap(0.9, 4.7, 'Tudo começa pela pasta do projeto');
  tl.to(cursorEl, { opacity: 1, duration: 0.4 }, 1.0);
  move(1.2, 0.9, function () { return ctr(home1.chip0); });
  move(2.3, 0.8, function () { return ctr(home1.meu.main, 60, 0); });
  cls(home1.meu.main, 3.1, 'fh'); cls(home1.meu.main, 3.5, null, 'fh');
  move(3.4, 1.1, function () { return ctr(home1.primary, 8, 2); });
  cls(home1.primary, 4.5, 'fh');
  click(4.85);

  camS(4.9, 1.2, 1.2, 600, 400);
  camS(11.8, 0.9, 1.25, 600, 430);
  camS(18.3, 0.9, 1.15, 600, 400);
  camS(23.1, 0.8, 1.4, 390, 170);
  camS(23.7, 0.9, 1.3, 600, 470);
  camS(25.4, 0.9, 1.15, 600, 400);
  camS(28.4, 0.7, 1.15, 600, 358);
  camS(32.1, 0.9, 1.8, 960, 250);
  camS(35.7, 0.9, 1.2, 600, 358);
  /* ===== CENA 2 — workspace sobe (5–12) ===== */
  viewSwap([home1], [ws1], 5.0, 0.4);
  cls(home1.primary, 5.2, null, 'fh');
  tl.call(function () { T1.label.textContent = 'meu-app'; T1.icon.textContent = '▦'; }, null, 5.0);
  cap(5.6, 11.4, 'Os agentes abrem sozinhos');
  tl.to(ws1.S, { gapp: 1, duration: 0.6 }, 5.2);
  ws1.panes.slice(0, 4).forEach(function (p, i) {
    var b = 5.2 + i * 0.18;
    tl.to(p, { appear: 1, duration: 0.6 }, b); cue(b, 'pop');
    show(p.cmd.el, b + 0.45); type(p.cmd.typed, 'claude', b + 0.5, 0.4);
    showAll(p.banner, b + 1.3);
    showAll(p.box, b + 1.7);
    status(p, b + 2.1 + i * 0.12, 'running');
  });
  move(5.6, 1.6, function () { var r = rectOf(ws1.grid); return { x: r.left + r.width * 0.78, y: r.top + r.height * 0.8 }; });
  move(9.6, 1.8, function () { var r = rectOf(ws1.gCol1); return { x: r.left + r.width / 2, y: r.top + r.height * 0.28 }; });

  /* ===== CENA 3 — redimensionar (12–18.3) ===== */
  cap(12.0, 18.2, 'Terminais em grid redimensionável');
  cmode(11.8, 'ew'); cls(ws1.gCol1, 11.9, 'fh');
  tl.call(function () {
    follow = function () { var r = rectOf(ws1.gCol1); cur.x = r.left + r.width / 2; cur.y = r.top + r.height * 0.28; };
  }, null, 12.0);
  cue(12.0, 'drag', 3.2);
  tl.to(ws1.S, { c: 0.37, duration: 1.1, ease: 'power2.inOut' }, 12.0);
  tl.to(ws1.S, { c: 0.62, duration: 1.2, ease: 'power2.inOut' }, 13.2);
  tl.to(ws1.S, { c: 0.5, duration: 0.7, ease: 'power2.inOut' }, 14.5);
  tl.call(function () { follow = null; }, null, 15.25);
  cls(ws1.gCol1, 15.25, null, 'fh'); cmode(15.25, 'arrow');
  move(15.3, 0.6, function () { var r = rectOf(ws1.gRow); return { x: r.left + r.width * 0.2, y: r.top + r.height / 2 }; });
  cmode(15.9, 'ns'); cls(ws1.gRow, 15.95, 'fh');
  tl.call(function () {
    follow = function () { var r = rectOf(ws1.gRow); cur.x = r.left + r.width * 0.2; cur.y = r.top + r.height / 2; };
  }, null, 16.0);
  cue(16.0, 'drag', 2.4);
  tl.to(ws1.S, { r: 0.4, duration: 0.8, ease: 'power2.inOut' }, 16.0);
  tl.to(ws1.S, { r: 0.6, duration: 0.9, ease: 'power2.inOut' }, 16.9);
  tl.to(ws1.S, { r: 0.5, duration: 0.5, ease: 'power2.inOut' }, 17.9);
  tl.call(function () { follow = null; }, null, 18.4);
  cls(ws1.gRow, 18.4, null, 'fh'); cmode(18.4, 'arrow');

  /* ===== CENA 4 — + PowerShell (18.4–23) ===== */
  move(18.45, 0.85, function () { return ctr(ws1.btnPS); });
  cls(ws1.btnPS, 19.3, 'fh');
  click(19.6);
  cap(19.0, 23.2, 'Adicione PowerShell, Bash (WSL) ou Claude Code');
  cue(19.7, 'whoosh', 1.1); cue(20.1, 'pop');
  tl.to(ws1.S, { blend: 1, duration: 1.1, ease: 'power3.inOut' }, 19.7);
  cls(ws1.btnPS, 20.2, null, 'fh');
  var ps = ws1.ps; ps.appear = 1;
  showAll(ps.head, 19.8); show(ps.cmd.el, 19.8);
  status(ps, 20.6, 'running');
  type(ps.cmd.typed, 'git status', 21.2, 0.6);
  showAll(ps.out, 22.0); show(ps.prompt2, 22.1);
  move(22.2, 0.9, function () { return ctr(tabAdd); });

  /* ===== CENA 5 — abas (23.2–29) ===== */
  cls(tabAdd, 23.2, 'fh');
  click(23.4);
  cap(23.5, 26.0, 'Abas como no navegador');
  cls(T1.el, 23.45, null, 'active'); cls(T2.el, 23.45, 'active');
  tl.to(T2.el, { width: 200, minWidth: 110, paddingLeft: 12, paddingRight: 6, opacity: 1, duration: 0.45, ease: 'power3.out' }, 23.4);
  viewSwap([ws1], [home2], 23.45, 0.3); cue(23.45, 'tab'); cue(23.45, 'pop');
  cls(tabAdd, 23.9, null, 'fh');
  move(23.8, 1.1, function () { return ctr(home2.api.main, 40, 0); });
  cls(home2.api.main, 24.9, 'fh');
  click(25.4);
  tl.call(function () { T2.label.textContent = 'api-loja'; T2.icon.textContent = '▦'; }, null, 25.5);
  viewSwap([home2], [ws2], 25.5, 0.35); cue(25.5, 'tab');
  cls(home2.api.main, 25.7, null, 'fh');
  ws2.panes.forEach(function (p, i) { tl.to(p, { appear: 1, duration: 0.6 }, 25.55 + i * 0.12); cue(25.55 + i * 0.12, 'pop'); });
  cap(26.2, 29.0, 'Workspaces salvos com sessões retomadas');
  kbd(28.0, 29.1, ['Ctrl', 'Tab']);
  cls(T2.el, 28.5, null, 'active'); cls(T1.el, 28.5, 'active');
  viewSwap([ws2], [ws1], 28.5, 0.3); cue(28.5, 'tab');

  /* ===== CENA 5b — maximizar (29–32.6) ===== */
  cap(29.2, 32.6, 'Maximize qualquer painel');
  move(28.9, 1.0, function () { return ctr(ws1.panes[2].maxBtn); });
  cls(ws1.panes[2].maxBtn, 29.9, 'fh');
  click(30.2);
  tl.call(function () { ws1.S.maxId = 2; }, null, 30.15);
  cue(30.2, 'whoosh', 0.6);
  tl.to(ws1.S, { maxP: 1, duration: 0.65, ease: 'power3.inOut' }, 30.2);
  move(31.0, 0.5, function () { return ctr(ws1.panes[2].maxBtn); });
  click(31.7);
  cue(31.7, 'whoosh', 0.6);
  tl.to(ws1.S, { maxP: 0, duration: 0.65, ease: 'power3.inOut' }, 31.7);
  cls(ws1.panes[2].maxBtn, 32.0, null, 'fh');

  /* ===== CENA 6 — uso do plano (32.4–36.2) ===== */
  move(32.3, 0.9, function () { return ctr(usageBtn); });
  cls(usageBtn, 33.2, 'fh');
  click(33.55);
  cap(33.0, 36.2, 'Acompanhe o uso do plano Claude');
  cue(33.6, 'open'); cue(35.6, 'close');
  tl.fromTo(popover, { autoAlpha: 0, y: -6 }, { autoAlpha: 1, y: 0, duration: 0.35, immediateRender: false }, 33.6);
  rows.forEach(function (r, i) { tl.fromTo(r.fill, { width: '0%' }, { width: r.pct + '%', duration: 0.9, immediateRender: false }, 33.75 + i * 0.1); });
  click(35.55);
  tl.to(popover, { autoAlpha: 0, y: -6, duration: 0.3, ease: 'power2.in' }, 35.6);
  cls(usageBtn, 35.9, null, 'fh');

  /* ===== CENA 7 — MCPs (35.9–40.4) ===== */
  move(35.7, 0.9, function () { return ctr(ws1.mcpBtn); });
  cls(ws1.mcpBtn, 36.5, 'fh');
  click(36.85);
  function mcpRow(name, badge, target, st, stCls) {
    return h('div', { class: 'mcp-row' }, h('span', { class: 'mcp-name', text: name }), h('span', { class: 'pane-badge', text: badge }), h('span', { class: 'mcp-target', text: target }), h('span', { class: 'status-pill ' + stCls, text: st }));
  }
  function mcpGroup(label, count, hint, rowsEls) {
    return h('section', { class: 'mcp-group' }, h('h3', null, label, h('span', { class: 'mcp-count', text: count }), h('span', { class: 'mcp-hint', text: hint })), rowsEls);
  }
  var spinner = h('div', { class: 'spinner' });
  var loading = h('div', { class: 'mcp-loading' }, spinner, h('span', { text: 'Verificando conexões com "claude mcp list"…' }));
  var list = h('div', { class: 'mcp-list' },
    mcpGroup('Global (usuário)', '2', '~/.claude.json', [mcpRow('docs-locais', 'stdio', 'node C:\\Projetos\\mcp\\docs-locais.js', 'Conectado', 'ok'), mcpRow('banco-de-testes', 'stdio', 'node C:\\Projetos\\mcp\\banco.js', 'Conectado', 'ok')]),
    mcpGroup('Conectores claude.ai', '2', 'conta Claude', [mcpRow('Agenda', 'http', 'conector da conta Claude', 'Conectado', 'ok'), mcpRow('Documentos', 'http', 'conector da conta Claude', 'Requer autenticação', 'warn')]),
    mcpGroup('Plugins', '1', '~/.claude/plugins', [mcpRow('plugin-exemplo', 'http', 'fornecido pelo plugin', 'Conectado', 'ok')]));
  list.style.cssText = 'display:flex;flex-direction:column;gap:16px';
  var mcpBody = h('div', { class: 'mcp' }, loading, list);
  list.style.opacity = '0'; list.style.display = 'none';
  var overlay = h('div', { class: 'modal-overlay' }, h('div', { class: 'modal', role: 'dialog' },
    h('div', { class: 'modal-header' }, h('h2', { text: 'Servidores MCP' }), h('div', { class: 'modal-actions' }, h('button', { class: 'btn', text: 'Atualizar' })), h('button', { class: 'icon-btn', title: 'Fechar (Esc)', text: '✕' })),
    h('div', { class: 'modal-body' }, mcpBody)));
  winbody.append(overlay);
  gsap.set(overlay, { autoAlpha: 0 });
  cap(37.3, 40.2, 'Veja o status dos servidores MCP');
  cue(36.9, 'open'); cue(40.35, 'close');
  tl.to(overlay, { autoAlpha: 1, duration: 0.3 }, 36.9);
  tl.fromTo(overlay.firstChild, { y: 12, scale: 0.985 }, { y: 0, scale: 1, duration: 0.45, immediateRender: false }, 36.9);
  tl.fromTo(spinner, { rotation: 0 }, { rotation: 720, duration: 1.0, ease: 'none', immediateRender: false }, 36.9);
  tl.set(loading, { display: 'none' }, 37.9);
  tl.set(list, { display: 'flex' }, 37.9);
  tl.fromTo(list, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.5, immediateRender: false }, 37.9);
  cls(ws1.mcpBtn, 37.2, null, 'fh');
  kbd(40.0, 40.7, ['Esc']);
  tl.to(overlay, { autoAlpha: 0, duration: 0.3 }, 40.35);
  tl.to(cursorEl, { opacity: 0, duration: 0.3 }, 40.3);

  /* ===== CENA 8 — encerramento (40.5–44.5) ===== */
  cue(39.6, 'riser', 0.9); cue(40.55, 'whoosh', 0.9); cue(41.25, 'impact'); cue(41.3, 'shimmer'); cue(41.6, 'text'); cue(42.5, 'pop');
  if (REELS) tl.to(win, { opacity: 0, duration: 0.9, ease: 'power2.inOut' }, 40.55);
  else tl.to(win, { opacity: 0, scale: 0.94, duration: 0.9, ease: 'power2.inOut' }, 40.55);
  var outro = $('#outro'), outroT = $('#outro-t'), outroU = $('#outro-u'), outroImg = outro.querySelector('img');
  'TermGrid — terminais Claude Code em grid'.split(' ').forEach(function (w, i, a) { outroT.append(h('span', { class: 'ow', text: w }), i < a.length - 1 ? ' ' : ''); });
  outroT.querySelectorAll('.ow').forEach(function (e) { e.style.display = 'inline-block'; });
  tl.set(outro, { opacity: 1 }, 41.2);
  tl.fromTo(outroImg, { opacity: 0, scale: 0.88, y: 10 }, { opacity: 1, scale: 1, y: 0, duration: 1.0, ease: 'expo.out', immediateRender: false }, 41.25);
  tl.fromTo(outroT.querySelectorAll('.ow'), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.8, ease: 'expo.out', stagger: 0.1, immediateRender: false }, 41.6);
  tl.fromTo(outroU, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.8, ease: 'expo.out', immediateRender: false }, 42.5);
  gsap.set([outroImg, outroT.querySelectorAll('.ow'), outroU], { opacity: 0 });

  tl.set({}, {}, DURATION);
  renderAll();
})();
