/* BitByBit Embedded - "UART at 100x zoom" lesson.
 *
 * One DMA send of "Blink 10\r\n", stopped at every moment a register bit
 * changes. Every step changes the state; the scene compares it with the
 * previous state and lights up each changed field in the colour of whoever
 * changed it: CPU, UART, DMA or NVIC.
 */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const MSG = ['B', 'l', 'i', 'n', 'k', ' ', '1', '0', '\r', '\n'];
  const SHOW = (c) => (c === ' ' ? '␣' : c === '\r' ? '\\r' : c === '\n' ? '\\n' : c);
  const frameBits = (c) => {
    if (c === 'idle') return Array(10).fill(1);
    const v = c.charCodeAt(0), b = [0];
    for (let i = 0; i < 8; i++) b.push((v >> i) & 1);
    b.push(1);
    return b;
  };
  const BIT = 1128 / 130; // µs per bit: 8.677
  const L = BIT * 10; // µs per letter: 86.77
  const ALLBITS = MSG.flatMap(frameBits);

  const PHASES = ['Init', 'Start the send', 'Middle', 'End'];
  const WHO = { cpu: 'CPU', uart: 'UART', dma: 'DMA', nvic: 'NVIC' };

  const initial = {
    time: null,
    doing: 'reset: startup code runs, then main()',
    cpu: { tx_done: '-', state: 'RESET' },
    nvic: { dmaEn: 0, dmaPend: 0, uEn: 0, uPend: 0 },
    mem: { mpu: '-', dcache: 'off', text: '' },
    dma: { clk: 'off', mux: '-', EN: 0, DIR: '-', MINC: 0, PSIZE: '-', CIRC: '-', TRBUFF: 0, TCIE: 0, HTIE: 0, TEIE: 0, DMEIE: 0, NDTR: 0, M0AR: '-', PAR: '-', HTIF: 0, TCIF: 0 },
    uart: { clk: 'off', pins: 'GPIO', BRR: '-', UE: 0, TE: 0, FIFOEN: '-', TXEIE: 0, TCIE: 0, DMAT: 0, TXE: 1, TC: 1, TEACK: 0, TDR: '', shift: '', req: 0, irq: 0 },
  };

  /* Each step: ph (phase), who (main actor: cpu | uart | dma | nvic), by
   * (actor per changed field, if different), time (µs after the first start
   * bit, or null before the send), set, fly, title, text, q (a question we
   * asked on the way). */
  const STEPS = [
    // Init
    {
      ph: 1, who: 'cpu', title: 'Reset: everything asleep',
      text: 'Right after reset. The UART and the DMA have no clock yet and PD8 is an ordinary pin. Two UART flags already read 1, because that is their reset value: <b>TXE</b> (mailbox empty) and <b>TC</b> (wire quiet).',
      focus: [612, 114, 462, 22],
    },
    {
      ph: 1, who: 'cpu', title: 'MPU and caches',
      text: 'The first lines of <code>main()</code>: an MPU rule makes 0x2400 0000 + 1 KB "never cached", then the caches switch on. Whatever the CPU writes into <code>tx_buf</code> goes straight to the RAM shelf, where the DMA can see it.',
      set: { doing: 'MPU_Config(), SCB_EnableICache(), SCB_EnableDCache()', mem: { mpu: 'region 1: no cache', dcache: 'on' } },
    },
    {
      ph: 1, who: 'cpu', title: 'MX_DMA_Init: DMA clock and its bell line',
      text: 'DMA1 gets a clock. In the NVIC, the <b>DMA1 Stream 0</b> line is enabled with priority 0, so the DMA will be able to ring the CPU.',
      set: { doing: 'MX_DMA_Init()', dma: { clk: 'on' }, nvic: { dmaEn: 1 } },
    },
    {
      ph: 1, who: 'cpu', title: 'UART clock and pins',
      text: '<code>HAL_UART_MspInit</code>: USART3 gets its clock (APB1, 130 MHz), and PD8 / PD9 switch to <b>alternate function 7</b>. From now on the pins belong to the UART.',
      set: { doing: 'MX_USART3_UART_Init() → HAL_UART_MspInit()', uart: { clk: '130 MHz', pins: 'PD8/9 = AF7' } },
    },
    {
      ph: 1, who: 'cpu', title: 'The DMA job type (not the job yet)',
      text: '<code>HAL_DMA_Init</code> writes the fixed part: memory → peripheral, memory address +1 after each byte, byte to byte, normal mode (not circular). The <b>DMAMUX</b> connects request 46, "USART3 TX", to Stream 0. HAL also sets <b>TRBUFF</b>, which it does for every UART request on this chip. EN stays 0: no job yet.',
      set: { dma: { mux: 'USART3_TX', DIR: 'mem → per', MINC: 1, PSIZE: 'byte', CIRC: 0, TRBUFF: 1 } },
    },
    {
      ph: 1, who: 'cpu', title: 'The NVIC switch for USART3',
      text: 'The USART3 line is enabled in the NVIC, priority 0.',
      q: 'You ticked "USART3 global interrupt" in CubeMX: this is that tick. It only opens the NVIC door. The UART still raises nothing until TXEIE or TCIE is set: an interrupt needs both switches.',
      set: { nvic: { uEn: 1 } },
    },
    {
      ph: 1, who: 'cpu', title: 'Speed and format',
      text: 'With UE = 0, HAL sets 8 data bits, no parity, 1 stop bit, oversampling 16, <b>TE = 1</b> (transmitter) and RE = 1. <b>BRR = 1128</b>: 130 MHz ÷ 1128 = 115,248 baud. One bit every 8.68 µs, which is 4,512 CPU pulses.',
      q: 'Does the UART need the CPU to send bits? It needs a clock (this one), not the CPU.',
      set: { doing: 'HAL_UART_Init(): UART_SetConfig()', uart: { BRR: '1128', TE: 1 } },
    },
    {
      ph: 1, who: 'cpu', by: { 'uart.TEACK': 'uart', 'uart.shift': 'uart' }, title: 'UE = 1: the UART wakes up',
      text: 'HAL sets <b>UE</b>. The transmitter starts, confirms with <b>TEACK = 1</b>, and first sends one <b>idle frame</b>: 10 high bits, 87 µs, no start bit.',
      q: 'This idle frame is why our first message, Blink 0, was one letter late: it had to wait behind it.',
      set: { doing: '__HAL_UART_ENABLE(), wait for TEACK', uart: { UE: 1, TEACK: 1, shift: 'idle' } },
    },
    {
      ph: 1, who: 'cpu', by: { 'uart.shift': 'uart' }, title: 'FIFO off: a one-letter mailbox',
      text: 'Our init switches the UART FIFO off, so TDR holds exactly <b>one</b> letter. Init is finished. The main loop toggles the LED, and the send begins.',
      set: { doing: 'HAL_UARTEx_DisableFifoMode(), then main loop', uart: { FIFOEN: 0, shift: '' } },
    },

    // Start the send
    {
      ph: 2, who: 'cpu', title: 'snprintf writes the message',
      text: '<code>Blink 10\\r\\n</code> goes into <code>tx_buf</code>: 10 bytes, straight to the RAM shelf (MPU: no cache).',
      q: '10, not 12: <code>\\r</code> and <code>\\n</code> are one byte each (0x0D, 0x0A).',
      set: { doing: 'line 130: snprintf(tx_buf, …)', mem: { text: 'Blink 10\r\n' } },
    },
    {
      ph: 2, who: 'cpu', title: 'Line 135 begins: notes in RAM',
      text: '<code>tx_done = 0</code>. <code>HAL_UART_Transmit_DMA</code> writes notes into the <code>huart3</code> struct (address, length 10, state BUSY_TX) and tells the DMA handle which functions to run at half, complete and error. All of this is ordinary RAM, no hardware yet.',
      set: { doing: 'line 135: HAL_UART_Transmit_DMA(&huart3, tx_buf, 10)', cpu: { tx_done: 0, state: 'BUSY_TX' } },
    },
    {
      ph: 2, who: 'cpu', title: 'The job card',
      text: 'With the stream off, HAL clears its old flags and writes <b>NDTR = 10</b> (how many), <b>M0AR</b> = <code>tx_buf</code> (from), <b>PAR</b> = the address of USART3\'s TDR (to).',
      set: { dma: { NDTR: 10, M0AR: '0x2400 0000', PAR: '0x4000 4828 (TDR)' } },
    },
    {
      ph: 2, who: 'cpu', title: 'Bells on, stream armed',
      text: 'TCIE, HTIE, TEIE, DMEIE = 1: "ring me at complete, at half, on errors". <b>EN = 1</b>: the stream is armed and waits for a request. It still copies nothing on its own.',
      set: { dma: { TCIE: 1, HTIE: 1, TEIE: 1, DMEIE: 1, EN: 1 } },
    },
    {
      ph: 2, who: 'cpu', title: 'Clear TC, set DMAT, return',
      text: 'HAL clears <b>TC</b> and sets <b>DMAT</b>: "when the mailbox is empty, ask the DMA". Line 135 returns after about 500 pulses. The CPU goes to its own loop and sets <b>nothing</b> more until a bell rings.',
      q: 'Who reads DMAT? The UART. The CPU only writes it.',
      set: { doing: 'own work: while (!tx_done) { free_work++; }', uart: { TC: 0, DMAT: 1 } },
    },

    // Middle
    {
      ph: 3, who: 'uart', title: 'TXE AND DMAT → request to the DMA',
      text: 'The mailbox has been empty all along, so TXE = 1. Now DMAT = 1 too, so the UART raises its <b>request wire to the DMA</b>. No NVIC, no CPU.',
      q: 'Does someone have to watch TXE? No. It is a flag that just stays 1. The UART\'s own logic combines it with DMAT.',
      set: { uart: { req: 1 } },
    },
    {
      ph: 3, who: 'dma', by: { 'uart.TXE': 'uart', 'uart.req': 'uart' }, title: 'DMA: copy B into the mailbox',
      text: 'The DMA reads 0x2400 0000 (<code>B</code>) and writes it into TDR. NDTR 10 → 9, its pointer moves to the next byte. Writing TDR clears TXE automatically, so the request drops.',
      q: 'Does the CPU clear TXE? No: writing into TDR clears it, in hardware.',
      fly: [{ from: 'mem:0', to: 'tdr', label: 'B', cls: 'tok-dma' }],
      set: { uart: { TDR: 'B', TXE: 0, req: 0 }, dma: { NDTR: 9 } },
    },
    {
      ph: 3, who: 'uart', time: 0.01, title: 'B onto the conveyor, and a new request at once',
      text: 'The conveyor is free, so <code>B</code> moves into the shift register and its start bit begins: <b>t = 0</b>. The mailbox is empty again, TXE = 1, and the request logic asks the DMA for the next letter right away.',
      q: 'First ask for l, or first send B? Both at the same time: the transmitter and the request logic are separate pieces of hardware.',
      fly: [{ from: 'tdr', to: 'shift', label: 'B', cls: 'tok-uart' }],
      set: { uart: { TDR: '', TXE: 1, req: 1 } },
    },
    {
      ph: 3, who: 'dma', time: 0.02, by: { 'uart.TXE': 'uart', 'uart.req': 'uart' }, title: 'DMA: copy l. It waits.',
      text: '<code>l</code> is in the mailbox a few clock cycles later and waits there for 87 µs. The UART is now <b>one letter ahead</b>. TC stays 0: something is always waiting.',
      fly: [{ from: 'mem:1', to: 'tdr', label: 'l', cls: 'tok-dma' }],
      set: { uart: { TDR: 'l', TXE: 0, req: 0 }, dma: { NDTR: 8 } },
    },
    {
      ph: 3, who: 'uart', time: L, title: 'B goes out, bit by bit',
      text: 'Start bit 0, then 0x42 lowest bit first: 0 1 0 0 0 0 1 0, then stop bit 1. 10 bits × 8.68 µs = 87 µs. The CPU is in its own loop the whole time; nobody asks "done?".',
    },
    {
      ph: 3, who: 'uart', time: L + 0.01, by: { 'uart.TDR': 'dma', 'dma.NDTR': 'dma' }, title: 'B ends → l moves on → request → i',
      text: 'At B\'s stop bit, <code>l</code> moves onto the conveyor, TXE = 1, the request goes out, the DMA brings <code>i</code>, TXE = 0 again. All within a few clock cycles.',
      q: 'TXE comes back when the waiting letter moves onto the conveyor. So the next request always comes when the <b>previous</b> letter ends.',
      fly: [
        { from: 'tdr', to: 'shift', label: 'l', cls: 'tok-uart', t0: 0, t1: 0.5 },
        { from: 'mem:2', to: 'tdr', label: 'i', cls: 'tok-dma', t0: 0.5, t1: 1 },
      ],
      set: { uart: { TDR: 'i' }, dma: { NDTR: 7 } },
    },
    {
      ph: 3, who: 'dma', time: 2 * L + 0.01, title: 'Same rhythm: n',
      text: 'One copy every 87 µs: <code>i</code> on the wire, <code>n</code> waiting. NDTR = 6.',
      fly: [{ from: 'mem:3', to: 'tdr', label: 'n', cls: 'tok-dma', t0: 0.7, t1: 1 }],
      set: { uart: { TDR: 'n' }, dma: { NDTR: 6 } },
    },
    {
      ph: 3, who: 'dma', time: 3 * L + 0.01, title: 'Half-way: HTIF',
      text: '<code>n</code> moves on and the DMA copies <code>k</code>: 5 of 10 copied, <b>NDTR = 5</b>. The DMA sets <b>HTIF</b> and, because HTIE = 1, rings its NVIC line.',
      fly: [{ from: 'mem:4', to: 'tdr', label: 'k', cls: 'tok-dma', t0: 0.7, t1: 1 }],
      set: { uart: { TDR: 'k' }, dma: { NDTR: 5, HTIF: 1 }, nvic: { dmaPend: 1 } },
    },
    {
      ph: 3, who: 'cpu', time: 3 * L + 2, title: 'Bell: half transfer',
      text: 'The NVIC makes the CPU jump to <code>DMA1_Stream0_IRQHandler</code>. HAL clears HTIF and calls the half-transfer callback, which is empty in our project. A few microseconds later the CPU is back in its loop.',
      q: 'The handler is not a third worker. It is a function that the CPU runs when the NVIC tells it to.',
      set: { doing: 'DMA1_Stream0_IRQHandler(): half → back to own work', dma: { HTIF: 0 }, nvic: { dmaPend: 0 } },
    },
    {
      ph: 3, who: 'dma', time: 7 * L + 0.01, title: '… space, 1, 0, \\r',
      text: 'Four more copies, one every 87 µs. Now <code>0</code> is on the wire and <code>\\r</code> waits in the mailbox. NDTR = 1.',
      set: { doing: 'own work: while (!tx_done) { free_work++; }', uart: { TDR: '\r' }, dma: { NDTR: 1 } },
    },

    // End
    {
      ph: 4, who: 'dma', time: 8 * L + 0.01, title: 'Last copy: NDTR = 0',
      text: '<code>0</code> ends, <code>\\r</code> moves on, the DMA copies <code>\\n</code>: <b>NDTR = 0</b>. Its job is done: it sets <b>TCIF</b>, switches its own <b>EN off</b> and rings its line. <code>\\r</code> is still on the wire.',
      q: 'Does the DMA check "count = 0" when a request comes? No: it counts down after each copy. Reaching 0 ends the job.',
      fly: [{ from: 'mem:9', to: 'tdr', label: '\\n', cls: 'tok-dma', t0: 0.7, t1: 1 }],
      set: { uart: { TDR: '\n' }, dma: { NDTR: 0, TCIF: 1, EN: 0 }, nvic: { dmaPend: 1 } },
    },
    {
      ph: 4, who: 'cpu', time: 8 * L + 2, title: 'Bell: DMA complete → DMAT off, TCIE on',
      text: 'In <code>DMA1_Stream0_IRQHandler</code>, HAL clears TCIF and runs <code>UART_DMATransmitCplt</code>: <b>DMAT = 0</b> (no more requests) and <b>TCIE = 1</b> ("tell me when the wire is quiet"). Back to the loop.',
      q: 'Does the DMA switch DMAT and TCIE? No, the DMA cannot touch UART bits. The CPU does it, inside the DMA\'s bell.',
      set: { doing: 'DMA1_Stream0_IRQHandler(): UART_DMATransmitCplt() → back', dma: { TCIF: 0 }, nvic: { dmaPend: 0 }, uart: { DMAT: 0, TCIE: 1 } },
    },
    {
      ph: 4, who: 'uart', time: 9 * L + 0.01, title: '\\r ends, \\n moves on: no request',
      text: '<code>\\n</code> moves onto the conveyor and TXE = 1. But DMAT = 0 now, so <b>no request</b>. Nothing more is needed.',
      set: { doing: 'own work: while (!tx_done) { free_work++; }', uart: { TDR: '', TXE: 1 } },
    },
    {
      ph: 4, who: 'uart', time: 10 * L + 0.01, by: { 'nvic.uPend': 'uart' }, title: '\\n\'s stop bit ends: TC = 1 → bell',
      text: 'Mailbox empty, conveyor empty: the wire is quiet, so the UART sets <b>TC = 1</b>. TC AND TCIE → the UART raises its <b>USART3 line</b>.',
      q: 'Is TC always 1? It is 1 whenever the wire is quiet and 0 while letters follow each other. It does not depend on DMAT.',
      set: { uart: { TC: 1, irq: 1 }, nvic: { uPend: 1 } },
    },
    {
      ph: 4, who: 'cpu', time: 10 * L + 2, title: 'Bell: USART3 → callback → tx_done = 1',
      text: 'The NVIC sends the CPU to <code>USART3_IRQHandler</code>. <code>HAL_UART_IRQHandler</code> reads the status register, sees TC with TCIE on, switches <b>TCIE off</b>, sets the state back to READY and calls our <code>HAL_UART_TxCpltCallback</code>: <b>tx_done = 1</b>.',
      q: 'Does the NVIC call Cplt? No: the NVIC only knows "USART3 is ringing". HAL reads the flags and decides it was TC.',
      set: { doing: 'USART3_IRQHandler() → HAL_UART_IRQHandler() → HAL_UART_TxCpltCallback()', uart: { TCIE: 0, irq: 0 }, nvic: { uPend: 0 }, cpu: { state: 'READY', tx_done: 1 } },
    },
    {
      ph: 4, who: 'cpu', time: 10 * L + 4, title: 'Done: back in main()',
      text: 'The loop sees <code>tx_done = 1</code> and computes <code>total</code>: 452,929 pulses on our board, 451,200 of them the 100 bits on the wire. TXE and TC stay 1 while the line is idle, until the next message 500 ms later.',
      set: { doing: 'leaves while (!tx_done), computes total, HAL_Delay(500)' },
    },
  ];

  // ---------------------------------------------------------------- states

  function merge(dst, src) {
    for (const [k, v] of Object.entries(src)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object') merge(dst[k], v);
      else dst[k] = v;
    }
  }
  const STATES = [];
  {
    let st = JSON.parse(JSON.stringify(initial));
    STEPS.forEach((s) => {
      st = JSON.parse(JSON.stringify(st));
      if (s.set) merge(st, s.set);
      if ('time' in s) st.time = s.time;
      STATES.push(st);
    });
  }
  const flat = (st) => {
    const o = {};
    for (const g of ['cpu', 'nvic', 'mem', 'dma', 'uart']) for (const [k, v] of Object.entries(st[g])) o[`${g}.${k}`] = v;
    return o;
  };
  // Who changed which field in each step
  const CHANGES = STEPS.map((s, i) => {
    const m = new Map();
    if (i === 0) return m;
    const a = flat(STATES[i - 1]), b = flat(STATES[i]);
    for (const k of Object.keys(b)) if (a[k] !== b[k]) m.set(k, (s.by && s.by[k]) || s.who);
    return m;
  });

  // ---------------------------------------------------------------- drawing

  let chg = new Map();
  function field(x, y, w, key, label, val) {
    const who = chg.get(key);
    const v = val === undefined ? '' : val;
    return `<rect x="${x}" y="${y}" width="${w}" height="22" rx="5" class="fld${who ? ` chg ${who}` : ''}"/>
      <text x="${x + 7}" y="${y + 15}" font-size="10.5" class="muted">${label}</text>
      <text x="${x + w - 7}" y="${y + 15}" text-anchor="end" font-size="12" font-weight="800" class="mono">${esc(v)}</text>`;
  }
  const block = (x, y, w, h, cls, title) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" class="blk"/>
    <path d="M${x} ${y + 24} L${x} ${y + 10} Q${x} ${y} ${x + 10} ${y} L${x + w - 10} ${y} Q${x + w} ${y} ${x + w} ${y + 10} L${x + w} ${y + 24} Z" class="hdr-${cls}"/>
    <text x="${x + 10}" y="${y + 17}" font-size="12.5" class="hdr">${title}</text>`;

  function wrap(text, n) {
    const words = text.split(' '), lines = [];
    let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > n) { lines.push(cur.trim()); cur = w; } else cur += ' ' + w;
    }
    if (cur.trim()) lines.push(cur.trim());
    return lines;
  }

  // Time axis
  const X0 = 96, X1 = 1070, HI = 520, LO = 554;
  const xAt = (t) => X0 + (t / (10 * L)) * (X1 - X0);

  function scene(i, t) {
    const st = STATES[i], prev = STATES[Math.max(0, i - 1)], step = STEPS[i];
    const moves = t < 1 && i > 0;
    const s = moves && t < 0.5 ? prev : st;
    chg = !moves || t >= 0.5 ? CHANGES[i] : new Map();
    // Current time (animated between steps)
    let T = st.time;
    if (moves && st.time !== null && prev.time !== null) T = lerp(prev.time, st.time, t);
    if (moves && st.time !== null && prev.time === null) T = st.time;

    let o = '<svg viewBox="0 0 1100 600" role="img" aria-label="UART, DMA, NVIC and CPU registers">';

    // CPU
    o += block(16, 16, 250, 184, 'cpu', 'CPU (your code + HAL)');
    o += '<text x="26" y="58" font-size="10.5" class="muted">doing now</text>';
    wrap(s.doing, 30).slice(0, 5).forEach((l, k) => { o += `<text x="26" y="${76 + k * 16}" font-size="12" class="mono">${esc(l)}</text>`; });
    o += field(24, 166, 112, 'cpu.tx_done', 'tx_done', s.cpu.tx_done) + field(142, 166, 116, 'cpu.state', 'huart3', s.cpu.state);

    // Memory
    o += block(16, 212, 250, 242, 'mem', 'tx_buf · AXI SRAM 0x2400 0000');
    o += field(24, 244, 234, 'mem.mpu', 'MPU', s.mem.mpu) + field(24, 270, 234, 'mem.dcache', 'D-cache', s.mem.dcache);
    const ptr = s.dma.EN && s.dma.NDTR > 0 ? 10 - s.dma.NDTR : -1;
    MSG.forEach((c, k) => {
      const x = 26 + k * 23;
      const filled = s.mem.text.length > 0;
      o += `<rect x="${x}" y="306" width="21" height="30" rx="3" class="cell${k === ptr ? ' ptr' : ''}"/>`;
      if (filled) o += `<text x="${x + 10.5}" y="326" text-anchor="middle" font-size="12" font-weight="700" class="mono">${esc(SHOW(c))}</text>`;
      o += `<text x="${x + 10.5}" y="350" text-anchor="middle" font-size="9" class="muted mono">${k}</text>`;
    });
    if (ptr >= 0) o += `<path d="M${26 + ptr * 23 + 10.5} 356 l-6 10 l12 0 z" class="tok-dma"/><text x="26" y="384" font-size="11" class="muted">▲ the DMA reads this byte next</text>`;
    o += '<text x="26" y="412" font-size="11" class="muted">Written by snprintf (CPU),</text><text x="26" y="428" font-size="11" class="muted">read by the DMA, one byte per request.</text>';

    // DMA
    o += block(284, 16, 300, 332, 'dma', 'DMA1 Stream 0');
    const L2 = 294, R2 = 440, W2 = 140;
    o += field(L2, 36, W2, 'dma.clk', 'clock', s.dma.clk) + field(R2, 36, W2, 'dma.mux', 'MUX', s.dma.mux);
    o += field(L2, 62, W2, 'dma.EN', 'CR.EN', s.dma.EN) + field(R2, 62, W2, 'dma.DIR', 'DIR', s.dma.DIR);
    o += field(L2, 88, W2, 'dma.MINC', 'MINC', s.dma.MINC) + field(R2, 88, W2, 'dma.PSIZE', 'size', s.dma.PSIZE);
    o += field(L2, 114, W2, 'dma.CIRC', 'CIRC', s.dma.CIRC) + field(R2, 114, W2, 'dma.TRBUFF', 'TRBUFF', s.dma.TRBUFF);
    o += field(L2, 140, W2, 'dma.TCIE', 'TCIE', s.dma.TCIE) + field(R2, 140, W2, 'dma.HTIE', 'HTIE', s.dma.HTIE);
    o += field(L2, 166, W2, 'dma.TEIE', 'TEIE', s.dma.TEIE) + field(R2, 166, W2, 'dma.DMEIE', 'DMEIE', s.dma.DMEIE);
    o += field(L2, 196, 286, 'dma.NDTR', 'NDTR (letters left)', s.dma.NDTR);
    o += field(L2, 222, 286, 'dma.M0AR', 'M0AR (from)', s.dma.M0AR);
    o += field(L2, 248, 286, 'dma.PAR', 'PAR (to)', s.dma.PAR);
    o += field(L2, 278, W2, 'dma.HTIF', 'HTIF (half)', s.dma.HTIF) + field(R2, 278, W2, 'dma.TCIF', 'TCIF (done)', s.dma.TCIF);
    o += `<text x="${L2}" y="326" font-size="10.5" class="muted">request in ◀ from UART</text>`;
    o += `<circle cx="${L2 + 150}" cy="322" r="7" class="${s.uart.req ? 'lamp-on' : 'lamp-off'}"/>`;

    // NVIC
    o += block(284, 360, 300, 94, 'nvic', 'NVIC (the CPU\'s ear)');
    o += field(L2, 392, W2, 'nvic.dmaEn', 'DMA1_S0 on', s.nvic.dmaEn) + field(R2, 392, W2, 'nvic.dmaPend', 'ringing', s.nvic.dmaPend ? '🔔' : 0);
    o += field(L2, 422, W2, 'nvic.uEn', 'USART3 on', s.nvic.uEn) + field(R2, 422, W2, 'nvic.uPend', 'ringing', s.nvic.uPend ? '🔔' : 0);

    // UART
    o += block(602, 16, 482, 438, 'uart', 'USART3 (UART)');
    const C1 = 612, C2 = 764, C3 = 916, WC = 146;
    o += field(C1, 36, WC, 'uart.clk', 'clock', s.uart.clk) + field(C2, 36, WC, 'uart.pins', 'pins', s.uart.pins) + field(C3, 36, 158, 'uart.BRR', 'BRR', s.uart.BRR);
    o += field(C1, 62, WC, 'uart.UE', 'CR1.UE', s.uart.UE) + field(C2, 62, WC, 'uart.TE', 'CR1.TE', s.uart.TE) + field(C3, 62, 158, 'uart.FIFOEN', 'CR1.FIFOEN', s.uart.FIFOEN);
    o += field(C1, 88, WC, 'uart.TXEIE', 'CR1.TXEIE', s.uart.TXEIE) + field(C2, 88, WC, 'uart.TCIE', 'CR1.TCIE', s.uart.TCIE) + field(C3, 88, 158, 'uart.DMAT', 'CR3.DMAT', s.uart.DMAT);
    o += field(C1, 114, WC, 'uart.TXE', 'ISR.TXE', s.uart.TXE) + field(C2, 114, WC, 'uart.TC', 'ISR.TC', s.uart.TC) + field(C3, 114, 158, 'uart.TEACK', 'ISR.TEACK', s.uart.TEACK);
    o += '<text x="612" y="162" font-size="11" font-weight="700">TDR (mailbox)</text>';
    const tdrWho = chg.get('uart.TDR');
    o += `<rect x="612" y="170" width="96" height="56" rx="8" class="fld${tdrWho ? ` chg ${tdrWho}` : ''}"/>`;
    o += `<text x="660" y="206" text-anchor="middle" font-size="22" font-weight="800" class="mono">${esc(SHOW(s.uart.TDR))}</text>`;
    // Shift register: which letter is on the wire right now
    let onWire = s.uart.shift, curBit = -1;
    if (T !== null && T !== undefined) {
      const idx = Math.floor(T / L + 1e-6);
      onWire = idx >= 0 && idx < 10 ? MSG[idx] : '';
      if (onWire) curBit = Math.min(9, Math.floor((T - idx * L) / BIT));
    }
    o += `<text x="730" y="162" font-size="11" font-weight="700">shift register (conveyor) ${onWire ? `· '${esc(onWire === 'idle' ? 'idle frame' : SHOW(onWire))}'` : ''}</text>`;
    const fb = onWire ? frameBits(onWire) : null;
    for (let j = 0; j < 10; j++) {
      const x = 730 + j * 33;
      o += `<rect x="${x}" y="176" width="31" height="40" rx="4" class="cell${j === curBit && moves ? ' cur' : ''}"/>`;
      if (fb) o += `<text x="${x + 15.5}" y="202" text-anchor="middle" font-size="15" font-weight="700" class="mono">${fb[j]}</text>`;
      if (onWire !== 'idle') o += `<text x="${x + 15.5}" y="230" text-anchor="middle" font-size="9.5" class="muted mono">${j === 0 ? 'S' : j === 9 ? 'P' : j - 1}</text>`;
    }
    // Logic that decides who gets told
    const lamp = (y, on, text, key, ring) => `<circle cx="626" cy="${y}" r="8" class="${on ? (ring ? 'lamp-ring' : 'lamp-on') : 'lamp-off'}"/>
      <text x="642" y="${y + 4}" font-size="12" class="mono${chg.get(key) ? '' : ''}">${text}</text>`;
    o += '<text x="612" y="258" font-size="11" font-weight="700">UART logic, always running in hardware</text>';
    o += lamp(278, s.uart.req, 'TXE AND DMAT  → DMA request', 'uart.req');
    o += lamp(304, s.uart.irq, 'TXE AND TXEIE, or TC AND TCIE → USART3 line', 'uart.irq', true);
    o += '<text x="612" y="340" font-size="11" class="muted">The UART only sets flags and raises wires.</text>';
    o += '<text x="612" y="356" font-size="11" class="muted">It never calls a function and never counts letters.</text>';
    o += `<text x="612" y="392" font-size="11.5" font-weight="700">On the TX wire (PD8):</text><text x="612" y="410" font-size="11.5" class="mono">${onWire ? (onWire === 'idle' ? 'idle frame, 10 high bits' : `'${esc(SHOW(onWire))}', bit ${curBit >= 0 ? curBit : 0} of 10`) : 'quiet (high)'}</text>`;

    // Wires between blocks
    o += `<path d="M618 278 L596 278 L596 322 L${L2 + 158} 322" class="line${s.uart.req ? ' on-dma' : ''}"/>`;
    o += `<path d="M618 304 L592 304 L592 433 L584 433" class="line${s.nvic.uPend ? ' on-irq' : ''}"/>`;
    o += `<path d="M434 348 L434 360" class="line${s.nvic.dmaPend ? ' on-irq' : ''}"/>`;
    o += `<path d="M284 407 L274 407 L274 120 L266 120" class="line${s.nvic.dmaPend || s.nvic.uPend ? ' on-irq' : ''}"/>`;

    // Flying bytes
    if (moves && step.fly) {
      const A = (k) => (k.startsWith('mem:') ? [26 + Number(k.slice(4)) * 23 + 10.5, 321] : { tdr: [660, 198], shift: [895, 196] }[k]);
      for (const f of step.fly) {
        const t0 = f.t0 || 0, t1 = f.t1 === undefined ? 1 : f.t1;
        const q = clamp01((t - t0) / (t1 - t0));
        if (q <= 0 || q >= 1) continue;
        const a = A(f.from), b = A(f.to);
        const x = lerp(a[0], b[0], q), y = lerp(a[1], b[1], q) - Math.sin(q * Math.PI) * 40;
        o += `<rect x="${x - 16}" y="${y - 14}" width="32" height="28" rx="14" class="${f.cls}"/><text x="${x}" y="${y + 5}" text-anchor="middle" font-size="13" font-weight="700" class="tw mono">${esc(f.label)}</text>`;
      }
    }

    // Timeline
    o += '<rect x="16" y="466" width="1068" height="128" rx="10" class="blk"/>';
    o += '<text x="28" y="486" font-size="12" font-weight="700">TX wire over time</text>';
    o += `<text x="1072" y="486" text-anchor="end" font-size="12.5" font-weight="800" class="mono">${T === null || T === undefined ? 'before the send' : `t = ${Math.max(0, T).toFixed(1)} µs`}</text>`;
    o += `<text x="28" y="${HI + 4}" font-size="10" class="muted">high</text><text x="28" y="${LO + 4}" font-size="10" class="muted">low</text>`;
    MSG.forEach((c, k) => {
      o += `<text x="${xAt((k + 0.5) * L)}" y="506" text-anchor="middle" font-size="11" font-weight="700" class="mono">${esc(SHOW(c))}</text>`;
      o += `<line x1="${xAt(k * L)}" y1="496" x2="${xAt(k * L)}" y2="562" stroke="var(--border)"/>`;
      o += `<text x="${xAt(k * L)}" y="576" text-anchor="middle" font-size="9.5" class="muted mono">${Math.round(k * L)}</text>`;
    });
    o += `<text x="${X1}" y="576" text-anchor="middle" font-size="9.5" class="muted mono">868 µs</text>`;
    if (T === null || T === undefined) {
      o += `<path d="M${X0 - 20} ${HI} L${X1} ${HI}" class="wave-idle"/>`;
    } else {
      const n = Math.max(0, T / BIT);
      let d = `M${X0 - 20} ${HI} L${X0} ${HI}`, y = HI;
      for (let k = 0; k < 100 && k < n; k++) {
        const ny = ALLBITS[k] ? HI : LO;
        const xa = xAt(k * BIT), xb = xAt(Math.min(k + 1, n) * BIT);
        if (ny !== y) d += ` L${xa} ${ny}`;
        d += ` L${xb} ${ny}`;
        y = ny;
      }
      if (n >= 100) d += ` L${X1 + 10} ${HI}`;
      o += `<path d="${d}" class="wave"/>`;
      o += `<line x1="${xAt(Math.min(T, 10 * L))}" y1="492" x2="${xAt(Math.min(T, 10 * L))}" y2="566" class="cursor"/>`;
      [[3 * L, 'HTIF: half'], [8 * L, 'TCIF: DMA done'], [10 * L, 'TC: wire quiet']].forEach(([tm, lab]) => {
        if (T >= tm - 0.001) o += `<line x1="${xAt(tm)}" y1="492" x2="${xAt(tm)}" y2="566" class="mark"/><text x="${xAt(tm) - 4}" y="590" text-anchor="end" font-size="10.5" font-weight="700" class="badtxt" fill="var(--bad)">${lab}</text>`;
      });
    }

    if (!moves && step.focus) {
      const [x, y, w, h] = step.focus;
      o += `<rect x="${x - 4}" y="${y - 4}" width="${w + 8}" height="${h + 8}" rx="8" class="focus"/>`;
    }
    return o + '</svg>';
  }

  // ---------------------------------------------------------------- playback

  const params = new URLSearchParams(location.search);
  const video = params.has('video');
  if (video) document.body.classList.add('video');
  const stepParam = Number(params.get('step'));
  const anim = { i: stepParam >= 1 && stepParam <= STEPS.length ? stepParam - 1 : 0, t: 1, raf: 0, last: 0, auto: false, wait: 0 };
  if (stepParam && params.has('t')) anim.t = clamp01(Number(params.get('t')));
  const SPEED = {
    slow: { dur: 1400, dwell: (s) => 1500 + (s.text.length + (s.q || '').length) * 26 },
    normal: { dur: 900, dwell: (s) => 1000 + (s.text.length + (s.q || '').length) * 17 },
    fast: { dur: 450, dwell: (s) => 400 + (s.text.length + (s.q || '').length) * 8 },
  };
  if (params.get('speed') && SPEED[params.get('speed')]) $('#speed').value = params.get('speed');

  const firstOf = (ph) => STEPS.findIndex((s) => s.ph === ph);

  function renderPopup() {
    const s = STEPS[anim.i], last = anim.i === STEPS.length - 1;
    $('#popup').innerHTML = `<div class="stepno">${PHASES[s.ph - 1]} · Step ${anim.i + 1} of ${STEPS.length}</div>
      <div class="title"><span class="who ${s.who}">${WHO[s.who]}</span>${s.title}</div><div>${s.text}</div>
      ${s.q ? `<div class="q">❓ <b>You asked:</b> ${s.q}</div>` : ''}
      <div class="nav"><button data-nav="back" ${anim.i === 0 ? 'disabled' : ''}>◀ Back</button>${last
        ? '<button data-nav="restart" class="primary">↻ Start again</button>'
        : '<button data-nav="next" class="primary">Next ▶</button>'}</div>`;
    $('#btn-play').textContent = anim.auto ? '❚❚ Pause' : '▶ Auto-play';
    $('#chapters').innerHTML = PHASES.map((n, k) => `<button data-ph="${k + 1}" class="${k + 1 === s.ph ? 'on' : ''}">${k + 1}. ${n}</button>`).join('');
  }
  function draw() { $('#scene').innerHTML = scene(anim.i, anim.t); }

  function tick(now) {
    const dt = now - anim.last;
    anim.last = now;
    const sp = SPEED[$('#speed').value];
    const st = STATES[anim.i], pv = STATES[Math.max(0, anim.i - 1)];
    const long = st.time !== null && pv.time !== null && st.time - pv.time > 50;
    const dur = long ? sp.dur * 2.2 : sp.dur;
    if (anim.t < 1) {
      anim.t = clamp01(anim.t + dt / dur);
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
  let scrolled = video;
  function run() {
    if (!scrolled) { scrolled = true; $('.toolbar').scrollIntoView({ block: 'start' }); }
    cancelAnimationFrame(anim.raf);
    anim.last = performance.now();
    anim.raf = requestAnimationFrame(tick);
  }
  function goNext() { anim.i += 1; anim.t = 0; renderPopup(); draw(); }
  function jump(i) { cancelAnimationFrame(anim.raf); anim.auto = false; anim.i = i; anim.t = 1; renderPopup(); draw(); }

  $('#popup').addEventListener('click', (e) => {
    const b = e.target.closest('[data-nav]');
    if (!b) return;
    if (b.dataset.nav === 'next') { anim.auto = false; goNext(); run(); } else if (b.dataset.nav === 'back') jump(Math.max(0, anim.i - 1)); else jump(0);
  });
  $('#chapters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ph]');
    if (b) jump(firstOf(Number(b.dataset.ph)));
  });
  $('#btn-restart').onclick = () => jump(0);
  $('#btn-play').onclick = () => {
    if (anim.auto) { anim.auto = false; cancelAnimationFrame(anim.raf); anim.t = 1; draw(); renderPopup(); return; }
    if (anim.i === STEPS.length - 1) jump(0);
    anim.auto = true; anim.wait = 0; renderPopup(); run();
  };
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('select, input, textarea, summary')) return;
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); if (anim.i < STEPS.length - 1) { anim.auto = false; goNext(); run(); } } else if (e.key === 'ArrowLeft') jump(Math.max(0, anim.i - 1));
  });

  renderPopup();
  draw();
})();
