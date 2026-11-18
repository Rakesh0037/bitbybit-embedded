/* "A task's home in memory": one FreeRTOS task, followed shelf by shelf.
 * Same step engine as the other story lessons: every step picks a view and
 * its settings; Next animates (t goes 0 → 1), Back jumps.
 * URL: ?step=N opens step N, ?video shows only the scene (?ch=…&end=…&speed=…). */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => t * t * (3 - 2 * t);

  const CH = ['One new task', 'The memory cupboard', 'Build time: the linker', 'Run time: FreeRTOS', 'Inside the stack', 'The missing 8 bytes'];
  const KIND = { problem: ['😟', 'PROBLEM'], idea: ['💡', 'IDEA'], win: ['🎉', 'FOUND IT'] };

  /* ------------------------------------------------------------ materials */
  const DEFS = `<defs>
    <linearGradient id="wood" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6e4120"/><stop offset=".18" stop-color="#94602f"/><stop offset=".45" stop-color="#7f4f27"/><stop offset=".7" stop-color="#9d6837"/><stop offset="1" stop-color="#6b3f1f"/></linearGradient>
    <linearGradient id="woodV" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9824b"/><stop offset=".5" stop-color="#9a6634"/><stop offset="1" stop-color="#6f441f"/></linearGradient>
    <linearGradient id="back" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2f1d0e"/><stop offset=".5" stop-color="#47301a"/><stop offset="1" stop-color="#2f1d0e"/></linearGradient>
    <pattern id="grain" width="140" height="16" patternUnits="userSpaceOnUse"><path d="M0 4 C35 1 70 7 140 3 M0 10 C40 13 90 7 140 11 M0 14.5 C50 12 95 16 140 13.5" stroke="rgba(40,18,4,.28)" stroke-width="1" fill="none"/></pattern>
    <linearGradient id="brass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbeaa0"/><stop offset=".45" stop-color="#d8b04a"/><stop offset="1" stop-color="#9c7a1c"/></linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgba(210,235,255,.42)"/><stop offset=".5" stop-color="rgba(255,255,255,.08)"/><stop offset="1" stop-color="rgba(190,220,250,.30)"/></linearGradient>
    <linearGradient id="steel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3e8ee"/><stop offset="1" stop-color="#9aa6b4"/></linearGradient>
    <pattern id="hatchRed" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="#f6c9c2"/><line x1="0" y1="0" x2="0" y2="7" stroke="#c0392b" stroke-width="2.2"/></pattern>
    <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="#d9d4cc"/><line x1="0" y1="0" x2="0" y2="7" stroke="#8b8378" stroke-width="2.2"/></pattern>
    <pattern id="a5" width="44" height="14" patternUnits="userSpaceOnUse"><rect width="44" height="14" fill="#e4eaf1"/><text x="3" y="10.5" font-size="8.5" fill="#9aa8b8" font-family="monospace">A5 A5</text></pattern>
    <pattern id="zeros" width="44" height="14" patternUnits="userSpaceOnUse"><rect width="44" height="14" fill="#e6d3b0"/><text x="3" y="10.5" font-size="8.5" fill="#b49a6c" font-family="monospace">00 00</text></pattern>
    <pattern id="ff" width="44" height="14" patternUnits="userSpaceOnUse"><text x="3" y="10.5" font-size="8.5" fill="rgba(240,225,200,.25)" font-family="monospace">FF FF</text></pattern>
    <pattern id="stripe" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><rect width="16" height="16" fill="#d6ab6e"/><rect width="16" height="3" fill="#c39557"/></pattern>
    <filter id="soft" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation=".8" flood-opacity=".35"/></filter>
    <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#d97706"/></marker>
    <marker id="arrBad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#dc2626"/></marker>
    <marker id="arrOk" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#16a34a"/></marker>
  </defs>`;

  /* ------------------------------------------------------------ helpers */
  function cabinet(x, y, w, h, plate) {
    const pw = Math.min(w - 40, 420);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="url(#wood)"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="url(#grain)"/>
      <rect x="${x + 12}" y="${y + 26}" width="${w - 24}" height="${h - 38}" fill="url(#back)" stroke="rgba(0,0,0,.6)" stroke-width="2"/>
      <rect x="${x + w / 2 - pw / 2}" y="${y + 5}" width="${pw}" height="17" rx="3" fill="url(#brass)" stroke="#7a5c10"/>
      <text x="${x + w / 2}" y="${y + 17.5}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#3d2b05">${esc(plate)}</text>`;
  }
  /* one box sitting on a shelf board */
  function item(x, y, w, h, fill, label, right, o = {}) {
    let s = `<g opacity="${o.op === undefined ? 1 : o.op}" ${o.tx ? `transform="translate(${o.tx} 0)"` : ''}>`;
    if (fill === 'none') s += `<rect x="${x + 3}" y="${y + 2}" width="${w - 6}" height="${Math.max(2, h - 5)}" rx="4" fill="rgba(255,255,255,.03)" stroke="rgba(255,235,205,.3)" stroke-dasharray="5 4"/>`;
    else s += `<rect x="${x + 3}" y="${y + 2}" width="${w - 6}" height="${Math.max(2, h - 5)}" rx="4" fill="${fill}" class="box" filter="url(#soft)"/>`;
    if (o.card && h > 20) s += `<rect x="${x + 3}" y="${y + 2}" width="${w - 6}" height="7" rx="3" fill="#0e7490"/><circle cx="${x + 20}" cy="${y + h / 2 + 2}" r="${Math.min(8, h / 4)}" fill="#cbd5e1"/>`;
    if (o.hl) s += `<rect x="${x + 1}" y="${y}" width="${w - 2}" height="${h - 1}" rx="5" class="focus"/>`;
    if (!o.noboard) s += `<rect x="${x - 1}" y="${y + h - 3}" width="${w + 2}" height="4" fill="url(#woodV)"/>`;
    if (h >= 14 && label) {
      const fs = o.fs || (h >= 28 ? 13 : 11);
      const dark = fill === 'none' || fill === 'url(#ff)';
      const cls = dark ? '' : (o.light ? 'inkw' : 'ink lbl');
      const style = dark ? 'style="fill:#f1e3cc"' : '';
      const ty = o.top ? y + 20 : y + h / 2 + fs / 2 - 2 - (o.sub && h >= 40 ? 7 : 0);
      s += `<text x="${x + (o.card ? 36 : 12)}" y="${ty}" font-size="${fs}" font-weight="650" class="${cls}" ${style}>${esc(label)}</text>`;
      if (right) s += `<text x="${x + w - 10}" y="${o.top ? y + 20 : y + h / 2 + 4}" font-size="11" text-anchor="end" class="mn ${cls}" ${style}>${esc(right)}</text>`;
      if (o.sub && h >= 40) s += `<text x="${x + (o.card ? 36 : 12)}" y="${ty + 16}" font-size="11" class="${cls}" ${style}>${esc(o.sub)}</text>`;
    }
    return s + '</g>';
  }
  function lines(x, y, arr, o = {}) {
    return arr.map((l, i) => `<text x="${x}" y="${y + i * (o.lh || 19)}" font-size="${o.fs || 13.5}" ${o.cls ? `class="${o.cls}"` : ''} xml:space="preserve">${l}</text>`).join('');
  }
  function note(x, y, w, h, title, arr, o = {}) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" class="panel"/>
      <text x="${x + 14}" y="${y + 22}" font-size="12" font-weight="700" class="muted">${esc(title)}</text>${lines(x + 14, y + 46, arr, o)}`;
  }

  /* ============================================================ VIEWS */
  /* 1. the code and the debugger's task view */
  function vIntro(c) {
    const s = c.step;
    let o = `<rect x="16" y="16" width="520" height="250" rx="8" class="panel"/><text x="30" y="38" font-size="12" font-weight="700" class="muted">freertos.c: create one task</text>`;
    const L = ['const osThreadAttr_t defaultTask_attributes = {', '  .name       = "defaultTask",', '  .stack_size = 512 * 4,     // 2048 bytes', '  .priority   = osPriorityNormal,', '};', '', 'defaultTaskHandle =', '    osThreadNew(StartDefaultTask, NULL,', '                &defaultTask_attributes);'];
    L.forEach((l, i) => {
      const ly = 64 + i * 21;
      if (s.hl === 'size' && i === 2) o += `<rect x="22" y="${ly - 15}" width="508" height="21" rx="4" class="codeline"/>`;
      o += `<text x="32" y="${ly}" font-size="13.5" class="mn" xml:space="preserve">${esc(l)}</text>`;
    });
    if (!s.table) {
      o += `<rect x="580" y="40" width="460" height="180" rx="10" fill="url(#a5)" class="box"/><text x="810" y="120" text-anchor="middle" font-size="22" font-weight="800" class="ink lbl">a stack of 2048 bytes</text>
        <text x="810" y="150" text-anchor="middle" font-size="14" class="ink lbl">the task's own scratch paper</text>`;
      o += note(16, 290, 520, 190, 'What we expect', ['One task = its code + its own stack (2048 bytes)', '+ a small "ID card" for the scheduler.', '', 'We build, flash, pause the debugger', 'and open its RTOS task view…']);
      return o;
    }
    const X = 560, Y = 16, cols = [[X + 14, 'Task'], [X + 140, 'Prio'], [X + 196, 'Stack Start'], [X + 312, 'Stack End'], [X + 428, 'Size']];
    o += `<rect x="${X}" y="${Y}" width="524" height="200" rx="8" class="panel"/><text x="${X + 14}" y="${Y + 22}" font-size="12" font-weight="700" class="muted">Debugger: RTOS task view (paused)</text>`;
    o += `<rect x="${X + 6}" y="${Y + 34}" width="512" height="24" rx="4" class="tablehead"/>`;
    cols.forEach(([x, t]) => { o += `<text x="${x}" y="${Y + 51}" font-size="12" font-weight="700" class="muted">${t}</text>`; });
    const R = [['defaultTask', '24', '0x200011E0', '0x200019D8', '2040'], ['blinkTask', '24', '0x20001C58', '0x20002050', '1016'], ['IDLE', '0', '0x20000970', '0x20000B68', '504'], ['Tmr Svc', '2', '0x20000DD8', '0x200011D0', '1016']];
    R.forEach((r, i) => {
      const ry = Y + 84 + i * 28;
      if (i === 0) o += `<rect x="${X + 420}" y="${ry - 18}" width="80" height="26" rx="5" class="cellbad"/>`;
      r.forEach((v, k) => { o += `<text x="${cols[k][0]}" y="${ry}" font-size="13" class="${k > 1 ? 'mn' : ''}" ${i === 0 && k === 4 ? 'font-weight="800"' : ''}>${v}</text>`; });
      o += `<line x1="${X + 8}" y1="${ry + 9}" x2="${X + 516}" y2="${ry + 9}" class="rowline"/>`;
    });
    if (!c.moving) o += `<rect x="${X + 416}" y="${Y + 62}" width="88" height="30" rx="6" class="focus"/>`;
    o += `<text x="${X + 70}" y="${Y + 262}" font-size="14" class="muted">we asked</text><text x="${X + 70}" y="${Y + 304}" font-size="40" font-weight="800" class="mn">2048</text>`;
    o += `<text x="${X + 300}" y="${Y + 262}" font-size="14" class="muted">the debugger says</text><text x="${X + 300}" y="${Y + 304}" font-size="40" font-weight="800" class="mn badfill">2040</text>`;
    o += `<text x="${X + 232}" y="${Y + 300}" font-size="34" font-weight="800" class="badfill">→</text>`;
    o += note(16, 290, 520, 190, 'To answer, we need to know', ['Where does the task live?', '   its code?   its stack?   its ID card?', 'Who puts each piece there, and when?', '', 'Let\'s open the memory cupboard.']);
    return o;
  }

  /* 2. the whole cupboard + a zoom on the RAM shelves */
  const COMP = [
    ['itcm', 'ITCM · 0x00000000 · 64 KB', 30], ['wall', '0x00010000 – 0x07FFFFFF', 20],
    ['flash', 'FLASH · 0x08000000 · 1 MB', 62], ['wall', '0x08100000 – 0x1FFFFFFF', 20],
    ['dtcm', 'RAM (DTCM) · 0x20000000 · 128 KB', 132], ['wall', '0x20020000 – 0x23FFFFFF', 18],
    ['axi', 'AXI SRAM · 0x24000000 · 320 KB', 46], ['wall', '0x24050000 – 0x2FFFFFFF', 18],
    ['sram', 'SRAM1/2 · SRAM4', 28], ['wall', '0x38004000 – 0x3FFFFFFF', 18],
    ['periph', 'Peripherals · 0x40000000 …', 50],
  ];
  function drawCupboard(x0, y0, w, hl) {
    let o = `<path d="M${x0 - 8} ${y0 + 18} L${x0 + 4} ${y0} L${x0 + w - 4} ${y0} L${x0 + w + 8} ${y0 + 18} Z" fill="url(#woodV)"/><rect x="${x0 - 10}" y="${y0 + 14}" width="${w + 20}" height="8" rx="2" fill="url(#wood)"/>`;
    o += `<rect x="${x0 + w / 2 - 74}" y="${y0 + 2}" width="148" height="12" rx="3" fill="url(#brass)"/><text x="${x0 + w / 2}" y="${y0 + 11.5}" text-anchor="middle" font-size="9" font-weight="800" fill="#3d2b05">0x00000000 · lower addresses</text>`;
    let y = y0 + 22;
    const total = COMP.reduce((a, c) => a + c[2], 0);
    o += `<rect x="${x0}" y="${y}" width="12" height="${total + 8}" fill="url(#wood)"/><rect x="${x0 + w - 12}" y="${y}" width="12" height="${total + 8}" fill="url(#wood)"/>`;
    const ix = x0 + 12, iw = w - 24, pos = {};
    for (const [id, label, h] of COMP) {
      if (id === 'wall') {
        o += `<rect x="${ix}" y="${y}" width="${iw}" height="${h}" fill="url(#wood)"/><rect x="${ix}" y="${y}" width="${iw}" height="${h}" fill="url(#grain)"/>
          <rect x="${ix + 6}" y="${y + 3}" width="${iw - 12}" height="${h - 6}" rx="3" fill="none" stroke="rgba(0,0,0,.35)"/>
          <text x="${ix + iw / 2}" y="${y + h / 2 + 3.5}" text-anchor="middle" font-size="9" class="mn" style="fill:#f3dfc0">wall · ${label}</text>`;
        y += h; continue;
      }
      pos[id] = [ix, y, iw, h];
      if (id === 'periph') {
        o += `<rect x="${ix}" y="${y}" width="${iw}" height="${h}" fill="url(#steel)"/>`;
        for (let k = 0; k < 6; k++) {
          const cx = ix + 30 + k * (iw - 60) / 5;
          o += `<rect x="${cx - 5}" y="${y + 20}" width="10" height="20" rx="5" fill="#374151"/><rect x="${cx - 7}" y="${y + (k % 2 ? 20 : 30)}" width="14" height="9" rx="2" fill="#f8fafc" stroke="#111"/>`;
        }
      } else {
        o += `<rect x="${ix}" y="${y}" width="${iw}" height="${h}" fill="url(#back)"/>`;
        if (id === 'flash') {
          o += `<rect x="${ix + 6}" y="${y + 20}" width="${iw - 12}" height="10" fill="#7fa7d9"/><rect x="${ix + 6}" y="${y + 30}" width="${iw - 12}" height="${h - 34}" fill="url(#ff)"/>`;
          o += `<rect x="${ix + 2}" y="${y + 2}" width="${iw / 2 - 3}" height="${h - 4}" fill="url(#glass)" stroke="#c8a96a" stroke-width="2"/><rect x="${ix + iw / 2 + 1}" y="${y + 2}" width="${iw / 2 - 3}" height="${h - 4}" fill="url(#glass)" stroke="#c8a96a" stroke-width="2"/>`;
          o += `<rect x="${ix + iw / 2 - 7}" y="${y + h / 2}" width="14" height="11" rx="2" fill="url(#brass)" stroke="#5b430b"/>`;
        }
        if (id === 'dtcm') {
          const yy = y + 20;
          o += `<rect x="${ix + 6}" y="${yy}" width="${iw - 12}" height="4" fill="#6cc08b"/><rect x="${ix + 6}" y="${yy + 4}" width="${iw - 12}" height="40" fill="#f2c46d"/>`;
          o += `<rect x="${ix + 40}" y="${yy + 16}" width="${iw - 120}" height="18" fill="url(#stripe)" stroke="rgba(0,0,0,.4)"/><text x="${ix + 46}" y="${yy + 29}" font-size="9" class="ink">ucHeap</text>`;
          o += `<text x="${ix + 12}" y="${yy + 14}" font-size="9" class="ink">.data .bss</text>`;
          o += `<rect x="${ix + 6}" y="${y + h - 16}" width="${iw - 12}" height="12" fill="#f0a8c9"/><text x="${ix + 12}" y="${y + h - 7}" font-size="9" class="ink">main stack</text>`;
        }
        if (id === 'axi') o += `<rect x="${ix + 6}" y="${y + 20}" width="40" height="8" fill="#c084fc"/>`;
      }
      o += `<rect x="${ix + 6}" y="${y + 3}" width="${iw - 12}" height="14" rx="2.5" fill="url(#brass)" stroke="#6f520d"/><text x="${ix + iw / 2}" y="${y + 13.5}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#3d2b05">${esc(label)}</text>`;
      o += `<rect x="${ix}" y="${y}" width="${iw}" height="${h}" fill="none" stroke="#2a170a" stroke-width="2"/>`;
      const on = hl.includes(id) || (hl.includes('others') && id !== 'dtcm' && id !== 'flash');
      if (on) o += `<rect x="${ix - 2}" y="${y - 2}" width="${iw + 4}" height="${h + 4}" rx="3" fill="none" stroke="#fbbf24" stroke-width="4" style="filter:drop-shadow(0 0 6px #fbbf24)"/>`;
      y += h;
    }
    o += `<rect x="${x0 - 10}" y="${y}" width="${w + 20}" height="12" rx="2" fill="url(#wood)"/><path d="M${x0} ${y + 12} h22 l-3 14 h-16 z M${x0 + w - 22} ${y + 12} h22 l-3 14 h-16 z" fill="#4a2c12"/>`;
    o += `<rect x="${x0 + w / 2 - 74}" y="${y + 14}" width="148" height="12" rx="3" fill="url(#brass)"/><text x="${x0 + w / 2}" y="${y + 23.5}" text-anchor="middle" font-size="9" font-weight="800" fill="#3d2b05">0xFFFFFFFF · higher addresses</text>`;
    return { o, pos };
  }
  function vCupboard(c) {
    const s = c.step;
    const cb = drawCupboard(40, 10, 350, s.hl || []);
    let o = cb.o;
    const k = c.moving ? ease(c.t) : 1;
    if (s.zoom === 'others') {
      o += `<rect x="440" y="16" width="644" height="460" rx="8" class="panel"/><text x="456" y="40" font-size="12" font-weight="700" class="muted">Bigger chips have more compartments: ours has six</text>`;
      const R = [['ITCM', '0x00000000', '64 KB', 'very fast code (empty in our project)'], ['Flash', '0x08000000', '1 MB', 'the program: code, constants, start values'], ['DTCM (RAM)', '0x20000000', '128 KB', 'fast data: our task lives here'],
        ['AXI SRAM', '0x24000000', '320 KB', 'big RAM, the DMA can reach it'], ['SRAM1/2', '0x30000000', '32 KB', 'empty'], ['SRAM4', '0x38000000', '16 KB', 'empty'], ['Peripherals', '0x40000000 …', '', 'not shelves: switches and lamps']];
      o += `<text x="460" y="70" font-size="12" font-weight="700" class="muted">Name</text><text x="590" y="70" font-size="12" font-weight="700" class="muted">First shelf</text><text x="710" y="70" font-size="12" font-weight="700" class="muted">Size</text><text x="790" y="70" font-size="12" font-weight="700" class="muted">What we keep there</text>`;
      R.forEach((r, i) => {
        const y = 100 + i * 34;
        o += `<g opacity="${clamp01(k * 7 - i)}"><text x="460" y="${y}" font-size="13.5" font-weight="${i === 2 ? 800 : 500}">${r[0]}</text><text x="590" y="${y}" font-size="13" class="mn">${r[1]}</text><text x="710" y="${y}" font-size="13">${r[2]}</text><text x="790" y="${y}" font-size="13">${r[3]}</text>
          <line x1="456" y1="${y + 11}" x2="1070" y2="${y + 11}" class="rowline"/></g>`;
      });
      o += lines(460, 360, ['Most small STM32s have just one RAM at 0x20000000.', 'Everything in this lesson happens there, so it works the same on them.'], { fs: 13, cls: 'muted' });
      return o;
    }
    // zoom lines from the RAM compartment
    const [dx, dy, dw, dh] = cb.pos.dtcm;
    o += `<path d="M${dx + dw} ${dy} L560 26 M${dx + dw} ${dy + dh} L560 470" stroke="rgba(160,120,60,.55)" stroke-width="1.5" stroke-dasharray="4 4" fill="none"/>`;
    o += cabinet(560, 16, 290, 460, 'Zoom: RAM, shelf by shelf');
    const SH = [['0x20000000', 1], ['0x20000001', 1], ['0x20000002', 1], ['0x20000003', 1], ['⋮', 0], ['0x2001FFFE', 1], ['0x2001FFFF', 1]];
    let y = 46;
    SH.forEach(([a, real], i) => {
      if (!real) {
        o += `<text x="705" y="${y + 40}" text-anchor="middle" font-size="22" style="fill:#f1e3cc">⋮</text><text x="705" y="${y + 66}" text-anchor="middle" font-size="12" style="fill:#f1e3cc">131,066 more shelves</text>`;
        y += 96; return;
      }
      o += `<rect x="572" y="${y}" width="96" height="30" rx="3" class="tape"/><text x="664" y="${y + 19}" text-anchor="end" font-size="11.5" class="tapetxt">${a}</text>`;
      o += `<rect x="676" y="${y + 3}" width="160" height="25" rx="3" fill="#f9e7bd" class="box"/>`;
      for (let b = 0; b < 8; b++) o += `<rect x="${682 + b * 19}" y="${y + 7}" width="16" height="17" rx="2" fill="#fff" stroke="#c9b48a"/>`;
      o += `<rect x="670" y="${y + 29}" width="172" height="4" fill="url(#woodV)"/>`;
      y += 42;
    });
    o += `<rect x="572" y="${y + 4}" width="266" height="46" rx="3" fill="url(#hatch)" stroke="#6b6158"/><text x="705" y="${y + 23}" text-anchor="middle" font-size="12" font-weight="700" class="ink lbl">0x20020000: no shelf</text><text x="705" y="${y + 40}" text-anchor="middle" font-size="11" class="ink lbl">one past the end (wall)</text>`;
    // right side text
    o += `<text x="870" y="60" font-size="13" font-weight="700">1 shelf = 1 byte = 8 bits</text>`;
    o += `<path d="M866 64 L842 70" class="arrow" marker-end="url(#arr)"/>`;
    o += lines(870, 92, ['Its label is its address.', 'The CPU names a shelf by', 'its label: 0x20000000,', '0x20000001, …'], { fs: 12.5 });
    if (s.zoom === 'calc') {
      o += `<g opacity="${k}"><rect x="864" y="196" width="222" height="282" rx="8" class="calc"/>`;
      o += lines(876, 220, ['128 KB = 128 × 1024', '       = 131,072 shelves', '       = 0x20000', '', 'last = first + count − 1', '', '0x20000000', '+ 0x00020000', '− 1', '= <tspan font-weight="800">0x2001FFFF</tspan>', '', 'like houses 1…10: 10 houses,', 'the last one is number 10'], { fs: 12.5, lh: 19.5, cls: 'mn' });
      o += '</g>';
    }
    return o;
  }

  /* 3. build time: Flash and RAM, side by side */
  function vRam(c) {
    const s = c.step, hl = s.hl || [], k = c.moving ? ease(c.t) : 1;
    let o = cabinet(16, 10, 420, 478, 'FLASH · 0x08000000 · 1 MB');
    const fx = 28, fw = 396;
    let y = 36;
    const F = {};
    const addF = (id, h, fill, label, right, top) => { F[id] = [fx, y, fw, h]; o += item(fx, y, fw, h, fill, label, right, { hl: hl.includes(id), top }); y += h; };
    addF('vec', 26, 'url(#steel)', '.isr_vector (vector table)', '0x08000000 · 716 B');
    addF('text', 140, '#7fa7d9', '.text: all machine code', '0x080002D0 · 56,000 B', true);
    F.code = [fx + 24, F.text[1] + 72, fw - 48, 40];
    o += item(fx + 24, F.text[1] + 80, fw - 48, 44, '#fca5a5', 'StartDefaultTask()', '0x0800BF3C · 52 B', { hl: hl.includes('code'), noboard: true, sub: 'the task\'s code' });
    addF('rodata', 76, '#b9a6e3', '.rodata: const data', '0x0800DD90 · 356 B', true);
    o += item(fx + 24, F.rodata[1] + 32, fw - 48, 34, '#fca5a5', 'defaultTask_attributes', '0x0800DE9C · 36 B', { hl: hl.includes('attr'), noboard: true });
    addF('init', 32, '#9ed8ab', '.data start values', '0x0800DF04 · 112 B');
    o += item(fx, y, fw, 488 - 12 - y, 'url(#ff)', 'erased: every byte 0xFF', '… 0x080FFFFF');

    o += cabinet(470, 10, 614, 478, 'RAM (DTCM) · 0x20000000 · 128 KB');
    const rx = 482, rw = 590;
    y = 36;
    const Rp = {};
    const addR = (id, h, fill, label, right, oo = {}) => { Rp[id] = [rx, y, rw, h]; o += item(rx, y, rw, h, fill, label, right, Object.assign({ hl: hl.includes(id) }, oo)); y += h; };
    addR('data', 30, '#6cc08b', '.data: globals with a start value', '0x20000000 · 112 B');
    const by = y;
    addR('bss', 262, '#f2c46d', '', '');
    o += `<text x="${rx + 12}" y="${by + 20}" font-size="13" font-weight="700" class="ink lbl">.bss: globals that start at 0</text><text x="${rx + rw - 10}" y="${by + 20}" text-anchor="end" font-size="11" class="mn ink lbl">0x20000070 · 27,832 B</text>`;
    const B = [['kernel', 30, '#f9e7bd', 'FreeRTOS kernel globals (Ready lists, xTickCount…)', '0x20000090'], ['static', 30, '#f9e7bd', 'Idle + timer task: TCBs, stacks, queue (static)', '0x20000614'],
      ['heap', 92, 'url(#stripe)', 'ucHeap[15360]: ONE array, an empty box', '0x200011D8 · 15,360 B'], ['mine', 28, '#fca5a5', 'your globals + defaultTaskHandle', '0x20004DFC'], ['rest', 30, '#f9e7bd', 'HAL handles, trace buffer, C library', '0x20004E10']];
    let yy = by + 30;
    for (const [id, h, fill, label, right] of B) {
      Rp[id] = [rx + 14, yy, rw - 28, h];
      o += item(rx + 14, yy, rw - 28, h, fill, label, right, { hl: hl.includes(id), noboard: true, fs: 12, sub: id === 'heap' ? 'the linker reserves it; nothing is inside yet' : '' });
      yy += h + 2;
    }
    if (s.zero) { // Reset_Handler fills .bss with zeros
      const zw = (rw - 6) * k;
      o += `<rect x="${rx + 3}" y="${by + 2}" width="${zw}" height="257" rx="4" fill="url(#zeros)" opacity=".5"/>`;
      if (k < 1) o += `<line x1="${rx + 3 + zw}" y1="${by}" x2="${rx + 3 + zw}" y2="${by + 260}" stroke="#16a34a" stroke-width="3"/>`;
      o += `<text x="${rx + rw / 2}" y="${by + 140}" text-anchor="middle" font-size="15" font-weight="800" class="ink lbl">Reset_Handler: fill .bss with 0</text>`;
    }
    addR('free', 440 - 30 - 262 - 42, 'none', 'free shelves (≈ 99 KB)', '');
    addR('msp', 42, '#f0a8c9', 'main stack (MSP): main() and every interrupt', '0x2001FC00 … 0x2001FFFF', { sub: 'starts at 0x20020000 (_estack) and grows ↑' });
    if (s.msp) {
      const [mx, my] = Rp.msp, top = lerp(my + 30, my - 60, k);
      o += `<path d="M${mx + 520} ${my + 36} L${mx + 520} ${top}" class="arrow-bad" marker-end="url(#arrBad)"/><text x="${mx + 470}" y="${my - 30}" text-anchor="end" font-size="12.5" font-weight="700" style="fill:#fca5a5">grows ↑ toward lower addresses</text>`;
    }
    if (s.fly && c.moving) { // copy start values from Flash to RAM
      const a = F.init, b = Rp.data;
      const x = lerp(a[0] + a[2] - 40, b[0] + 120, ease(c.t)), yv = lerp(a[1] + 16, b[1] + 15, ease(c.t)) - Math.sin(c.t * Math.PI) * 60;
      o += `<rect x="${x - 50}" y="${yv - 13}" width="100" height="26" rx="13" class="token"/><text x="${x}" y="${yv + 5}" text-anchor="middle" font-size="12" font-weight="800" class="inkw">copy 112 B</text>`;
    }
    if (s.fly && !c.moving) o += `<path d="M${F.init[0] + F.init[2]} ${F.init[1] + 16} C 455 ${F.init[1] + 16}, 455 ${Rp.data[1] + 15}, ${Rp.data[0] + 6} ${Rp.data[1] + 15}" class="arrow" marker-end="url(#arr)"/>`;
    return o;
  }

  /* 4. run time: FreeRTOS cuts blocks out of ucHeap */
  const BLOCKS = [
    [1, 'h1', 'header', '0x200011D8 · 8 B', 16, '#ffe066'],
    [1, 'dst', 'defaultTask stack', '0x200011E0 · 2048 B', 92, 'url(#a5)'],
    [2, 'h2', 'header', '0x200019E0 · 8 B', 16, '#ffe066'],
    [2, 'dtcb', 'defaultTask TCB (ID card)', '0x200019E8 · 616 B', 46, '#ffffff', true],
    [3, 'h3', 'header', '0x20001C50 · 8 B', 16, '#ffe066'],
    [3, 'bst', 'blinkTask stack', '0x20001C58 · 1024 B', 62, 'url(#a5)'],
    [3, 'h4', 'header', '0x20002058 · 8 B', 16, '#ffe066'],
    [3, 'btcb', 'blinkTask TCB', '0x20002060 · 616 B', 46, '#ffffff', true],
  ];
  const FREE_AT = { 1: [0x200019E0, 13296], 2: [0x20001C50, 12672], 3: [0x200022C8, 11016], 4: [0x200022C8, 11016] };
  function vHeap(c) {
    const s = c.step, lvl = s.heap, prevLvl = c.prev.view === 'heap' ? c.prev.heap : 0, k = c.moving ? ease(c.t) : 1, hl = s.hl || [];
    let o = `<rect x="16" y="10" width="404" height="262" rx="8" class="panel"/><text x="30" y="32" font-size="12" font-weight="700" class="muted">What runs, in order</text>`;
    const CODE = [[0, 'linker:  ucHeap[15360] in .bss'], [1, 'osThreadNew(defaultTask)'], [1, '  pvPortMalloc(2048) → 0x200011E0'], [2, '  pvPortMalloc(616)  → 0x200019E8'],
      [3, 'osThreadNew(blinkTask)'], [3, '  pvPortMalloc(1024) → 0x20001C58'], [3, '  pvPortMalloc(616)  → 0x20002060'], [4, 'osKernelStart(): heap unchanged']];
    CODE.forEach(([l, t], i) => {
      if (l > lvl) return;
      const ly = 58 + i * 26;
      if (l === lvl) o += `<rect x="22" y="${ly - 17}" width="392" height="24" rx="4" class="codeline"/>`;
      o += `<text x="32" y="${ly}" font-size="13" class="mn" xml:space="preserve">${esc(t)}</text>`;
    });
    if (s.side) o += note(16, 286, 404, 194, s.sideTitle || 'Look', s.side, { fs: 13, lh: 20 });

    o += cabinet(440, 10, 644, 478, 'ucHeap · 0x200011D8 – 0x20004DD7 · 15,360 B (inside .bss)');
    const x = 452, w = 620, top = 36, bottom = 476;
    let y = top;
    const at = {};
    if (lvl === 0) {
      o += item(x, y, w, bottom - y, 'url(#zeros)', '15,360 zero bytes: nothing inside yet', '', { sub: 'the map file shows only this', hl: hl.includes('box') });
      return o;
    }
    for (const [L, id, label, right, h, fill, card] of BLOCKS) {
      if (L > lvl) continue;
      const fresh = L > prevLvl && c.moving;
      at[id] = [x, y, w, h];
      const fillNow = (id === 'dst' || id === 'bst') && s.raw ? 'url(#zeros)' : fill;
      o += item(x, y, w, h, fillNow, label + ((id === 'dst' || id === 'bst') && s.raw ? ' (not prepared yet)' : ''), right,
        { card, hl: hl.includes(id), fs: h < 20 ? 10.5 : 13, op: fresh ? k : 1, tx: fresh ? -260 * (1 - k) : 0 });
      y += h;
    }
    const [fa, fsz] = FREE_AT[lvl];
    o += item(x, y, w, 16, '#ffe066', 'header of the free block', '0x' + fa.toString(16).toUpperCase() + ' · 8 B', { fs: 10.5 });
    y += 16;
    o += item(x, y, w, bottom - 16 - y, '#efe4d0', `free: ${(fsz - 8).toLocaleString('en')} B for future tasks and queues`, '', { hl: hl.includes('free') });
    o += item(x, bottom - 16, w, 16, '#ffd43b', 'end marker', '0x20004DD0 · 8 B', { fs: 10.5 });
    if (s.overflow && at.bst && at.dtcb) {
      const y0 = at.bst[1] + 40, y1 = at.dtcb[1] + 22, ax = 1050;
      const yk = lerp(y0, y1, k);
      o += `<path d="M${ax} ${y0} L${ax} ${yk}" class="arrow-bad" marker-end="url(#arrBad)"/>`;
    }
    return o;
  }

  /* 5. the TCB as an ID card */
  function vTcb(c) {
    const s = c.step, k = c.moving ? ease(c.t) : 1;
    const R = [['+0', 'pxTopOfStack', '0x20001954', 'saved SP; PendSV reads it first'], ['', 'xStateListItem', 'hook', 'hangs in the Ready or Delayed list'], ['', 'xEventListItem', 'hook', 'for waiting on a queue'],
      ['', 'uxPriority', '24', 'how important'], ['', 'pxStack', '0x200011E0', 'stack bottom'], ['', 'pcTaskName[16]', '"defaultTask"', 'a copy of the name'], ['', 'pxEndOfStack', '0x200019D8', 'stack top, 8-aligned'],
      ['', 'ulRunTimeCounter', 'µs', 'CPU time used so far'], ['', 'ulNotifiedValue', '0', 'built-in mailbox'], ['', 'struct _reent', '512 B', 'the C library\'s per-task state']];
    let o = `<rect x="0" y="0" width="1100" height="490" fill="url(#back)"/><rect x="0" y="0" width="1100" height="490" fill="url(#grain)" opacity=".5"/>`;
    o += `<g filter="url(#soft)"><rect x="24" y="14" width="690" height="462" rx="16" class="card-bg"/></g>`;
    o += `<rect x="24" y="14" width="690" height="40" rx="16" fill="#0e7490"/><rect x="24" y="38" width="690" height="16" fill="#0e7490"/>`;
    o += `<text x="44" y="40" font-size="17" font-weight="800" class="inkw" letter-spacing="1.5">TASK CONTROL BLOCK</text><text x="694" y="40" text-anchor="end" font-size="12.5" class="mn inkw">0x200019E8 · 616 B</text>`;
    o += `<rect x="44" y="64" width="40" height="40" rx="6" fill="#e2e8f0" stroke="#94a3b8"/><rect x="52" y="74" width="24" height="18" rx="4" fill="#64748b"/><circle cx="59" cy="82" r="3" fill="#a7f3d0"/><circle cx="69" cy="82" r="3" fill="#a7f3d0"/>`;
    o += `<text x="98" y="84" font-size="22" font-weight="800" class="ink">defaultTask</text><text x="98" y="101" font-size="12" class="ink">handle: defaultTaskHandle = 0x200019E8</text>`;
    R.forEach((r, i) => {
      const y = 118 + i * 33;
      o += `<rect x="40" y="${y}" width="658" height="29" rx="4" fill="${i === 0 ? '#fef3c7' : (r[1] === 'struct _reent' && s.split ? '#fde2e2' : (i % 2 ? '#f4efe4' : '#faf7f0'))}"/>`;
      o += `<text x="50" y="${y + 19}" font-size="10.5" class="mn" style="fill:#b45309">${r[0]}</text><text x="76" y="${y + 19}" font-size="12.5" font-weight="700" class="mn ink">${esc(r[1])}</text>`;
      o += `<text x="290" y="${y + 19}" font-size="12.5" class="mn" style="fill:#0e7490">${esc(r[2])}</text><text x="420" y="${y + 19}" font-size="12" class="ink">${esc(r[3])}</text>`;
    });
    if (!s.split) {
      o += `<rect x="740" y="14" width="344" height="462" rx="10" class="panel"/>`;
      o += lines(756, 44, ['<tspan font-weight="700">How the scheduler uses it</tspan>', '', 'pxCurrentTCB', '   ↓  points to the running card', 'this TCB', '   ↓  pxTopOfStack', 'the frozen registers on the stack', '   ↓  saved PC', 'the task\'s code in Flash', '', 'A switch needs only two pointers:', 'save SP into the old card,', 'load SP from the new card.'], { fs: 13, lh: 24 });
      return o;
    }
    // measured split of the 616 bytes
    const P = [[92, '#c7e8ef', 'scheduler fields', '92 B'], [4, '#d9d4cc', 'padding', '4 B'], [512, '#fca5a5', 'struct _reent (C library)', '512 B'], [8, '#d9d4cc', 'notify + flags + padding', '8 B']];
    o += `<rect x="740" y="14" width="344" height="462" rx="10" class="panel"/><text x="756" y="38" font-size="12" font-weight="700" class="muted">616 bytes, measured</text>`;
    let y = 52;
    const H = 330;
    P.forEach(([n, fill, label, right], i) => {
      const h = Math.max(14, H * n / 616) * (i === 2 ? k : 1) + (i === 2 ? 0 : 0);
      o += `<rect x="760" y="${y}" width="90" height="${Math.max(2, h - 2)}" rx="3" fill="${fill}" class="box"/><text x="862" y="${y + Math.max(12, h / 2 + 4)}" font-size="12.5">${label}: <tspan font-weight="800">${right}</tspan></text>`;
      y += h;
    });
    o += lines(756, 436, ['104 B FreeRTOS + 512 B C library', '→ 83 % of the card is newlib\'s!'], { fs: 12.5, lh: 18 });
    return o;
  }

  /* 6. inside blinkTask's stack, measured */
  const WORDS = [
    ['sw', '20001FCC', 'A5A5A5A5', 'R4', 'never used: still the fill'], ['sw', '20001FD0', 'A5A5A5A5', 'R5', 'never used'], ['sw', '20001FD4', 'A5A5A5A5', 'R6', 'never used'],
    ['sw', '20001FD8', '20002010', 'R7', 'frame pointer'], ['sw', '20001FDC', 'A5A5A5A5', 'R8', 'never used'], ['sw', '20001FE0', 'A5A5A5A5', 'R9', 'never used'], ['sw', '20001FE4', 'A5A5A5A5', 'R10', 'never used'],
    ['sw', '20001FE8', 'A5A5A5A5', 'R11', 'never used'], ['sw', '20001FEC', 'FFFFFFFD', 'EXC_RETURN', 'back to a task, PSP, no FPU'],
    ['hw', '20001FF0', '00000000', 'R0', ''], ['hw', '20001FF4', '20002064', 'R1', 'points into its own TCB'], ['hw', '20001FF8', '10000000', 'R2', 'PENDSVSET: "please switch"'],
    ['hw', '20001FFC', 'E000ED04', 'R3', 'address of ICSR: where R2 was written'], ['hw', '20002000', 'A5A5A5A5', 'R12', 'never used'], ['hw', '20002004', '08009F11', 'LR', 'left over from xTaskResumeAll'],
    ['hw', '20002008', '08009C1A', 'PC', 'continue HERE: inside vTaskDelay'], ['hw', '2000200C', '61000000', 'xPSR', 'Thumb bit + flags'],
    ['c1', '20002010', '00000000', 'vTaskDelay', 'local'], ['c1', '20002014', '000001F4', '', '500 = osDelay(500)'], ['c1', '20002018', '00000002', '', 'local'], ['c1', '2000201C', '00000000', '', 'xAlreadyYielded'],
    ['c1', '20002020', '20002028', '', 'saved R7'], ['c1', '20002024', '0800B1AF', '', 'LR → back into osDelay'],
    ['c2', '20002028', '0001A5A5', 'osDelay', 'local, half written'], ['c2', '2000202C', '000001F4', '', '500 again: its copy'], ['c2', '20002030', '00000000', '', 'local'], ['c2', '20002034', '00000000', '', 'local'],
    ['c2', '20002038', '20002040', '', 'saved R7'], ['c2', '2000203C', '0800BF89', '', 'LR → back into StartBlinkTask'],
    ['c3', '20002040', 'A5A5A5A5', 'StartBlinkTask', 'padding'], ['c3', '20002044', '00000000', '', 'argument = NULL'], ['c3', '20002048', 'A5A5A5A5', '', 'saved R7: never set'], ['c3', '2000204C', '0800B641', '', 'LR = prvTaskExitError (the trap)'],
  ];
  const GROUP = { sw: ['#d6e2f7', 'saved by PendSV · 36 B'], hw: ['#e3edf9', 'saved by hardware · 32 B'], c1: ['#eef4fb', 'call frames · 64 B'], c2: ['#f4f8fc', ''], c3: ['#eef4fb', ''] };
  function vStack(c) {
    const s = c.step, k = c.moving ? c.t : 1;
    let o = cabinet(16, 10, 320, 478, 'blinkTask stack · 1024 B');
    const x = 28, w = 296;
    const yA = 36, hA = 330, yU = yA + hA, hU = 84, yT = yU + hU, hT = 22;
    o += `<g>${item(x, yA, w, hA, s.mode === 'overview' ? '#e6d3b0' : 'url(#a5)', s.mode === 'overview' ? 'free' : 'never touched: still 0xA5', '884 B', { sub: s.mode === 'overview' ? '' : '0x20001C58 ↓' })}</g>`;
    if (s.mode === 'fill') o += `<rect x="${x + 3}" y="${yA + 2}" width="${w - 6}" height="${(hA - 5) * (1 - k)}" rx="4" fill="#e6d3b0"/>`;
    o += item(x, yU, w, 26, '#2f62ad', 'PendSV-saved', '36 B', { light: true, fs: 11.5, noboard: true });
    o += item(x, yU + 26, w, 24, '#4f86cf', 'hardware-saved', '32 B', { light: true, fs: 11.5, noboard: true });
    o += item(x, yU + 50, w, 34, '#9cc3ee', 'call frames', '64 B', { fs: 11.5 });
    o += item(x, yT, w, hT, 'url(#hatchRed)', '8 B never usable', '', { fs: 11 });
    o += `<rect x="${x + 4}" y="${yU - 19}" width="200" height="17" rx="3" fill="#1f2937"/><text x="${x + 10}" y="${yU - 6}" font-size="11" class="mn" style="fill:#fcd34d">SP 0x20001FCC (Used 132)</text>`;
    o += `<text x="${x + 6}" y="${yT + hT + 14}" font-size="10.5" class="mn" style="fill:#f1e3cc">Stack End 0x20002050</text>`;

    if (s.mode === 'overview' || s.mode === 'fill') {
      const L = s.mode === 'overview'
        ? ['<tspan font-weight="700">What lives on a task\'s stack</tspan>', '', '①  local variables that don\'t fit in registers', '②  return addresses and saved registers,', '      pushed on every function call', '③  arguments beyond the first four (R0–R3)', '④  the "frozen" registers when the task', '      is switched out or interrupted', '', '<tspan class="muted">Not here: the code (Flash) and the globals</tspan>', '<tspan class="muted">(.data/.bss). static locals are .bss too.</tspan>']
        : ['<tspan font-weight="700">At creation, FreeRTOS fills every byte with 0xA5</tspan>', '', 'Later, the debugger looks how far the 0xA5', 'is gone. That shows the deepest point the stack', 'ever reached: the "Peak".', '', 'It grows from the top (high address)', 'toward lower addresses: ↑ in this drawing.'];
      o += `<rect x="360" y="14" width="724" height="462" rx="10" class="panel"/>${lines(384, 50, L, { fs: 14.5, lh: 30 })}`;
      return o;
    }
    // decoded table
    o += `<path d="M${x + w} ${yU} L372 30 M${x + w} ${yT} L372 470" stroke="rgba(160,120,60,.6)" stroke-width="1.5" stroke-dasharray="4 4" fill="none"/>`;
    o += `<rect x="372" y="14" width="712" height="462" rx="10" class="panel"/>`;
    const RH = 13.4, Y0 = 26;
    let gStart = 0;
    WORDS.forEach((r, i) => {
      const y = Y0 + i * RH;
      const a5 = r[2] === 'A5A5A5A5';
      let bg = GROUP[r[0]][0];
      if (s.mode === 'scan' && a5) bg = '#fff1b8';
      o += `<rect x="378" y="${y}" width="700" height="${RH - 1}" fill="${bg}"/>`;
      o += `<text x="520" y="${y + 10}" font-size="10.5" class="mn ink">0x${r[1]}</text><text x="612" y="${y + 10}" font-size="10.5" class="mn ink" font-weight="${a5 ? 800 : 400}">${r[2]}</text>`;
      o += `<text x="700" y="${y + 10}" font-size="10.5" font-weight="700" class="ink">${esc(r[3])}</text><text x="806" y="${y + 10}" font-size="10.5" class="ink">${esc(r[4])}</text>`;
      if (i === WORDS.length - 1 || WORDS[i + 1][0] !== r[0]) {
        const yy = Y0 + gStart * RH, hh = (i - gStart + 1) * RH;
        if (GROUP[r[0]][1] || r[0] === 'c1') o += `<text x="386" y="${yy + Math.min(hh, 50) / 2 + 4}" font-size="11" font-weight="800" class="ink">${GROUP[r[0]][1].split(' · ')[0]}</text><text x="386" y="${yy + Math.min(hh, 50) / 2 + 18}" font-size="10.5" class="ink">${GROUP[r[0]][1].split(' · ')[1] || ''}</text>`;
        o += `<line x1="378" y1="${yy + hh - 0.5}" x2="1078" y2="${yy + hh - 0.5}" stroke="#7c93b5"/>`;
        gStart = i + 1;
      }
    });
    if (s.mode === 'scan') {
      // the scanner walks up from the bottom of the stack (0x20001C58) while it sees 0xA5
      const p1 = clamp01(k / 0.55), p2 = clamp01((k - 0.55) / 0.45);
      if (k < 0.55 && c.moving) {
        const sy = lerp(yA + 4, yU - 4, p1);
        o += `<rect x="${x + 2}" y="${sy}" width="${w - 4}" height="6" fill="#f59e0b" opacity=".85"/>`;
      } else {
        const rows = Math.min(3, Math.floor(p2 * 4.2));
        const ry = Y0 + rows * RH;
        o += `<rect x="378" y="${ry - 1}" width="700" height="${RH + 1}" fill="none" stroke="#dc2626" stroke-width="2.5"/>`;
        if (rows === 3) o += `<text x="1070" y="${ry + 10}" text-anchor="end" font-size="11" font-weight="800" style="fill:#dc2626">stop: first non-0xA5</text>`;
      }
      if (!c.moving || k > 0.95) {
        o += `<rect x="${x + 16}" y="150" width="${w - 32}" height="104" rx="8" fill="var(--surface)" stroke="#dc2626" stroke-width="2"/>`;
        o += lines(x + 28, 174, ['scan stopped at 0x20001FD8', 'free = 0x20001FD8 − 0x20001C58', '        = 896 B', '<tspan font-weight="800">Peak = 1016 − 896 = 120</tspan>'], { fs: 12.5, lh: 21, cls: 'mn' });
      }
    }
    return o;
  }

  /* 7. the toy stack: 16 bytes, then the real one */
  function vToy(c) {
    const s = c.step, k = c.moving ? ease(c.t) : 1, real = !!s.real;
    const base = real ? 0x200019D0 : 0x100, A = (n) => '0x' + (base + n).toString(16).toUpperCase();
    const X = 500, WW = 250, Y = real ? 74 : 40, RH = 62;
    let o = `<rect x="16" y="14" width="360" height="300" rx="10" class="panel"/>`;
    if (real) o += `<rect x="${X}" y="16" width="${WW}" height="48" rx="6" fill="url(#a5)" class="box"/><text x="${X + WW / 2}" y="38" text-anchor="middle" font-size="12" font-weight="700" class="ink lbl">⋮ 2,032 more bytes</text><text x="${X + WW / 2}" y="55" text-anchor="middle" font-size="11" class="mn ink lbl">down to 0x200011E0 (Stack Start)</text>`;
    for (let wI = 0; wI < 4; wI++) {
      const y = Y + wI * RH;
      let fill = '#f9e7bd';
      if (s.toy === 3 && wI >= 2) fill = 'url(#hatchRed)';
      if (s.toy === 3 && wI === 1) fill = '#4f86cf';
      if (s.toy === 4 && wI <= 1) fill = '#7fa7d9';
      o += `<text x="${X - 12}" y="${y + 36}" text-anchor="end" font-size="13" class="mn">${A(wI * 4)}</text>`;
      o += `<rect x="${X}" y="${y + 2}" width="${WW}" height="${RH - 6}" rx="5" fill="${fill}" class="box"/>`;
      for (let b = 0; b < 4; b++) o += `<rect x="${X + 10 + b * 61}" y="${y + 10}" width="55" height="${RH - 22}" rx="3" fill="rgba(255,255,255,.55)" stroke="rgba(0,0,0,.25)"/>`;
      o += `<text x="${X + WW / 2}" y="${y + 38}" text-anchor="middle" font-size="13" font-weight="700" class="ink lbl">${s.toy === 3 && wI === 1 ? 'first push lands here' : (s.toy === 3 && wI >= 2 ? 'never used' : (s.toy === 4 && wI <= 1 ? (wI === 0 ? 'double: SP+0 … SP+3' : 'double: SP+4 … SP+7') : 'word ' + wI))}</text>`;
      o += `<rect x="${X - 4}" y="${y + RH - 5}" width="${WW + 8}" height="4" fill="url(#woodV)"/>`;
    }
    const yN = Y + 4 * RH;
    o += `<text x="${X - 12}" y="${yN + 30}" text-anchor="end" font-size="13" class="mn">${A(16)}</text><rect x="${X}" y="${yN + 2}" width="${WW}" height="44" rx="5" fill="url(#hatch)" class="box"/><text x="${X + WW / 2}" y="${yN + 29}" text-anchor="middle" font-size="12.5" font-weight="700" class="ink lbl">next block: not ours</text>`;
    // pointer arrows on the right
    const yOf = (n) => Y + (n / 4) * RH;
    const ptr = (yy, txt, cls, mk) => `<path d="M${X + WW + 100} ${yy} L${X + WW + 8} ${yy}" class="${cls}" marker-end="url(#${mk})"/><text x="${X + WW + 108}" y="${yy + 5}" font-size="13" font-weight="700">${txt}</text>`;
    if (s.toy === 1) o += ptr(yOf(12), `step 1: the last word ${A(12)}`, 'arrow', 'arr');
    if (s.toy >= 2 && s.toy !== 4) {
      const yy = s.toy === 2 ? lerp(yOf(12), yOf(8), k) : yOf(8);
      o += ptr(yy, `top = ${A(8)} ("Stack End")`, 'arrow', 'arr');
      if (s.toy === 2) o += `<text x="${X + WW + 108}" y="${yOf(12) + 26}" font-size="12.5" class="mn badfill">${A(12)} ÷ 8 = ${((base + 12) / 8).toFixed(1)} ✗</text><text x="${X + WW + 108}" y="${yOf(8) + 26}" font-size="12.5" class="mn okfill">${A(8)} ÷ 8 = ${(base + 8) / 8} ✓</text>`;
    }
    if (s.honest) o += `<path d="M${X + WW + 100} ${yN} L${X + WW + 8} ${yN}" class="arrow-ok" marker-end="url(#arrOk)"/><text x="${X + WW + 108}" y="${yN + 5}" font-size="13" font-weight="700" class="okfill">${A(16)}: already ×8 ✓</text>`;
    if (s.toy === 4) o += `<path d="M${X + WW + 100} ${Y + 2} L${X + WW + 8} ${Y + 2}" class="arrow-ok" marker-end="url(#arrOk)"/><text x="${X + WW + 108}" y="${Y + 7}" font-size="13" font-weight="700" class="okfill">SP = 0x100 (×8): the double fits</text><text x="${X + WW + 108}" y="${Y + 27}" font-size="12.5">at SP+0 … SP+7 ✓</text>`;
    // the explanation card on the left
    const T = {
      1: ['<tspan font-weight="700">A toy stack: 16 bytes = 4 words</tspan>', '', 'FreeRTOS picks where the stack starts', '(its high end). Its common code says:', '', '<tspan font-weight="700">Rule 1:</tspan> start at the LAST word,', '&amp;stack[3] = 0x10C.'],
      2: ['<tspan font-weight="700">Rule 2: the top must be a</tspan>', '<tspan font-weight="700">multiple of 8</tspan>', '', '0x10C is not, so round DOWN:', '0x10C → 0x108.', '', 'This is "Stack End" in the debugger.'],
      3: ['<tspan font-weight="700">The Cortex-M pushes like this:</tspan>', 'subtract 4 from SP, then write.', '', 'First push → 0x104.', 'Words 0x108 and 0x10C: never used.', '', '<tspan font-weight="700">Size = 0x108 − 0x100 = 8</tspan>, not 16.'],
      4: ['<tspan font-weight="700">Why a multiple of 8?</tspan>', 'The ARM calling rules (AAPCS):', 'a double or uint64_t must sit on', 'an 8-byte boundary. The compiler puts', 'it at SP+0, SP+8 … That is only right', 'if SP itself is a multiple of 8.', '', 'Break it, and printf("%f") prints garbage.', '<tspan class="muted">Not because of the bus width.</tspan>'],
      5: ['<tspan font-weight="700">The same, with our real task:</tspan>', '', 'end   = 0x200011E0 + 2048', '      = 0x200019E0', 'rule 1: last word  0x200019DC', 'rule 2: round down 0x200019D8', '', '<tspan font-weight="700">0x200019D8 − 0x200011E0 = 2040</tspan> ✓'],
      6: ['<tspan font-weight="700">The honest part</tspan>', '0x200019E0 is already a multiple of 8.', 'A Cortex-M would write its first word', 'at 0x200019DC: still ours. 0 bytes lost.', '', 'Some CPUs write first and subtract later.', 'FreeRTOS\'s common code doesn\'t know', 'which kind it runs on, so it always', 'takes the safe "last word" rule.'],
    };
    o += lines(32, 46, T[s.toyText || s.toy] || [], { fs: 13.5, lh: 25 });
    if (s.toy >= 3 && s.toy !== 4) o += `<text x="${X + WW / 2}" y="${yN + 76}" text-anchor="middle" font-size="16" font-weight="800">Size = ${real ? '0x200019D8 − 0x200011E0 = 2040' : '0x108 − 0x100 = 8'}</text>`;
    return o;
  }

  const VIEWS = { intro: vIntro, cupboard: vCupboard, ram: vRam, heap: vHeap, tcb: vTcb, stack: vStack, toy: vToy };

  /* ============================================================ STORY */
  const STEPS = [
    // 1 One new task
    { ch: 1, view: 'intro', hl: 'size', title: 'We create one task',
      text: 'With FreeRTOS we create a task called <code>defaultTask</code> and give it a <b>stack of 2048 bytes</b> (512 words × 4). Each task needs its own stack: its private scratch paper.',
      more: 'This is the code the STM32 tools generate for FreeRTOS (CMSIS-RTOS2 layer). <code>.stack_size</code> is in <b>bytes</b> here. The raw FreeRTOS call <code>xTaskCreate()</code> takes <b>words</b>: a classic 4× mistake.' },
    { ch: 1, view: 'intro', table: true, kind: 'problem', headline: 'We asked for 2048 bytes. The debugger says 2040.', title: 'The debugger disagrees',
      text: 'We pause the program and open the debugger\'s RTOS task view. Stack Size: <b>2040</b>. The other tasks are short too: 1024 → 1016, 512 → 504. Always 8 bytes. Where did they go?',
      more: 'The view comes from the RTOS-aware debugger plugin. It reads FreeRTOS\'s own data: for each task, the stack\'s start and end addresses. Size = End − Start. So the answer is hidden in <b>where</b> those addresses come from.' },
    // 2 The cupboard
    { ch: 2, view: 'cupboard', zoom: 'shelves', hl: ['dtcm'], title: 'Memory is a cupboard',
      text: 'Picture memory as a giant cupboard. Every <b>shelf holds one byte</b>, and every shelf has a <b>label: its address</b>. The CPU can name 2<sup>32</sup> labels, from 0x00000000 to 0xFFFFFFFF.',
      more: 'Real shelves exist only where the chip has memory. Between the compartments is <b>wall</b>: no shelves behind it. Reading or writing there makes the CPU stop with a <b>HardFault</b>.' },
    { ch: 2, view: 'cupboard', zoom: 'calc', hl: ['dtcm'], title: 'The RAM compartment: first and last shelf',
      text: 'Our RAM starts at <b>0x20000000</b> and holds 128 KB = 131,072 shelves. Its last shelf is <b>0x2001FFFF</b>: first + count − 1.',
      q: '"Is the last shelf 0x20020000?" No: that label is one <i>past</i> the end. The linker calls it <code>_estack</code>, and we will meet it again.' },
    { ch: 2, view: 'cupboard', zoom: 'others', hl: ['others'], title: 'More compartments, with walls between',
      text: 'Our chip has six memory compartments, not one. They don\'t touch: there is wall between them. The linker script lists them in its <code>MEMORY { }</code> block.',
      more: 'The order inside <code>MEMORY { }</code> doesn\'t matter: it is only a list of names, start labels and sizes. The real order is by address. The peripherals at 0x40000000 and up are not memory at all: writing there flips hardware switches, like the UART\'s mailbox.' },
    // 3 Build time
    { ch: 3, view: 'ram', hl: ['code', 'attr'], title: 'The task\'s code and settings live in Flash',
      text: 'The linker places all code in <b>Flash</b>, in <code>.text</code>. Our task function <code>StartDefaultTask</code> is just 52 bytes at 0x0800BF3C. The attributes are <code>const</code>, so they stay in Flash too (<code>.rodata</code>).',
      q: '"The attributes are in RAM, right?" No: <code>const</code> data never needs to change, so it stays in Flash. <code>osThreadNew</code> reads it once and copies what it needs.' },
    { ch: 3, view: 'ram', hl: ['data', 'init'], fly: true, title: '.data: the first RAM shelves',
      text: 'Globals with a start value, like <code>int x = 5;</code>, go to <code>.data</code>. It begins on the very first RAM shelf, <b>0x20000000</b>: 112 bytes here. Their start values wait in Flash; after reset the startup code <b>copies</b> them over.',
      more: 'The map file says <code>.data 0x20000000 0x70 load address 0x0800df04</code>: it lives in RAM, but is loaded from Flash. More initialised globals → <code>.data</code> grows to higher addresses, and everything after it moves up. The linker recalculates it on every build.' },
    { ch: 3, view: 'ram', hl: ['bss'], zero: true, title: '.bss: right after .data',
      text: '<code>.bss</code> starts right where <code>.data</code> ends, at <b>0x20000070</b>. It holds every global that starts at 0, 27,832 bytes on our board. The startup code fills it all with zeros before <code>main()</code>.',
      q: '"Does .bss hold only uninitialised variables?" Both kinds: <code>int x;</code> and <code>int x = 0;</code>. A <code>static</code> variable inside a function also lands here, not on the stack.' },
    { ch: 3, view: 'ram', hl: ['heap'], kind: 'idea', headline: 'The linker builds an empty box: ucHeap', title: 'An empty box for FreeRTOS',
      text: 'Inside <code>.bss</code> sits one big array: <code>ucHeap</code>, 15,360 bytes at 0x200011D8. The linker reserves it, but puts <b>nothing</b> inside. It doesn\'t even know our task exists.',
      q: '"Does .bss end and then ucHeap start?" No: ucHeap is one <b>variable inside</b> .bss, with other globals before and after it. And there is only <b>one</b> ucHeap for all tasks.',
      more: 'It is declared in FreeRTOS\'s <code>heap_4.c</code>: <code>static uint8_t ucHeap[configTOTAL_HEAP_SIZE];</code>. That\'s why the map file shows <code>ucHeap</code>, but never "defaultTask stack". In our setup the Idle and timer tasks don\'t use it at all: their TCBs and stacks are fixed arrays in .bss.' },
    { ch: 3, view: 'ram', hl: ['msp'], msp: true, title: 'The main stack lives at the very top',
      text: 'The main stack (MSP) starts at <b>0x20020000</b>, one past the last shelf, and grows toward lower addresses. <code>main()</code> uses it, and later every interrupt handler. Globals fill RAM from the bottom up, the main stack from the top down.',
      more: 'The CPU subtracts 4 from SP <b>first</b> and then writes, so the first push lands on 0x2001FFFC – 0x2001FFFF: the last 4 shelves. Tasks don\'t use this stack: each gets its own, inside ucHeap.' },
    // 4 Run time
    { ch: 4, view: 'heap', heap: 0, hl: ['box'], title: 'Before osThreadNew: an empty box',
      text: 'The program starts. ucHeap is still 15,360 zero bytes. Now watch what <code>osThreadNew</code> does inside it, <b>while the program runs</b>.',
      side: ['Build time (the linker):', '   places the box, fixed address.', '', 'Run time (FreeRTOS):', '   cuts pieces out of the box.'], sideTitle: 'Two different moments' },
    { ch: 4, view: 'heap', heap: 1, raw: true, hl: ['dst'], title: 'pvPortMalloc(2048): the stack',
      text: '<code>osThreadNew</code> → <code>xTaskCreate</code> → <code>pvPortMalloc(2048)</code>. heap_4 cuts the first block from the front of the box. Our stack starts at <b>0x200011E0</b>, exactly what the debugger showed as Stack Start.',
      side: ['ucHeap starts at 0x200011D8.', 'It is already a multiple of 8,', 'so no bytes are lost at the start.', '', 'Block = 8 B header + 2048 B stack'], sideTitle: 'The first cut' },
    { ch: 4, view: 'heap', heap: 1, raw: true, hl: ['h1'], title: 'The 8-byte header',
      text: 'Every block starts with an 8-byte <b>header</b>: heap_4\'s own note with the block size and a link to the next free block. The stack begins right after it.',
      q: '"Is the header taken from my 2048?" No, it is <b>extra</b>: <code>pvPortMalloc(2048)</code> takes 2,056 bytes. And no, this header is <b>not</b> our missing 8 bytes.',
      side: ['header  0x200011D8 … 0x200011DF', 'stack   0x200011E0 … 0x200019DF', '', '8 + 2048 = 2,056 bytes taken'], sideTitle: 'The arithmetic',
      more: 'If the variable before the heap ended at an odd address, say 0x20000002, heap_4 would first round its start <b>up</b> to a multiple of 8 (0x20000008), then put the header there. The stack would start at 0x20000010.' },
    { ch: 4, view: 'heap', heap: 2, raw: true, hl: ['dtcb'], title: 'pvPortMalloc(616): the TCB',
      text: 'Next, FreeRTOS takes a second block for the task\'s <b>TCB</b>, the Task Control Block: its ID card. It lands right behind the stack, at <b>0x200019E8</b>. That number is the task\'s handle.',
      q: '"Does the TCB come right after 0x200011E0?" After the <b>whole stack</b> and its own header: 0x200011E0 + 2048 = 0x200019E0, + 8 = 0x200019E8.',
      side: ['Stack first, TCB second, on purpose:', 'a stack grows down, toward lower', 'addresses, so it grows away from its', 'own TCB.'], sideTitle: 'Why this order?' },
    { ch: 4, view: 'tcb', title: 'What is on the ID card',
      text: 'The scheduler never looks at your task function. It works only with these cards: where the task\'s stack is, how important it is, which list it hangs in. <code>pxTopOfStack</code> is first on the card, on purpose: PendSV reads it at offset 0.' },
    { ch: 4, view: 'tcb', split: true, kind: 'win', headline: 'Measured: 616 bytes = 104 for FreeRTOS + 512 for the C library', title: 'Why the card is so big',
      text: 'We asked the debugger: <code>p sizeof(struct _reent)</code> → <b>512</b>. Each TCB carries its own copy of the C library\'s state, so <code>printf</code> and <code>errno</code> are safe in every task.',
      more: 'That copy exists because of <code>configUSE_NEWLIB_REENTRANT = 1</code>. Without it, a TCB here would be about 104 bytes. The fields add up exactly: 92 bytes of fields, 4 of padding, 512 for <code>struct _reent</code>, 6 more bytes and 2 of padding = 616.' },
    { ch: 4, view: 'heap', heap: 3, hl: ['bst', 'btcb'], title: 'A second task: the same again',
      text: 'We add <code>blinkTask</code> with 1024 bytes. Header, stack at 0x20001C58, header, TCB at 0x20002060. Then <code>osKernelStart</code>: the Idle and timer tasks use fixed .bss arrays, so the box stays as it is. <b>11,016 bytes</b> are left.',
      side: ['Every block is a multiple of 8 bytes,', 'so the next one is aligned already:', 'no gaps between blocks.', '', 'Stacks are filled with 0xA5 here,', 'more on that soon.'], sideTitle: 'No gaps' },
    { ch: 4, view: 'heap', heap: 3, overflow: true, kind: 'problem', headline: 'An overflow breaks a different task', title: 'Neighbours in the box',
      text: 'blinkTask\'s stack sits right behind defaultTask\'s TCB. If blinkTask uses more than its 1024 bytes, it writes over <b>defaultTask\'s</b> ID card, and the crash shows up in the "wrong" task.',
      side: ['Red arrow: blinkTask\'s stack grows ↑', 'past its 1024 bytes, over the header,', 'into defaultTask\'s TCB.', '', 'Keep a margin on every stack.', 'FreeRTOS can check it for you:', 'configCHECK_FOR_STACK_OVERFLOW.'], sideTitle: 'What goes wrong' },
    // 5 Inside the stack
    { ch: 5, view: 'stack', mode: 'overview', title: 'What a task\'s stack holds',
      text: 'If code is in Flash and globals are in .data/.bss, what are the 1024 bytes for? Only things that exist <b>while functions run</b>: locals, return addresses, saved registers, and the task\'s frozen state.',
      q: '"Does an 8-bit variable take a whole 4-byte row?" Rows are only our drawing: memory has a label for every byte. Saved registers always take full words. Small locals often stay in registers, or the compiler packs them, or adds padding.' },
    { ch: 5, view: 'stack', mode: 'fill', title: 'Painted with 0xA5',
      text: 'When the task is created, FreeRTOS fills its whole stack with the byte <b>0xA5</b>. Wherever 0xA5 is gone later, the stack has been. That\'s how the debugger shows "Peak".' },
    { ch: 5, view: 'stack', mode: 'decode', kind: 'win', headline: 'Measured: 132 bytes = 36 + 32 + 64', title: 'A sleeping task, byte by byte',
      text: 'We paused the board while blinkTask slept in <code>osDelay(500)</code> and dumped its 132 used bytes. On top: 9 registers PendSV saved. Below: 8 the hardware saved. Then three call frames, each with a return address. You can even see the 500.',
      more: 'R2 = 0x10000000 and R3 = 0xE000ED04 are the "please switch" write: PENDSVSET into the ICSR register. The saved <b>PC</b> 0x08009C1A points into <code>vTaskDelay</code>, right after that write: the task will continue exactly there. The last word, 0x0800B641, is <code>prvTaskExitError</code>, a trap planted when the stack was prepared, in case the task function ever returns.' },
    { ch: 5, view: 'stack', mode: 'scan', kind: 'problem', headline: 'Peak 120, but Used 132? Peak can\'t be smaller!', title: 'A puzzle, solved by the dump',
      text: 'The debugger finds Peak by walking up from the bottom while it sees 0xA5. R4, R5 and R6 still hold <b>0xA5A5A5A5</b>: blinkTask never used them. So the walk only stops at R7, at 0x20001FD8.',
      more: 'Free = 0x20001FD8 − 0x20001C58 = 896, so Peak = 1016 − 896 = <b>120</b>, exactly the debugger\'s number. Why do registers hold 0xA5? When the task first started, R4–R11 were loaded from stack slots that were never written, so they contained the fill. Peak is an estimate: always keep a margin.' },
    // 6 The missing 8 bytes
    { ch: 6, view: 'toy', toy: 1, title: 'Back to our puzzle, with a toy stack',
      text: 'Let\'s shrink the problem: a stack of only <b>16 bytes</b> at 0x100, four words. FreeRTOS has to decide where the stack starts: at its high end. Rule 1: point at the <b>last word</b>, 0x10C.' },
    { ch: 6, view: 'toy', toy: 2, title: 'Rule 2: round down to a multiple of 8',
      text: '0x10C ÷ 8 = 33.5: not a whole number. FreeRTOS rounds <b>down</b> to 0x108. This becomes the top of the stack, "Stack End".' },
    { ch: 6, view: 'toy', toy: 3, title: 'The first push',
      text: 'A Cortex-M subtracts 4 from SP and then writes. So the first push lands at <b>0x104</b>, and the words 0x108 and 0x10C are never used. The debugger: Size = 0x108 − 0x100 = <b>8</b>, not 16.' },
    { ch: 6, view: 'toy', toy: 4, kind: 'idea', headline: 'The rule comes from the ARM calling standard, AAPCS', title: 'Why a multiple of 8?',
      text: 'Some values are 8 bytes long: <code>double</code>, <code>uint64_t</code>. The rule: they sit on 8-byte boundaries. The compiler puts them at SP+0, SP+8…, which only works if SP itself is a multiple of 8 at every function call.',
      q: '"Is it because the CPU reads 64 bits at a time?" No. The bus width changes speed, not this rule. The same rule holds on small 32-bit-bus Cortex-M chips.',
      more: 'Must SP <i>always</i> be a multiple of 8? At every function call and on every interrupt entry, yes; the CPU even re-aligns SP by itself when an interrupt arrives (the <code>STKALIGN</code> bit). Inside a function it may briefly be only a multiple of 4.' },
    { ch: 6, view: 'toy', toy: 3, toyText: 5, real: true, kind: 'win', headline: 'Found it: 0x200019D8 − 0x200011E0 = 2040', title: 'The same steps, with our real task',
      text: 'The stack ends at 0x200011E0 + 2048 = 0x200019E0. Rule 1: last word 0x200019DC. Rule 2: round down to <b>0x200019D8</b>. The top 8 bytes, 0x200019D8 – 0x200019DF, are never used. That\'s the debugger\'s 2040.',
      more: 'Why always exactly 8? heap_4 hands out blocks that start on a multiple of 8, and our sizes are multiples of 8, so the end is too. The last word is then never a multiple of 8 (it ends in …4 or …C). Rule 1 always costs 4 bytes, rule 2 always 4 more.' },
    { ch: 6, view: 'toy', toy: 3, toyText: 6, real: true, honest: true, title: 'The honest part',
      text: '0x200019E0 is itself a multiple of 8. A Cortex-M could start there and lose nothing. The 8 bytes are the price of FreeRTOS\'s common code being <b>careful</b>: it works on every CPU, including those that write first and subtract later.',
      more: 'FreeRTOS\'s <code>tasks.c</code> is the same for every CPU; only the small "port" layer is CPU-specific. The common code points at <code>&amp;stack[size − 1]</code> and rounds down; the Cortex-M port then simply uses that. A few bytes per task, in exchange for one simple rule everywhere.' },
  ];

  /* ============================================================ ENGINE */
  function bannerSvg(step, op) {
    if (!step.kind) return '';
    const [icon, label] = KIND[step.kind];
    return `<g class="ban-wrap" opacity="${op}"><rect x="130" y="494" width="840" height="58" rx="14" class="ban ban-${step.kind}"/>
      <text x="170" y="533" text-anchor="middle" font-size="28">${icon}</text>
      <text x="204" y="514" font-size="11" font-weight="800" class="ban-label">${label}</text>
      <text x="204" y="538" font-size="17" font-weight="800">${step.headline}</text></g>`;
  }
  function frame(i, t) {
    const step = STEPS[i], prev = STEPS[Math.max(0, i - 1)];
    const moving = t < 1 && i > 0;
    const sameView = prev.view === step.view;
    const fade = moving && !sameView ? clamp01(t * 2.5) : 1;
    const c = { step, prev, t, moving };
    let o = `<svg viewBox="0 0 1100 560" role="img" aria-label="${esc(step.title)}">${DEFS}<g opacity="${fade}">`;
    o += VIEWS[step.view](c);
    o += '</g>' + bannerSvg(step, moving ? clamp01((t - 0.5) * 3) : 1);
    return o + '</svg>';
  }

  const params = new URLSearchParams(location.search);
  const video = params.has('video');
  if (video) document.body.classList.add('video');
  const firstOf = (ch) => STEPS.findIndex((s) => s.ch === ch);
  const lastOf = (ch) => STEPS.length - 1 - [...STEPS].reverse().findIndex((s) => s.ch === ch);
  const startCh = Math.min(CH.length, Math.max(1, Number(params.get('ch')) || 1));
  const endCh = Math.min(CH.length, Math.max(startCh, Number(params.get('end')) || CH.length));
  const FIRST = firstOf(startCh), LAST = video ? lastOf(endCh) : STEPS.length - 1;
  const stepParam = Number(params.get('step'));
  const START = stepParam >= 1 && stepParam <= STEPS.length ? stepParam - 1 : FIRST;
  const anim = { i: START, t: 1, raf: 0, last: 0, auto: false, wait: 0 };
  if (stepParam && params.has('t')) anim.t = clamp01(Number(params.get('t')));
  let moreOpen = false;

  const SPEED = {
    slow: { dur: 1300, dwell: (s) => 1600 + s.text.length * 28 },
    normal: { dur: 900, dwell: (s) => 1000 + s.text.length * 18 },
    fast: { dur: 450, dwell: (s) => 450 + s.text.length * 9 },
  };
  function renderChapters() {
    const ch = STEPS[anim.i].ch;
    $('#chapters').innerHTML = CH.map((n, k) => `<button data-ch="${k + 1}" class="${k + 1 === ch ? 'on' : ''}">${k + 1}. ${n}</button>`).join('');
  }
  function renderPopup() {
    const s = STEPS[anim.i], last = anim.i === LAST;
    const pop = $('#popup');
    pop.className = `popup${s.kind ? ` ${s.kind}` : ''}`;
    const icon = s.kind ? `${KIND[s.kind][0]} ` : '';
    const more = s.more ? `<details class="more"${moreOpen ? ' open' : ''}><summary>🔍 Look closer</summary><div>${s.more}</div></details>` : '';
    pop.innerHTML = `<div class="stepno">Chapter ${s.ch}: ${CH[s.ch - 1]} · Step ${anim.i + 1} of ${STEPS.length}</div>
      <div class="title">${icon}${s.title}</div><div>${s.text}</div>
      ${s.q ? `<div class="q">❓ <b>Common question:</b> ${s.q}</div>` : ''}${more}
      <div class="nav"><button data-nav="back" ${anim.i === FIRST ? 'disabled' : ''}>◀ Back</button>${last
        ? '<button data-nav="restart" class="primary">↻ Start again</button>'
        : '<button data-nav="next" class="primary">Next ▶</button>'}</div>`;
    const d = pop.querySelector('details');
    if (d) d.addEventListener('toggle', () => { moreOpen = d.open; });
    $('#btn-play').textContent = anim.auto ? '❚❚ Pause' : '▶ Auto-play';
    renderChapters();
  }
  function draw() { $('#scene').innerHTML = frame(anim.i, anim.t); }
  function tick(now) {
    const dt = now - anim.last;
    anim.last = now;
    const sp = SPEED[$('#speed').value];
    const dur = STEPS[anim.i].mode === 'scan' ? sp.dur * 2.6 : sp.dur;
    if (anim.t < 1) {
      anim.t = clamp01(anim.t + dt / dur);
      draw();
      if (anim.t >= 1) anim.wait = sp.dwell(STEPS[anim.i]);
      anim.raf = requestAnimationFrame(tick);
    } else if (anim.auto) {
      anim.wait -= dt;
      if (anim.wait <= 0) { if (anim.i < LAST) goNext(); else { anim.auto = false; renderPopup(); return; } }
      anim.raf = requestAnimationFrame(tick);
    }
  }
  let scrolled = video;
  function bringIntoView() { if (scrolled) return; scrolled = true; $('.toolbar').scrollIntoView({ block: 'start' }); }
  function run() { bringIntoView(); cancelAnimationFrame(anim.raf); anim.last = performance.now(); anim.raf = requestAnimationFrame(tick); }
  function goNext() { anim.i += 1; anim.t = 0; renderPopup(); draw(); }
  function jump(i) { cancelAnimationFrame(anim.raf); anim.auto = false; anim.i = i; anim.t = 1; renderPopup(); draw(); }

  $('#popup').addEventListener('click', (e) => {
    const b = e.target.closest('[data-nav]');
    if (!b) return;
    if (b.dataset.nav === 'next') { anim.auto = false; goNext(); run(); }
    else if (b.dataset.nav === 'back') jump(Math.max(FIRST, anim.i - 1));
    else jump(FIRST);
  });
  $('#chapters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ch]');
    if (b) { jump(firstOf(Number(b.dataset.ch))); bringIntoView(); }
  });
  $('#btn-restart').onclick = () => jump(FIRST);
  $('#btn-play').onclick = () => {
    if (anim.auto) { anim.auto = false; cancelAnimationFrame(anim.raf); anim.t = 1; draw(); renderPopup(); return; }
    if (anim.i === LAST) jump(FIRST);
    anim.auto = true; anim.wait = 0; renderPopup(); run();
  };
  document.addEventListener('keydown', (e) => {
    if (e.target instanceof Element && e.target.closest('select, input, textarea, summary')) return;
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); if (anim.i < LAST) { anim.auto = false; goNext(); run(); } }
    else if (e.key === 'ArrowLeft') jump(Math.max(FIRST, anim.i - 1));
  });
  if (params.get('speed') && SPEED[params.get('speed')]) $('#speed').value = params.get('speed');
  renderPopup();
  draw();
})();
