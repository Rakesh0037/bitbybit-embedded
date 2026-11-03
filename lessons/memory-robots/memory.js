/* BitByBit Embedded - "Where do your variables live?" lesson.
 *
 * The story is a list of steps. Each step changes the scene state (items,
 * labels, robot position); the state of every step is computed up front, so
 * Next animates from one state to the next and Back simply jumps.
 */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const lerp = (a, b, t) => a + (b - a) * t;

  const CODE = [
    'int a = 5;',
    'int b;',
    'const int c = 7;',
    'void f(void) { int x = 3; }',
    'int main(void) {',
    '  f();  b = a + c;  a = 6;',
    '  while (1) { }  }',
  ];

  const ROBOTS = {
    compiler: { name: 'Compiler', home: [60, 88] },
    linker: { name: 'Linker', home: [160, 88] },
    flasher: { name: 'Flasher', home: [260, 88] },
    startup: { name: 'Startup', home: [640, 88] },
    cpu: { name: 'CPU', home: [740, 88] },
  };

  // Where things go: x, y of the top-left corner of a box
  const TABLE = { text: [22, 250], rodata: [262, 250], data: [22, 320], bss: [262, 320], vec: [22, 390] };
  const FLASH = { vec: [492, 167], text: [562, 200], rodata: [562, 282], data: [562, 364] };
  const RAM = { data: [872, 146], bss: [872, 226], stack: [872, 386] };
  const BOX_W = 176, BOX_H = 66;
  const center = (p) => [p[0] + BOX_W / 2, p[1] + BOX_H / 2];
  // A robot stands just left of what it works on
  const stand = (p) => [Math.max(44, p[0] - 24), p[1] + 70];
  // On the PC, a robot walks down the aisle between the two columns of boxes
  const standPc = (p) => [p[0] < 200 ? 224 : 236, p[1] + 66];

  const initial = {
    power: 'off',
    pcDim: false,
    plan: false,
    elf: false,
    items: {
      vec: { x: TABLE.vec[0], y: TABLE.vec[1], shown: false, cls: 'text', slim: true, label: 'vector table', tags: [] },
      text: { x: TABLE.text[0], y: TABLE.text[1], shown: false, cls: 'text', sec: '.text', label: 'startup, f, main', tags: [] },
      rodata: { x: TABLE.rodata[0], y: TABLE.rodata[1], shown: false, cls: 'rodata', sec: '.rodata', label: 'c = 7', tags: [] },
      data: { x: TABLE.data[0], y: TABLE.data[1], shown: false, cls: 'data', sec: '.data', label: 'a = 5', tags: [] },
      bss: { x: TABLE.bss[0], y: TABLE.bss[1], shown: false, cls: 'bss', sec: '.bss', label: 'b (no value)', tags: [] },
      ramA: { x: RAM.data[0], y: RAM.data[1], shown: false, cls: 'junk', sec: '.data', label: 'a = ?', tags: [] },
      ramB: { x: RAM.bss[0], y: RAM.bss[1], shown: false, cls: 'junk', sec: '.bss', label: 'b = ?', tags: [] },
      stackX: { x: RAM.stack[0], y: RAM.stack[1], shown: false, cls: 'stack', sec: 'stack', label: 'x = 3', tags: [] },
    },
    robots: Object.fromEntries(Object.entries(ROBOTS).map(([k, r]) => [k, [...r.home]])),
  };

  const TAG = {
    text: 'Flash 0x0800 02D0',
    rodata: 'Flash 0x0800 1200',
    dataRam: 'lives: RAM 0x2000 0000',
    dataFlash: 'value: Flash 0x0800 1204',
    bss: 'lives: RAM 0x2000 0004',
  };
  const ramLive = (cls, label, tags = []) => ({ cls, label, tags });
  const powerOn = (over = {}) => ({
    power: 'on',
    pcDim: true,
    plan: false,
    items: {
      bss: { shown: false },
      ramA: { shown: true, cls: 'junk', label: 'a = ? (junk)', ...over.ramA },
      ramB: { shown: true, cls: 'junk', label: 'b = ? (junk)', ...over.ramB },
      stackX: { shown: false },
    },
  });

  /* Each step: robot (who works), to (where it ends up), line (code line to
   * mark), go (items it carries), fly (temporary tokens it carries), set
   * (state changes), focus (box to outline). */
  const STEPS = [
    {
      title: 'One small program, five robots',
      text: 'On your PC is this program. It has an initialized global, an uninitialized global, a constant, a local and some code. The robots will decide where each one lives. Press <b>Next</b>.',
      focus: [22, 116, 416, 126],
    },

    // Compiler: sorts into boxes
    {
      robot: 'compiler', line: 0, to: standPc(TABLE.data),
      title: 'Compiler: int a = 5;',
      text: 'The Compiler translates your C code and sorts everything into labelled boxes called <b>sections</b>. <code>a</code> has a starting value, so it goes into a <b>.data</b> box, with the 5 inside.',
      set: { items: { data: { shown: true } } },
    },
    {
      robot: 'compiler', line: 1, to: standPc(TABLE.bss),
      title: 'Compiler: int b;',
      text: '<code>b</code> has no starting value, so there is nothing to keep. It goes into a <b>.bss</b> box, which only records its name and size.',
      set: { items: { bss: { shown: true } } },
    },
    {
      robot: 'compiler', line: 2, to: standPc(TABLE.rodata),
      title: 'Compiler: const int c = 7;',
      text: '<code>c</code> never changes, so it goes into <b>.rodata</b> (read-only data).',
      set: { items: { rodata: { shown: true } } },
    },
    {
      robot: 'compiler', line: 3, to: standPc(TABLE.text),
      title: 'Compiler: the code',
      text: 'Functions become machine instructions in <b>.text</b>. The startup file is compiled too: its code goes here, and it brings the <b>vector table</b>, the list of start addresses for the CPU. <b>The local <code>x</code> gets no box at all.</b> It only exists as instructions inside <code>f()</code>: "make room on the stack, write 3".',
      set: { items: { text: { shown: true }, vec: { shown: true } } },
    },

    // Linker: writes the tags
    {
      robot: 'linker', to: [50, 505],
      title: 'Linker: reads the cupboard plan',
      text: 'The boxes have no addresses yet. The Linker reads the <b>linker script</b>, a plan that says which cupboards exist, where they start, and which boxes go in which one.',
      set: { plan: true },
      focus: [22, 416, 416, 126],
    },
    {
      robot: 'linker', to: standPc(TABLE.text),
      title: 'Linker: tags for code and constants',
      text: 'The Linker writes an <b>address tag</b> on each box. The vector table gets the very first address in Flash, because that is where the CPU looks after a reset. Code and constants come after it, and they only need a place in Flash.',
      set: { items: { vec: { label: 'vector table  0x0800 0000' }, text: { tags: [TAG.text] }, rodata: { tags: [TAG.rodata] } } },
    },
    {
      robot: 'linker', line: 0, to: standPc(TABLE.data),
      title: 'Linker: two tags for a',
      text: '<code>a</code> needs <b>two</b> tags. It must change while the program runs, so it <b>lives in RAM</b>. But RAM forgets everything at power-off, so its starting value 5 is <b>kept in Flash</b>.',
      set: { items: { data: { tags: [TAG.dataRam, TAG.dataFlash] } } },
      focus: [TABLE.data[0] - 4, TABLE.data[1] - 4, BOX_W + 8, BOX_H + 8],
    },
    {
      robot: 'linker', line: 1, to: standPc(TABLE.bss),
      title: 'Linker: one tag for b',
      text: '<code>b</code> only needs a place in RAM. There is no value to keep, so it takes <b>no space in Flash</b>. The Linker has now stored nothing anywhere. It only wrote tags, and filled these addresses into the code.',
      set: { items: { bss: { tags: [TAG.bss] } } },
      focus: [TABLE.bss[0] - 4, TABLE.bss[1] - 4, BOX_W + 8, BOX_H + 8],
    },
    {
      robot: 'linker', to: standPc(TABLE.text),
      title: 'Linker: a to-do list for Startup',
      text: 'Who will fill RAM later? Startup, so it must know where. The Linker writes the numbers <b>into the startup code</b>: where <code>.data</code> is (<code>_sdata</code>, <code>_edata</code>), where its values are in Flash (<code>_sidata</code>), and where <code>.bss</code> is (<code>_sbss</code>, <code>_ebss</code>). This list travels inside <code>.text</code>.',
      set: { items: { text: { tags: [TAG.text, 'to-do: .data copy, .bss 0'] } } },
      focus: [TABLE.text[0] - 4, TABLE.text[1] - 4, BOX_W + 8, BOX_H + 8],
    },

    // Flasher: fills Flash
    {
      robot: 'flasher', go: ['vec'], to: [462, 196],
      title: 'Flasher: the vector table goes first',
      text: 'You press "program". The Flasher is the tool that writes to the chip through the debugger. The vector table goes to the very start of Flash, at the address on its tag.',
      set: { power: 'prog', items: { vec: { x: FLASH.vec[0], y: FLASH.vec[1] } } },
    },
    {
      robot: 'flasher', go: ['text'], to: stand(FLASH.text),
      title: 'Flasher: carries the code to Flash',
      text: 'The code goes right after the vector table. That is why <code>.text</code> does not start at the first address of Flash.',
      set: { items: { text: { x: FLASH.text[0], y: FLASH.text[1] } } },
    },
    {
      robot: 'flasher', go: ['rodata'], to: stand(FLASH.rodata),
      title: 'Flasher: carries the constant to Flash',
      text: 'The constant <code>c = 7</code> goes into Flash too.',
      set: { items: { rodata: { x: FLASH.rodata[0], y: FLASH.rodata[1] } } },
    },
    {
      robot: 'flasher', go: ['data'], to: stand(FLASH.data),
      title: 'Flasher: carries the value of a to Flash',
      text: 'The <b>starting value</b> of <code>a</code> goes into Flash, following its second tag. <code>a</code> itself is not in RAM yet.',
      set: { items: { data: { x: FLASH.data[0], y: FLASH.data[1], label: 'a = 5 (original)' } } },
    },
    {
      robot: 'flasher', line: 1, to: [260, 88],
      title: 'Flasher: nothing to carry for b',
      text: '<code>b</code> has no value, so there is nothing to carry. Where it lives is <b>already in Flash</b>, in the to-do list inside <code>.text</code>. The Flasher also carries <b>nothing to RAM</b>, since RAM would forget it anyway. Programming is finished, and we switch the board off.',
      set: { power: 'off' },
      focus: [TABLE.bss[0] - 4, TABLE.bss[1] - 4, BOX_W + 8, BOX_H + 8],
    },

    // Power on: Startup
    {
      robot: 'startup', to: [640, 88],
      title: 'Power on: RAM is full of junk',
      text: 'Power on! The PC is no longer needed: the chip runs alone, and the <code>.bss</code> box on the PC was only a note for the Linker. Flash has everything. <b>RAM contains random values.</b>',
      set: powerOn(),
      focus: [790, 122, 290, 420],
    },
    {
      robot: 'cpu', to: [462, 196],
      title: 'CPU: reads the vector table',
      text: 'After a reset the CPU reads the first two entries of the vector table: the <b>stack address</b> and the <b>location of the startup code</b>. Then it starts running that code. Startup sets the stack pointer first.',
      focus: [FLASH.vec[0] - 4, FLASH.vec[1] - 4, 266, 30],
    },
    {
      robot: 'startup', to: stand(FLASH.text),
      title: 'Startup: reads its to-do list',
      text: 'How does Startup know where everything is? It reads the numbers from <b>its own code in Flash</b>, the list the Linker wrote: copy <code>.data</code> from here to there, and write 0 over <code>.bss</code> from here to there.',
      focus: [FLASH.text[0] - 4, FLASH.text[1] - 4, BOX_W + 8, BOX_H + 8],
    },
    {
      robot: 'startup', line: 0, to: stand(RAM.data),
      fly: [{ from: center(FLASH.data), to: center(RAM.data), label: '5', cls: 'r-flasher' }],
      title: 'Startup: copies a from Flash to RAM',
      text: 'Startup <b>copies</b> the value 5 from Flash to the address where <code>a</code> lives. It is a copy: the original stays in Flash.',
      set: { items: { ramA: ramLive('data', 'a = 5') } },
    },
    {
      robot: 'startup', line: 1, to: stand(RAM.bss),
      title: 'Startup: writes 0 over b',
      text: 'The list says <code>.bss</code> runs from <code>_sbss</code> to <code>_ebss</code>. Startup writes <b>0</b> to those addresses, and the value 0 comes from Startup itself. This small loop is why C can promise that uninitialized globals start at 0.',
      set: { items: { ramB: ramLive('bss', 'b = 0') } },
    },
    {
      robot: 'startup', line: 4, to: [640, 88],
      title: 'Startup: calls main()',
      text: 'Everything is ready, so Startup calls <code>main()</code>. A secret: Startup is not really a separate worker. It is code that the CPU runs from Flash. We only drew it as a robot to show its job.',
      focus: [FLASH.text[0] - 4, FLASH.text[1] - 4, BOX_W + 8, BOX_H + 8],
    },

    // CPU: running
    {
      robot: 'cpu', line: 3, to: stand(RAM.stack),
      title: 'CPU: f() runs, x appears',
      text: 'The CPU reads instructions from Flash and calls <code>f()</code>. The instructions make room on the <b>stack</b> and write 3. <b>Only now does <code>x</code> exist.</b> No robot gave it a fixed address earlier.',
      set: { items: { stackX: { shown: true } } },
    },
    {
      robot: 'cpu', line: 3, to: stand(RAM.stack),
      title: 'CPU: f() returns, x is gone',
      text: 'When <code>f()</code> returns, its room on the stack is given back and <code>x</code> is gone. The next function call can reuse that space. That\'s why you must never keep a pointer to a local after its function has returned.',
      set: { items: { stackX: { shown: false } } },
      focus: [800, 382, 272, 76],
    },
    {
      robot: 'cpu', line: 5, to: [776, 300],
      fly: [
        { from: center(RAM.data), to: [790, 268], label: '5', cls: 'r-flasher' },
        { from: center(FLASH.rodata), to: [790, 268], label: '7', cls: 'r-linker' },
      ],
      title: 'CPU: b = a + c, reading',
      text: 'The CPU reads <code>a</code> from <b>RAM</b> and <code>c</code> from <b>Flash</b>, using the addresses the Linker wrote into the code. 5 + 7 = 12.',
    },
    {
      robot: 'cpu', line: 5, to: stand(RAM.bss),
      fly: [{ from: [790, 268], to: center(RAM.bss), label: '12', cls: 'r-cpu' }],
      title: 'CPU: b = a + c, writing',
      text: 'The result goes into <code>b</code> in RAM. Variables in RAM can change: that is why they are there.',
      set: { items: { ramB: { label: 'b = 12' } } },
    },
    {
      robot: 'cpu', line: 5, to: stand(RAM.data),
      title: 'CPU: a = 6',
      text: 'The CPU changes <code>a</code> to 6, <b>in RAM only</b>. Look at Flash: the original still says 5.',
      set: { items: { ramA: { label: 'a = 6' } } },
      focus: [FLASH.data[0] - 4, FLASH.data[1] - 4, BOX_W + 8, BOX_H + 8],
    },

    // Power cycle
    {
      to: null,
      title: 'Power off',
      text: '<b>RAM is empty.</b> <code>a</code> and <code>b</code> are gone, and your 6 and 12 with them. Flash has not changed: code, constant and the original 5 are all still there.',
      set: { power: 'off', items: { ramA: { shown: false }, ramB: { shown: false } } },
      focus: [472, 122, 298, 420],
    },
    {
      robot: 'startup', to: [640, 88],
      title: 'Power on again: junk again',
      text: 'Power on: RAM is random again. Startup has the same work to do, at <b>every</b> reset.',
      set: powerOn(),
      focus: [790, 122, 290, 420],
    },
    {
      robot: 'startup', line: 0, to: stand(RAM.data),
      fly: [{ from: center(FLASH.data), to: center(RAM.data), label: '5', cls: 'r-flasher' }],
      title: 'Startup: a is 5 again',
      text: 'Startup copies the original from Flash again. <code>a</code> is <b>5, not 6</b>. To keep a value across a reset, your program must save it to Flash or other non-volatile memory itself.',
      set: { items: { ramA: ramLive('data', 'a = 5') } },
    },
    {
      robot: 'startup', line: 1, to: stand(RAM.bss),
      title: 'Startup: b is 0 again',
      text: 'And <code>b</code> is 0 again, not 12. Then <code>main()</code> starts from the beginning. <b>Now you know who puts everything where, and when.</b> The table below has the whole picture.',
      set: { items: { ramB: ramLive('bss', 'b = 0') } },
    },
  ];

  // ---------------------------------------------------------------- states

  function applySet(st, set) {
    const { items, ...rest } = set;
    Object.assign(st, rest);
    if (items) for (const [id, p] of Object.entries(items)) Object.assign(st.items[id], p);
  }

  const STATES = [];
  {
    let st = JSON.parse(JSON.stringify(initial));
    STEPS.forEach((s) => {
      st = JSON.parse(JSON.stringify(st));
      // Whoever is not working walks back to their place
      for (const k of Object.keys(ROBOTS)) if (k !== s.robot) st.robots[k] = [...ROBOTS[k].home];
      if (s.robot && s.to) st.robots[s.robot] = [...s.to];
      if (s.set) applySet(st, s.set);
      STATES.push(st);
    });
  }

  // ---------------------------------------------------------------- drawing

  function robotSvg(key, x, y, active, walking) {
    const c = `r-${key}`;
    const swing = walking ? Math.sin(walking * Math.PI * 8) * 4 : 0;
    return `<g opacity="${active ? 1 : 0.55}">
      <line x1="${x}" y1="${y - 62}" x2="${x}" y2="${y - 70}" class="${c}" stroke-width="2"/>
      <circle cx="${x}" cy="${y - 72}" r="3" class="${c}"${active ? ' opacity="1"' : ''}/>
      <rect x="${x - 13}" y="${y - 62}" width="26" height="19" rx="5" class="${c}"/>
      <circle cx="${x - 5}" cy="${y - 53}" r="2.6" fill="#fff"/><circle cx="${x + 5}" cy="${y - 53}" r="2.6" fill="#fff"/>
      <rect x="${x - 23}" y="${y - 41}" width="46" height="27" rx="4" class="${c}"/>
      <line x1="${x - 23}" y1="${y - 36}" x2="${x - 31}" y2="${y - 24 - swing}" class="${c}" stroke-width="3.5"/>
      <line x1="${x + 23}" y1="${y - 36}" x2="${x + 31}" y2="${y - 24 + swing}" class="${c}" stroke-width="3.5"/>
      <line x1="${x - 7}" y1="${y - 14}" x2="${x - 7 + swing}" y2="${y}" class="${c}" stroke-width="4"/>
      <line x1="${x + 7}" y1="${y - 14}" x2="${x + 7 - swing}" y2="${y}" class="${c}" stroke-width="4"/>
      <text x="${x}" y="${y - 22}" text-anchor="middle" font-size="9" font-weight="700" class="tw">${ROBOTS[key].name}</text>
    </g>`;
  }

  function boxSvg(it, x, y, opacity) {
    if (it.slim) {
      return `<g opacity="${opacity}"><rect x="${x}" y="${y}" width="258" height="22" rx="5" class="box ${it.cls}"/><text x="${x + 8}" y="${y + 15}" font-size="11.5" font-weight="700" class="mono" xml:space="preserve">${it.label}</text></g>`;
    }
    let o = `<g opacity="${opacity}">`;
    o += `<rect x="${x}" y="${y}" width="${BOX_W}" height="${BOX_H}" rx="6" class="box ${it.cls}"/>`;
    o += `<text x="${x + 10}" y="${y + 19}" font-size="11" class="muted mono">${it.sec}</text>`;
    o += `<text x="${x + 10}" y="${y + 36}" font-size="13.5" font-weight="700" class="mono">${it.label}</text>`;
    it.tags.forEach((t, i) => { o += `<text x="${x + 10}" y="${y + 49 + i * 12}" class="tagline">${t}</text>`; });
    return o + '</g>';
  }

  function sceneStatic(st, step) {
    const dim = st.pcDim ? ' opacity="0.45"' : '';
    let o = '<svg viewBox="0 0 1100 556" role="img" aria-label="Robots move a program from the PC into Flash and RAM">';
    // Zones
    o += '<rect x="10" y="94" width="440" height="456" rx="10" class="zone"/>';
    o += '<text x="24" y="112" font-weight="700" font-size="14">YOUR PC</text>';
    o += '<rect x="462" y="94" width="628" height="456" rx="10" class="zone"/>';
    o += '<text x="476" y="112" font-weight="700" font-size="14">STM32 CHIP</text>';
    const pw = { on: ['power-on', 'POWER ON'], off: ['power-off', 'POWER OFF'], prog: ['power-prog', 'PROGRAMMING'] }[st.power];
    o += `<circle cx="580" cy="107" r="6" class="${pw[0]}"/><text x="592" y="112" font-size="12" font-weight="600">${pw[1]}</text>`;

    // Source file
    o += '<rect x="22" y="118" width="416" height="124" rx="6" class="sheet"/>';
    CODE.forEach((l, i) => {
      const y = 138 + i * 15.5;
      if (step.line === i) o += `<rect x="28" y="${y - 12}" width="404" height="15.5" rx="3" class="codeline"/>`;
      o += `<text x="34" y="${y}" font-size="12.5" class="mono" xml:space="preserve">${l}</text>`;
    });

    // Linker script
    if (st.plan) {
      o += `<g${dim}><rect x="22" y="418" width="416" height="122" rx="6" class="sheet"/>`;
      o += '<text x="84" y="438" font-size="12" font-weight="700">Linker script: the cupboard plan</text>';
      ['FLASH  starts at 0x0800 0000', 'RAM    starts at 0x2000 0000', '.text .rodata           → Flash', '.data → RAM, value kept in Flash', '.bss, heap, stack       → RAM'].forEach((l, i) => {
        o += `<text x="84" y="${456 + i * 16}" font-size="11" class="mono" xml:space="preserve">${l}</text>`;
      });
      o += '</g>';
    }

    // Cupboards
    const shelf = (x, y, w, h, t) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" class="slot"/><text x="${x + 8}" y="${y + 15}" font-size="11" font-weight="600" class="muted mono">${t}</text>`;
    o += '<rect x="474" y="122" width="296" height="420" rx="8" class="cupboard"/>';
    o += '<text x="622" y="139" text-anchor="middle" font-size="12.5" font-weight="700">FLASH: keeps its contents without power</text>';
    o += shelf(484, 144, 276, 48, '.isr_vector') + shelf(484, 196, 276, 76, '.text') + shelf(484, 278, 276, 76, '.rodata') + shelf(484, 360, 276, 76, '.data');
    o += '<rect x="790" y="122" width="290" height="420" rx="8" class="cupboard"/>';
    o += '<text x="935" y="139" text-anchor="middle" font-size="12.5" font-weight="700">RAM: empty at power-off</text>';
    o += shelf(800, 142, 270, 74, '.data') + shelf(800, 222, 270, 74, '.bss') + shelf(800, 302, 270, 74, 'heap') + shelf(800, 382, 270, 76, 'stack');
    o += '<text x="880" y="344" font-size="11" class="muted">used only if you call malloc()</text>';
    return o;
  }

  function frame(i, t) {
    const st = STATES[i], prev = STATES[Math.max(0, i - 1)], step = STEPS[i];
    let o = sceneStatic(t < 0.6 ? prev : st, step);
    const moves = t < 1 && i > 0;
    const phase = clamp01((t - 0.4) / 0.6); // the carrying part of a step

    // Boxes
    for (const id of Object.keys(st.items)) {
      const a = prev.items[id], b = st.items[id];
      if (!b.shown && (!a.shown || !moves)) continue;
      const carried = (step.go || []).includes(id);
      const k = !moves ? 1 : carried ? phase : t;
      const it = t < 0.6 && moves ? a : b;
      let op = 1;
      if (moves && !a.shown) op = t;
      if (moves && !b.shown) op = 1 - t;
      const dim = it.x < 450 && st.pcDim ? 0.45 : 1;
      o += boxSvg(a.shown ? it : b, lerp(a.x, b.x, k), lerp(a.y, b.y, k), op * dim);
    }

    // Carried tokens
    const flies = step.fly || [];
    if (moves) flies.forEach((f) => {
      if (phase <= 0) return;
      const x = lerp(f.from[0], f.to[0], phase), y = lerp(f.from[1], f.to[1], phase);
      o += `<circle cx="${x}" cy="${y}" r="14" class="${f.cls}"/><text x="${x}" y="${y + 5}" text-anchor="middle" font-size="13" font-weight="700" class="tw mono">${f.label}</text>`;
    });

    if (!moves && step.focus) {
      const [x, y, w, h] = step.focus;
      o += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" class="focus"/>`;
    }

    // Robots
    for (const k of Object.keys(ROBOTS)) {
      const a = prev.robots[k], b = st.robots[k];
      const active = k === step.robot;
      let x = b[0], y = b[1], walking = 0;
      if (moves) {
        const carrying = active && ((step.go && step.go.length) || flies.length);
        if (carrying) {
          // Walk to what it carries first, then carry it to the end position
          const src = step.go ? [prev.items[step.go[0]].x, prev.items[step.go[0]].y] : [flies[0].from[0] - BOX_W / 2, flies[0].from[1] - BOX_H / 2];
          const pick = src[0] < 450 ? standPc(src) : stand(src);
          if (t < 0.4) { const q = t / 0.4; x = lerp(a[0], pick[0], q); y = lerp(a[1], pick[1], q); } else { x = lerp(pick[0], b[0], phase); y = lerp(pick[1], b[1], phase); }
        } else {
          x = lerp(a[0], b[0], t); y = lerp(a[1], b[1], t);
        }
        walking = (x !== b[0] || y !== b[1]) ? t : 0;
      }
      o += robotSvg(k, x, y, active || !step.robot, walking);
    }
    return o + '</svg>';
  }

  // ---------------------------------------------------------------- playback

  const anim = { i: 0, t: 1, raf: 0, last: 0, auto: false, wait: 0 };
  const SPEED = {
    slow: { dur: 1000, dwell: (s) => 700 + s.text.length * 16 },
    normal: { dur: 600, dwell: (s) => 300 + s.text.length * 9 },
    fast: { dur: 280, dwell: (s) => 100 + s.text.length * 3 },
  };

  function renderPopup() {
    const s = STEPS[anim.i], last = anim.i === STEPS.length - 1;
    $('#popup').innerHTML = `<div class="stepno">Step ${anim.i + 1} of ${STEPS.length}</div>
      <div class="title">${s.title}</div><div>${s.text}</div>
      <div class="nav"><button data-nav="back" ${anim.i === 0 ? 'disabled' : ''}>◀ Back</button>${last
        ? '<button data-nav="restart" class="primary">↻ Start again</button>'
        : '<button data-nav="next" class="primary">Next ▶</button>'}</div>`;
    $('#btn-play').textContent = anim.auto ? '❚❚ Pause' : '▶ Auto-play';
  }

  function draw() { $('#scene').innerHTML = frame(anim.i, anim.t); }

  function tick(now) {
    const dt = now - anim.last;
    anim.last = now;
    const sp = SPEED[$('#speed').value];
    if (anim.t < 1) {
      anim.t = clamp01(anim.t + dt / sp.dur);
      draw();
      if (anim.t >= 1) anim.wait = sp.dwell(STEPS[anim.i]);
      anim.raf = requestAnimationFrame(tick);
    } else if (anim.auto) {
      anim.wait -= dt;
      if (anim.wait <= 0) {
        if (anim.i < STEPS.length - 1) goNext(); else { anim.auto = false; renderPopup(); return; }
      }
      anim.raf = requestAnimationFrame(tick);
    }
  }

  // The first time the story moves, bring the scene and popup into view
  let scrolled = false;
  function bringIntoView() {
    if (scrolled) return;
    scrolled = true;
    $('.toolbar').scrollIntoView({ block: 'start' });
  }

  function run() {
    bringIntoView();
    cancelAnimationFrame(anim.raf);
    anim.last = performance.now();
    anim.raf = requestAnimationFrame(tick);
  }

  function goNext() {
    anim.i += 1;
    anim.t = 0;
    renderPopup();
    draw();
  }

  function jump(i) {
    cancelAnimationFrame(anim.raf);
    anim.auto = false;
    anim.i = i;
    anim.t = 1;
    renderPopup();
    draw();
  }

  $('#popup').addEventListener('click', (e) => {
    const b = e.target.closest('[data-nav]');
    if (!b) return;
    if (b.dataset.nav === 'next') {
      anim.auto = false;
      goNext();
      run();
    } else if (b.dataset.nav === 'back') {
      jump(Math.max(0, anim.i - 1));
    } else {
      jump(0);
    }
  });
  $('#btn-restart').onclick = () => jump(0);
  $('#btn-play').onclick = () => {
    if (anim.auto) { anim.auto = false; cancelAnimationFrame(anim.raf); anim.t = 1; draw(); renderPopup(); return; }
    if (anim.i === STEPS.length - 1) jump(0);
    anim.auto = true;
    anim.wait = 0;
    renderPopup();
    run();
  };

  renderPopup();
  draw();
})();
