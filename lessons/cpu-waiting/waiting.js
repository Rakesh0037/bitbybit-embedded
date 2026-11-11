/* BitByBit Embedded - "Your CPU is fast. So why is it waiting?" lesson.
 *
 * A beginner story told as problem → idea → problem: send a message to the
 * laptop, notice the CPU waiting, add interrupts, add DMA, add caches, fix
 * the cache trap. Same engine as the memory lesson: every step changes the
 * scene state, all states are computed up front, Next animates, Back jumps.
 * Views: 'board' (chip, ST-LINK, laptop), 'uart' (CPU, UART, wire),
 * 'map' (memory shelves and roads), 'cache' (CPU trays, Flash, RAM).
 * Every step has short beginner text; the details live in "Look closer".
 */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // The message: Blink 10\r\n = 10 bytes
  const MSG = ['B', 'l', 'i', 'n', 'k', ' ', '1', '0', '\r', '\n'];
  const SHOW = (c) => (c === ' ' ? '␣' : c === '\r' ? '\\r' : c === '\n' ? '\\n' : c);
  const HEX = (c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0');
  // Start bit 0, 8 data bits (lowest first), stop bit 1. An idle frame is all 1.
  const frameBits = (c) => {
    if (c === 'idle') return Array(10).fill(1);
    const v = c.charCodeAt(0), b = [0];
    for (let i = 0; i < 8; i++) b.push((v >> i) & 1);
    b.push(1);
    return b;
  };

  const CODE = {
    simple: { title: 'main.c', lines: [
      'printf("Blink %lu\\r\\n", counter++);   // in the main loop',
      'int __io_putchar(int ch) {     // printf calls this per letter',
      '  uint8_t c = ch;',
      '  HAL_UART_Transmit(&huart3, &c, 1, HAL_MAX_DELAY); return ch; }',
    ] },
    poll: { title: 'What the CPU does for every letter (simplified)', lines: [
      'printf("Blink %lu\\r\\n", counter++);',
      '  → _write() → __io_putchar() → HAL_UART_Transmit()',
      '',
      'while (!(UART->ISR & TXE)) { }   // mailbox empty?',
      'UART->TDR = letter;              // put the letter in',
      'while (!(UART->ISR & TC))  { }   // done? done? done?',
    ] },
    it: { title: 'main.c, interrupt version', lines: [
      'len = snprintf(tx_buf, 32, "Blink %lu\\r\\n", n++);',
      'tx_done = 0;',
      'start = DWT->CYCCNT;',
      'HAL_UART_Transmit_IT(&huart3, tx_buf, len);',
      'call = DWT->CYCCNT - start;',
      'while (!tx_done) { free_work++; }  // the CPU\'s own work',
      'total = DWT->CYCCNT - start;',
      '',
      'void HAL_UART_TxCpltCallback(...) { tx_done = 1; }',
    ] },
    dma: { title: 'main.c, DMA version', lines: [
      'len = snprintf(tx_buf, 32, "Blink %lu\\r\\n", n++);',
      'tx_done = 0;',
      'start = DWT->CYCCNT;',
      'HAL_UART_Transmit_DMA(&huart3, tx_buf, len);',
      'call = DWT->CYCCNT - start;',
      'while (!tx_done) { free_work++; }  // the CPU\'s own work',
      'total = DWT->CYCCNT - start;',
      '',
      'void HAL_UART_TxCpltCallback(...) { tx_done = 1; }',
    ] },
    map0: { title: 'Where does tx_buf live?', lines: [
      'static uint8_t tx_buf[32];         // no value: .bss',
      'static volatile uint8_t tx_done;   // .bss',
      '',
      '/* linker script */',
      '.bss : { *(.bss*) } >DTCMRAM       // all .bss → DTCM',
    ] },
    map1: { title: 'Give the buffer its own label', lines: [
      'static uint8_t tx_buf[32]',
      '    __attribute__((section(".dma_buffer")));',
      '',
      '/* linker script: our new rule */',
      '.dma_buffer (NOLOAD) :',
      '{',
      '  *(.dma_buffer)      // collect that name',
      '} >RAM_D1             // AXI SRAM, 0x2400 0000',
    ] },
    asm: { title: 'The CPU\'s own loop, in machine code', lines: [
      'ldr   r3, [r7, #20]  ; read free_work (DTCM)',
      'adds  r3, #1         ; +1',
      'str   r3, [r7, #20]  ; write it back',
      'ldr   r3, [pc, #72]  ; WHERE is tx_done? → FLASH',
      'ldrb  r3, [r3, #0]   ; value of tx_done (DTCM)',
      'uxtb  r3, r3',
      'cmp   r3, #0         ; still 0?',
      'beq   loop           ; yes: once more',
    ] },
    stale: { title: 'DMA version, both caches on', lines: [
      'len = snprintf(tx_buf, 32, "Blink %lu\\r\\n", n++);',
      '',
      'HAL_UART_Transmit_DMA(&huart3, tx_buf, len);',
    ] },
    clean: { title: 'Fix 1: clean the tray before every DMA send', lines: [
      'static uint8_t tx_buf[32]',
      '  __attribute__((section(".dma_buffer"), aligned(32)));',
      '',
      'len = snprintf(tx_buf, 32, "Blink %lu\\r\\n", n++);',
      'SCB_CleanDCache_by_Addr(tx_buf, sizeof tx_buf);',
      'HAL_UART_Transmit_DMA(&huart3, tx_buf, len);',
    ] },
    mpu: { title: 'Fix 2: a "no tray" rule (MPU)', lines: [
      '/* MPU_Config(), runs at startup */',
      'Region 1: base 0x2400 0000, size 1 KB',
      '  TEX 1, Cacheable 0, Bufferable 0',
      '  = normal memory, never cached',
      '',
      '// SCB_CleanDCache_by_Addr(...);  not needed now',
      'ASSERT(SIZEOF(.dma_buffer) <= 1K, "...")  /* .ld */',
    ] },
    idle: { title: 'main.c', lines: [
      'MX_USART3_UART_Init();  // transmitter on: idle frame',
      'HAL_Delay(1);           // the proof: wait it out',
      '',
      'while (1) {',
      '  ... first message: Blink 0 ...',
      '}',
    ] },
  };

  const ROBOTS = {
    cpu: { name: 'CPU', cls: 'r-cpu' },
    uart: { name: 'UART', cls: 'r-uart' },
    dma: { name: 'DMA', cls: 'r-dma' },
    dev: { name: 'YOU', cls: 'r-dev' },
  };
  const OFF = [-300, -300];
  const HOME = {
    board: { cpu: [150, 392], uart: OFF, dma: OFF, dev: [690, 548] },
    uart: { cpu: [380, 548], uart: [790, 118], dma: [480, 548], dev: [250, 548] },
    map: { cpu: [330, 330], uart: OFF, dma: [330, 520], dev: [120, 548] },
    cache: { cpu: [140, 440], uart: OFF, dma: [700, 548], dev: [560, 548] },
  };
  const SPOT = { board: {}, uart: { tdr: [540, 300] }, map: {}, cache: { axi: [720, 476] } };

  // Points that tokens fly between, per view
  const ANCHOR = {
    board: (k) => ({ cpu: [150, 335], uart: [275, 195], stlink: [515, 205], laptop: [905, 190] }[k]),
    uart: (k) => {
      if (k.startsWith('buf:')) return [49 + Number(k.slice(4)) * 48, 243];
      return { tdr: [625, 192], shift: [715, 318], term: [980, 260] }[k];
    },
    map: (k) => ({ dtcm: [930, 354], axi: [930, 280] }[k]),
    cache: (k) => ({ lit: [820, 126], code: [820, 82], trayI: [300, 351], trayD: [300, 405], cpu: [170, 395], axi: [820, 318], term: [960, 470] }[k]),
  };

  // Memory map shelves, top (high address) to bottom
  const SHELVES = [
    ['periph', 'Peripheral registers', '0x4000 0000 +', 'UART TDR, GPIO, DMA …'],
    ['sram4', 'SRAM4', '0x3800 0000', '16 KB'],
    ['sram12', 'SRAM1/2', '0x3000 0000', '32 KB'],
    ['axi', 'AXI SRAM', '0x2400 0000', '320 KB'],
    ['dtcm', 'DTCM', '0x2000 0000', '128 KB'],
    ['flash', 'Flash', '0x0800 0000', '1 MB'],
    ['itcm', 'ITCM', '0x0000 0000', '64 KB'],
  ];
  const shelfY = (id) => 30 + SHELVES.findIndex((s) => s[0] === id) * 74;

  const CH = ['Send a message', 'The CPU waits', 'Interrupts', 'DMA', 'Caches', 'Cache vs DMA', 'Wrap-up'];

  const initial = {
    view: 'board', code: 'simple',
    buf: { show: true, hex: false, name: 'the message in memory', next: -1, done: 0 },
    tdr: '', shift: '', wave: '',
    flags: { txe: 1, tc: 1 }, ctrl: { txeie: 0, tcie: 0, dmat: 0 },
    term: '', termNote: '',
    cnt: { wait: 0, free: 0, irq: 0 }, cntOn: { wait: true, free: false, irq: false },
    dma: false, card: false,
    map: { bufAt: 'dtcm', blocked: false, roadOk: false },
    cache: { ic: false, dc: false, trayI: '', trayD: '', shelf: 'Blink 1\\r\\n', cpr: 14.07, call: 1095, mpu: false, cterm: [] },
    robots: { cpu: [...HOME.board.cpu], uart: [...OFF], dma: [...OFF], dev: [...OFF] },
  };

  const BUF = [16, 202, 500, 82], CNT = [16, 296, 300, 108], UART = [560, 130, 300, 282], FLAGS = [680, 166, 170, 52];
  const SHIFT = [584, 296, 262, 66], TERM = [880, 130, 206, 282], CARD = [328, 296, 220, 116];

  /* Each step: ch (chapter), kind ('problem' | 'idea' | 'win': a pop-up
   * banner with headline), view, robot (who works), to ('home', a spot or
   * [x, y]), line (code line to mark), set (state changes), fly (tokens:
   * from, to, label, cls, t0, t1), bits (character sent on the wire), say
   * (speech bubbles), focus, text (short) and more (details, folded). */
  const STEPS = [
    // 1 Send a message
    {
      ch: 1, title: 'Let\'s send a message to the laptop',
      text: 'Our board should print <code>Blink 10</code> on the laptop screen. Simple! But what do we need for that? Press <b>Next</b>.',
    },
    {
      ch: 1, title: 'We need a way to talk: UART',
      text: 'The <b>UART</b> is a small part inside the STM32 chip that sends letters over a wire, one bit after another. One wire to send (<b>TX</b>), one to receive (<b>RX</b>), and a shared ground.',
      more: 'UART = Universal Asynchronous Receiver-Transmitter. "Asynchronous" means there is no clock wire: both sides simply agree on a speed, here <b>115,200 bits per second</b>. Each letter travels as 10 bits: a start bit, the 8 data bits, a stop bit.',
      focus: [226, 156, 98, 78],
    },
    {
      ch: 1, title: 'Who listens? The ST-LINK',
      text: 'The laptop has no UART wire. On this board, the STM32\'s TX wire goes to the <b>ST-LINK</b>: the little debugger chip that also flashes your program. It turns the UART bits into <b>USB</b> messages.',
      focus: [426, 136, 178, 138],
    },
    {
      ch: 1, title: 'USB to the laptop',
      text: 'Over the USB cable the laptop sees a <b>serial port</b>. A terminal program opens it and shows every letter that arrives. Watch the letter <code>B</code> make the whole trip.',
      more: 'On Linux the port is <code>/dev/ttyACM0</code>; we watched it with <code>screen /dev/ttyACM0 115200</code>. On Windows it is a <code>COM</code> port.',
      fly: [
        { from: 'cpu', to: 'uart', label: 'B', cls: 'r-cpu', t0: 0, t1: 0.3 },
        { from: 'uart', to: 'stlink', label: 'B', cls: 'r-uart', t0: 0.3, t1: 0.6 },
        { from: 'stlink', to: 'laptop', label: 'B', cls: 'r-uart', t0: 0.6, t1: 0.95 },
      ],
      set: { term: 'B' },
    },
    {
      ch: 1, line: 1, title: 'In code: printf',
      text: '<code>printf</code> builds the text and hands it over <b>letter by letter</b> to a small function we write ourselves, <code>__io_putchar</code>. It gives each letter to the UART.',
      more: 'The chain: <code>printf</code> → <code>_write()</code> → <code>__io_putchar()</code> once per letter → <code>HAL_UART_Transmit()</code>.<br><b>Our first bug:</b> we wrote <code>_io_putchar</code> with <b>one</b> underscore. The build passed, the LED blinked, and nothing arrived. The library declares <code>__io_putchar</code> as <i>weak</i> ("use it if it exists"), so a missing one is not an error: the linker turned the call into a <code>nop</code>.<br><b>Count the letters:</b> <code>\\r</code> and <code>\\n</code> are one byte each (0x0D, 0x0A), so <code>Blink 10\\r\\n</code> is 10 bytes, not 12.',
      focus: [16, 436, 640, 112],
    },
    {
      ch: 1, kind: 'win', headline: 'It works: Blink 10 appears on the laptop!',
      title: 'It works', text: 'Every letter took the same trip. Now let\'s slow time down a million times and watch <b>what the CPU does</b> while the letters travel.',
      fly: [
        { from: 'cpu', to: 'laptop', label: 'Blink 10', cls: 'r-uart', t0: 0, t1: 0.9 },
      ],
      set: { term: 'Blink 10\n' },
    },

    // 2 The CPU waits
    {
      ch: 2, view: 'uart', robot: 'uart', title: 'Inside the UART: a mailbox and a conveyor',
      text: 'The UART has a <b>mailbox</b> that holds one letter, and a <b>conveyor</b> that pushes a letter out on the wire bit by bit. The CPU can only use the mailbox.',
      more: 'Real names: the mailbox is <b>TDR</b> (transmit data register), the conveyor is the <b>shift register</b>. Two flags report the state: <b>TXE</b> = "mailbox empty", <b>TC</b> = "everything sent".',
      set: { view: 'uart', code: 'poll', term: 'Blink 10\n' }, focus: UART,
    },
    {
      ch: 2, robot: 'cpu', to: 'tdr', line: 4, title: 'The CPU puts B in the mailbox',
      text: 'The mailbox is empty, so the CPU puts in the first letter, <code>B</code>.',
      say: { cpu: 'Mailbox empty? Put B in' },
      fly: [{ from: 'buf:0', to: 'tdr', label: 'B', cls: 'r-cpu' }],
      set: { tdr: 'B', flags: { txe: 0, tc: 0 }, buf: { next: 0 } },
    },
    {
      ch: 2, robot: 'uart', title: 'B goes onto the conveyor',
      text: 'The UART takes <code>B</code> onto its conveyor and wraps it: a <b>start bit</b> (0) in front, a <b>stop bit</b> (1) behind. 10 bits in total.',
      more: 'The 8 data bits go out lowest bit first. <code>B</code> = 0x42 = 0100 0010, so the wire sees 0, then 0 1 0 0 0 0 1 0, then 1.',
      fly: [{ from: 'tdr', to: 'shift', label: 'B', cls: 'r-uart' }],
      set: { tdr: '', shift: 'B', flags: { txe: 1 } }, focus: SHIFT,
    },
    {
      ch: 2, robot: 'cpu', to: 'tdr', line: 5, bits: 'B', title: 'And the CPU? It waits',
      text: 'Watch the wire: 10 bits take <b>87 µs</b>. The UART does that all by itself. And the CPU? It stands there asking <b>"done? done? done?"</b> That is called <b>polling</b>.',
      more: 'The UART times each bit with its own clock: 1,128 ticks of its 130 MHz clock = <b>4,512 CPU pulses per bit</b>, 45,120 pulses per letter. When the stop bit is out, the UART only sets the TC flag. It does not call anyone; the CPU notices because it keeps reading the flag.',
      say: { cpu: 'Done? Done? Done?' },
      set: { wave: 'B', cnt: { wait: 45120 }, term: 'Blink 10\nB', flags: { tc: 1 }, buf: { next: -1, done: 1 } },
    },
    {
      ch: 2, robot: 'cpu', to: 'tdr', line: 0, title: '… and the same for every letter',
      text: '<code>l</code>, <code>i</code>, <code>n</code>, <code>k</code>, space, <code>1</code>, <code>0</code>, <code>\\r</code>, <code>\\n</code>: for each one, the CPU waits until it has left.',
      say: { cpu: 'Done? Done? Done?' },
      set: { shift: '\n', wave: '\n', term: 'Blink 10\nBlink 10\n', cnt: { wait: 461919 }, buf: { done: 10 } },
    },
    {
      ch: 2, kind: 'problem', headline: 'Did you notice? The CPU did nothing else!',
      title: 'The CPU was stuck in _write()', robot: 'cpu',
      text: 'For the whole <code>Blink 10\\r\\n</code>, our CPU robot stood inside <code>_write()</code>: <b>888 µs, 461,919 clock pulses</b>, just waiting. In that time it could have run hundreds of thousands of useful instructions.',
      more: 'Measured with the CPU\'s own pulse counter <code>DWT->CYCCNT</code> around <code>printf</code>: 461,919 pulses, the same on every loop. 451,200 are the UART bits (10 × 45,120), about 10,700 are formatting and function calls. Exactly the same every time because the CPU, its 1 ms tick and the UART all run from one clock source. <code>HAL_Delay(500)</code> waits the same way, by polling the tick counter.',
      say: { cpu: 'zzz…' }, focus: CNT,
    },

    // 3 Interrupts
    {
      ch: 3, kind: 'idea', headline: 'Idea: let the UART ring a bell!',
      title: 'Idea: interrupts',
      text: 'What if the CPU does not wait? The UART could <b>ring a bell</b> (an <b>interrupt</b>) whenever its mailbox is empty. The CPU drops in the next letter and goes straight back to its own work.',
      say: { dev: 'Ring me when you need a letter!' },
      set: {
        code: 'it', tdr: '', shift: '', wave: '', cnt: { wait: 0, free: 0, irq: 0 }, cntOn: { wait: false, free: true, irq: true },
        buf: { name: 'tx_buf (the message)', next: -1, done: 0 },
      },
    },
    {
      ch: 3, robot: 'cpu', to: 'tdr', line: 3, title: 'Start the send: the bell rings at once',
      text: '<code>HAL_UART_Transmit_IT</code> switches the bell on. The mailbox is already empty, so it rings immediately: the CPU drops in <code>B</code>, <code>B</code> moves to the conveyor, it rings again, the CPU drops in <code>l</code>.',
      more: 'The bell is the <b>TXEIE</b> bit: "interrupt me when TXE (mailbox empty) is set". Both first interrupts happen <b>before the function even returns</b>: our measurement shows <code>call</code> = 1,248 pulses, far more than the function alone.',
      say: { cpu: 'Ring! B   Ring! l' },
      fly: [
        { from: 'buf:0', to: 'tdr', label: 'B', cls: 'r-cpu', t0: 0, t1: 0.35 },
        { from: 'tdr', to: 'shift', label: 'B', cls: 'r-uart', t0: 0.35, t1: 0.65 },
        { from: 'buf:1', to: 'tdr', label: 'l', cls: 'r-cpu', t0: 0.65, t1: 1 },
      ],
      set: { tdr: 'l', shift: 'B', ctrl: { txeie: 1 }, flags: { txe: 0, tc: 0 }, cnt: { irq: 2 }, buf: { done: 1, next: 1 } },
    },
    {
      ch: 3, robot: 'cpu', to: 'home', line: 5, bits: 'B', title: 'Free! The CPU does its own work',
      text: 'While <code>B</code> goes out, the CPU runs its own loop (we count the rounds). The next letter already waits in the mailbox, so the wire never pauses.',
      say: { cpu: 'my own work…' },
      set: { wave: 'B', term: 'Blink 10\nBlink 10\nB', cnt: { free: 1240 } },
    },
    {
      ch: 3, robot: 'cpu', to: 'tdr', line: 5, title: 'Ring! Next letter',
      text: 'When <code>B</code> has completely left, <code>l</code> moves onto the conveyor, the mailbox is empty, the bell rings. The CPU drops in <code>i</code> and goes back to work.',
      more: '<b>A mistake we made:</b> the next bell does not ring "when <code>l</code> is sent". It rings when the <b>previous</b> letter\'s stop bit ends and the waiting letter moves onto the conveyor.',
      say: { cpu: 'Ring! i' },
      fly: [
        { from: 'tdr', to: 'shift', label: 'l', cls: 'r-uart', t0: 0, t1: 0.5 },
        { from: 'buf:2', to: 'tdr', label: 'i', cls: 'r-cpu', t0: 0.5, t1: 1 },
      ],
      set: { tdr: 'i', shift: 'l', cnt: { irq: 3 }, buf: { done: 2, next: 2 } },
    },
    {
      ch: 3, robot: 'cpu', to: 'home', line: 8, title: '… until the last letter',
      text: 'This repeats for every letter. At the end come two last bells: "mailbox empty, but nothing left" and "everything sent". Then our callback sets <code>tx_done = 1</code>.',
      more: '<b>Interrupt #11:</b> <code>\\r</code> ends, <code>\\n</code> moves to the conveyor, the mailbox is empty, but HAL finds 0 letters left. It writes nothing and switches TXEIE off and <b>TCIE</b> on: "tell me when the line is quiet". (We merged this with #10 twice before we saw it.)<br><b>Interrupt #12:</b> the stop bit of <code>\\n</code> ends, the UART sets TC, HAL calls <code>HAL_UART_TxCpltCallback</code>. The UART only sets flags; the CPU runs the code.<br>TXE and TC are not two interrupts with two priorities: they are two events on <b>one</b> interrupt line of the UART.',
      say: { cpu: 'tx_done = 1' },
      set: { tdr: '', shift: '\n', wave: '\n', term: 'Blink 10\nBlink 10\nBlink 10\n', ctrl: { txeie: 0, tcie: 1 }, flags: { txe: 1, tc: 1 }, cnt: { irq: 12, free: 12400 }, buf: { done: 10, next: -1 } },
    },
    {
      ch: 3, kind: 'problem', headline: 'Better… but the CPU still runs back and forth',
      title: 'One bell for every letter',
      text: 'The CPU got its own work done in between. But it was still called away for <b>every single letter</b>: 12 bells for 10 letters. Send 1,000 letters, and it is interrupted 1,000 times.',
      more: 'Measured with a 12-letter message (<code>Blink 8868\\r\\n</code>): <code>call</code> 1,248 pulses, <code>total</code> 542,825 (the bits alone are 541,440), 14,878 rounds of own work, <b>14 interrupts</b>.',
      say: { cpu: 'Ring! Ring! Ring!' }, focus: CNT,
    },

    // 4 DMA
    {
      ch: 4, kind: 'idea', headline: 'Idea: a helper robot that carries the letters: DMA',
      title: 'Idea: DMA',
      text: 'What did the CPU do at each bell? Only <b>copy one letter</b> from memory into the mailbox. A <b>DMA controller</b> (direct memory access) is a small helper that does exactly that kind of copying, without the CPU.',
      say: { dev: 'Let the DMA carry them!' },
      set: { dma: true, code: 'dma', ctrl: { txeie: 0, tcie: 0, dmat: 0 }, cnt: { free: 0, irq: 0 }, buf: { done: 0, next: -1 }, tdr: '', shift: '', wave: '' },
    },
    {
      ch: 4, robot: 'cpu', line: 3, title: 'The CPU writes a job card',
      text: 'The CPU gives the DMA one job card: <b>from</b> <code>tx_buf</code>, <b>to</b> the UART mailbox, <b>10 letters</b>, go! Then it tells the UART: "ring the DMA, not me".',
      more: '<code>HAL_UART_Transmit_DMA</code> writes the DMA registers: M0AR = <code>tx_buf</code> (from), PAR = UART TDR (to), NDTR = 10 (count), interrupts for done / half / error, EN = 1. Last, it sets <b>DMAT</b> in the UART: every "mailbox empty" now becomes a DMA request instead of a CPU interrupt.',
      say: { cpu: 'Here is your job card' },
      set: { card: true, ctrl: { dmat: 1 } }, focus: CARD,
    },
    {
      ch: 4, robot: 'dma', to: 'tdr', line: 5, title: 'The DMA carries, the CPU works',
      text: 'Mailbox empty → the DMA brings the next letter. The CPU stays in its own loop the whole time.',
      say: { dma: 'B … l …', cpu: 'my own work…' },
      fly: [
        { from: 'buf:0', to: 'tdr', label: 'B', cls: 'r-dma', t0: 0, t1: 0.35 },
        { from: 'tdr', to: 'shift', label: 'B', cls: 'r-uart', t0: 0.35, t1: 0.65 },
        { from: 'buf:1', to: 'tdr', label: 'l', cls: 'r-dma', t0: 0.65, t1: 1 },
      ],
      set: { tdr: 'l', shift: 'B', buf: { done: 1, next: 1 }, flags: { txe: 0, tc: 0 }, cnt: { free: 1500 } },
    },
    {
      ch: 4, kind: 'win', headline: 'Only 3 bells, however long the message',
      robot: 'dma', to: 'home', line: 5, title: 'Only 3 interrupts',
      text: 'The DMA carries all 10 letters. The CPU hears only <b>3 bells</b>: half-way, all copied, all sent. And still 3 for 1,000 letters.',
      more: 'Measured, 10 letters: <code>call</code> 1,094 pulses, <code>total</code> 452,929, 3 interrupts, 32,104 rounds of own work. The DMA shares the bus with the CPU, so now and then the CPU waits a pulse or two: far cheaper than an interrupt.',
      say: { cpu: 'my own work…' },
      set: { tdr: '', shift: '\n', wave: '\n', term: 'Blink 10\nBlink 10\nBlink 10\nBlink 10\n', buf: { done: 10, next: -1 }, flags: { txe: 1, tc: 1 }, cnt: { irq: 3, free: 32104 } },
    },
    {
      ch: 4, kind: 'problem', headline: 'Careful: the DMA cannot reach every shelf!',
      view: 'map', robot: 'dma', title: 'Our buffer was on the wrong shelf',
      text: 'Memory is not one big room. Our variables lived in <b>DTCM</b>: very fast memory with private wires to the CPU only. The DMA has <b>no road</b> there. It would have failed, and our program would wait forever.',
      more: 'The CPU sees one cupboard of addresses from 0x0000 0000 to 0xFFFF FFFF, with shelves at some heights and gaps between: ITCM, Flash, DTCM, AXI SRAM, SRAM1/2, SRAM4 and the peripheral registers (the UART mailbox is a shelf too). <code>tx_buf</code> had no start value, so it was in <code>.bss</code>, and the linker script put <code>.bss</code> on DTCM. The DMA reaches memory only through the <b>bus matrix</b>, and the matrix has no road to DTCM: a transfer error, no callback, <code>tx_done</code> stays 0. Nothing in C warns you; the chip\'s reference manual shows it in its bus diagram. We read it before trying, so we skipped the hang.',
      say: { dma: 'No road to DTCM!' },
      set: { view: 'map', code: 'map0', map: { blocked: true } },
    },
    {
      ch: 4, kind: 'idea', headline: 'Fix: move the buffer to a shelf the DMA can reach',
      line: 7, title: 'A new label and a new shelf',
      text: 'We give <code>tx_buf</code> its own label, and a rule in the linker script puts that label on <b>AXI SRAM</b>, a shelf the DMA can reach.',
      more: 'In C: <code>__attribute__((section(".dma_buffer")))</code>, a name <b>we</b> chose. The compiler knows nothing about shelves. In the linker script: <code>*(.dma_buffer)</code> collects that name and <code>&gt;RAM_D1</code> puts it on AXI SRAM (0x2400 0000). The linker only matches names; you encode the "DMA can reach it" knowledge. Check it: <code>arm-none-eabi-nm firmware.elf | grep tx_buf</code> → <code>24000000 b tx_buf</code>.',
      say: { dev: 'Same code, other shelf' },
      fly: [{ from: 'dtcm', to: 'axi', label: 'tx_buf', cls: 'r-cpu' }],
      set: { code: 'map1', map: { bufAt: 'axi', blocked: false, roadOk: true } },
    },

    // 5 Caches
    {
      ch: 5, kind: 'problem', headline: 'Now look at the CPU itself: it walks a lot',
      view: 'cache', robot: 'cpu', line: 3, title: 'Every round, a trip to Flash',
      text: 'The CPU\'s own loop needs <b>14 pulses per round</b>. Why so many? In every round, the CPU walks to <b>Flash</b> to read where <code>tx_done</code> is stored. Flash is slow for a 520 MHz CPU.',
      more: 'Our loop is 8 machine instructions. A 2-byte instruction cannot hold a 32-bit address, so the compiler stored the <b>address</b> of <code>tx_done</code> (0x2000 008C) in Flash right after the code: the <b>literal pool</b>. <code>tx_done</code> itself lives in DTCM. Flash sits on the AXI bus at 260 MHz with 3 wait states: about <b>8 CPU pulses per read</b>. Formula for pulses per round: (total − call) ÷ rounds.',
      fly: [{ from: 'lit', to: 'cpu', label: '0x2000008C', cls: 'r-cpu' }],
      set: { view: 'cache', code: 'asm' },
    },
    {
      ch: 5, robot: 'cpu', line: 3, title: 'While Flash answers, the CPU freezes',
      text: 'During those trips the CPU does not loop or wait politely. It simply <b>freezes</b> until the data arrives. This is called a <b>stall</b>, and you cannot see it in your code.',
      more: 'Polling is software waiting: the CPU runs instructions that ask again and again. A stall is hardware waiting: the CPU pipeline holds still until the bus signals "data ready".',
      say: { cpu: '… frozen …' },
    },
    {
      ch: 5, kind: 'idea', headline: 'Idea: keep copies on a tray next to the CPU: caches',
      title: 'Idea: caches',
      text: 'A <b>cache</b> is a small, very fast tray next to the CPU. It keeps copies of what the CPU used recently. The <b>I-cache</b> holds instructions, the <b>D-cache</b> holds data. First trip: to the shelf. After that: from the tray.',
      more: 'Each tray holds 32 KB. A trip to the shelf is a <b>miss</b>, a find on the tray is a <b>hit</b>. DTCM never uses the tray: it is already as fast as one.',
      say: { dev: 'Use the trays!' }, focus: [196, 326, 310, 108],
    },
    {
      ch: 5, robot: 'cpu', title: 'I-cache on: … no change?!',
      text: 'We switched on the I-cache and expected a big speed-up. Result: 14.07 → <b>14.04</b>. Almost nothing! The instructions were not the slow part. The trip to Flash was for <b>data</b>: the address of <code>tx_done</code>.',
      more: 'Our prediction was wrong, and the measurement showed it. The I-cache did help elsewhere: <code>call</code> fell from 1,095 to 625, because HAL\'s code now comes from the tray. (The very first send still took 1,003: a <b>cold</b> cache, empty after reset.)',
      fly: [{ from: 'code', to: 'trayI', label: 'code', cls: 'r-cpu' }],
      set: { cache: { ic: true, trayI: 'loop + HAL code', cpr: 14.04, call: 625 } },
    },
    {
      ch: 5, kind: 'win', headline: 'D-cache on: 14 → 8 pulses per round',
      robot: 'cpu', title: 'D-cache on',
      text: 'With the D-cache on, the address of <code>tx_done</code> stays on the tray. No more trips to Flash in the loop: <b>8 pulses per round</b> instead of 14.',
      fly: [{ from: 'lit', to: 'trayD', label: '0x2000008C', cls: 'r-cpu' }],
      set: { cache: { dc: true, trayD: '0x2000 008C', cpr: 8.02, call: 504 } },
    },

    // 6 Cache vs DMA
    {
      ch: 6, robot: 'cpu', line: 0, title: 'snprintf writes the message… onto the tray',
      text: 'Now the CPU writes <code>Blink 1</code> into <code>tx_buf</code>. With the D-cache on, the text lands <b>on the CPU\'s tray</b>. The real shelf still holds old bytes from power-up.',
      more: 'This cache type is <b>write-back</b>: it copies the tray to the shelf only later, when it needs the room. Our program is small, so that never happened.',
      set: { code: 'stale', cache: { trayD: '0x2000 008C · tx_buf: Blink 1\\r\\n', shelf: '1��+R�P�   (old bytes)' } },
      fly: [{ from: 'cpu', to: 'trayD', label: 'Blink 1', cls: 'r-cpu' }],
    },
    {
      ch: 6, kind: 'problem', headline: 'Garbage on the screen: the DMA cannot see the tray!',
      robot: 'dma', to: 'axi', line: 2, title: 'The DMA reads the shelf',
      text: 'The DMA takes the letters from the <b>shelf</b>. It cannot see the CPU\'s tray, so it sends the old bytes. Our screen showed <code>1��+R�P�</code>. No crash, no error message.',
      more: 'The <b>length</b> was right (9 bytes: the CPU counted it), the <b>content</b> was wrong, the same junk every time, and without <code>\\r\\n</code> the lines ran together. CPU and DMA used the <b>same address</b>, 0x2400 0000, but two physical places: the tray and the shelf. This is a <b>cache coherency</b> problem. It only appears when a second master, here the DMA, uses memory directly.',
      say: { dma: 'sending what I find' },
      fly: [{ from: 'axi', to: 'term', label: '1��+R', cls: 'r-dma' }],
      set: { cache: { cterm: ['1��+R�P�  call 504, total …', '1��+R�P�  call 504, total …'] } },
    },
    {
      ch: 6, kind: 'idea', headline: 'Fix 1: copy the tray to the shelf before every send',
      robot: 'cpu', line: 4, title: 'Clean the cache',
      text: 'One line before each DMA send copies the tray to the shelf: <code>SCB_CleanDCache_by_Addr</code>. Now the DMA finds the right text. Order: write text → clean → start the DMA.',
      more: 'It is a one-time copy, so it is needed before <b>every</b> send. The cache works in 32-byte <b>lines</b>, so the buffer is aligned to 32 bytes: the clean then covers exactly this buffer and nothing else. Still 8 pulses per round.',
      fly: [{ from: 'trayD', to: 'axi', label: 'Blink 1', cls: 'r-cpu' }],
      set: { code: 'clean', cache: { shelf: 'Blink 1\\r\\n', cterm: ['1��+R�P�  call 504, total …', 'Blink 1', '  call 503, total 406927'] } },
    },
    {
      ch: 6, kind: 'idea', headline: 'Fix 2: put a "no tray" sign on the DMA shelf',
      robot: 'cpu', line: 1, title: 'An MPU rule',
      text: 'Or we tell the CPU once, at startup: "never use the tray for this part of memory". Then the CPU always writes straight to the shelf. Nothing to forget. This rule-keeper is the <b>MPU</b>.',
      more: 'MPU = memory protection unit, hardware inside the CPU core that holds rules for address ranges. Region 1: 0x2400 0000, 1 KB, "normal memory, not cacheable". Set up in <code>MPU_Config()</code> at runtime, not by the compiler. A region must be a power of two in size, so a linker <code>ASSERT</code> stops the build if <code>.dma_buffer</code> outgrows 1 KB.<br><b>And <code>tx_done</code>?</b> It is in DTCM, never cached. Even if it were, the interrupt runs on the same CPU and uses the same tray. What it does need is <code>volatile</code>.',
      fly: [{ from: 'cpu', to: 'axi', label: 'Blink 2', cls: 'r-cpu' }],
      set: { code: 'mpu', cache: { mpu: true, trayD: '0x2000 008C', shelf: 'Blink 2\\r\\n', cterm: ['Blink 1', '  call 503, total 406927', 'Blink 2', '  call 503, total 406927'] } },
    },

    // 7 Wrap-up
    {
      ch: 7, view: 'uart', robot: 'uart', bits: 'idle', line: 0, title: 'Bonus: why was the very first message slower?',
      text: 'Our first message always took about one letter longer. When the UART switches on, it first sends one <b>idle frame</b>: 10 high bits. The first message had to wait behind it.',
      more: 'Proof: with <code>HAL_Delay(1)</code> after the UART init, <code>Blink 0</code> took 407,502 pulses instead of 450,067. What remained of the difference is the cold cache.',
      set: {
        view: 'uart', code: 'idle', card: false, wave: 'idle', tdr: 'B', shift: 'idle', term: '', termNote: '',
        flags: { txe: 0, tc: 0 }, ctrl: { txeie: 0, tcie: 0, dmat: 1 },
        cntOn: { wait: false, free: false, irq: false }, cnt: { wait: 0, free: 0, irq: 0 },
        buf: { name: 'tx_buf (in AXI SRAM)', done: 0, next: 0 },
      },
    },
    {
      ch: 7, kind: 'win', headline: 'From waiting to working',
      title: 'The whole journey',
      text: '<b>Polling:</b> the CPU waited for every bit. <b>Interrupts:</b> one bell per letter. <b>DMA:</b> 3 bells, however long. Then two traps of fast chips: the DMA cannot reach every shelf, and the cache can hide your data from the DMA. The table below has every number we measured.',
    },
  ];

  // ---------------------------------------------------------------- states

  function merge(dst, src) {
    for (const [k, v] of Object.entries(src)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) merge(dst[k], v);
      else dst[k] = Array.isArray(v) ? [...v] : v;
    }
  }

  const STATES = [];
  {
    let st = JSON.parse(JSON.stringify(initial));
    STEPS.forEach((s) => {
      const prevView = st.view;
      st = JSON.parse(JSON.stringify(st));
      if (s.set) merge(st, s.set);
      const home = HOME[st.view];
      for (const k of Object.keys(ROBOTS)) if (k !== s.robot) st.robots[k] = [...home[k]];
      if (s.robot) {
        const to = s.to || 'stay';
        if (Array.isArray(to)) st.robots[s.robot] = [...to];
        else if (to === 'home' || (to === 'stay' && prevView !== st.view)) st.robots[s.robot] = [...home[s.robot]];
        else if (to !== 'stay') st.robots[s.robot] = [...SPOT[st.view][to]];
      }
      STATES.push(st);
    });
  }

  // ---------------------------------------------------------------- drawing helpers

  function robotSvg(key, x, y, active, walking) {
    const c = ROBOTS[key].cls;
    const swing = walking ? Math.sin(walking * Math.PI * 8) * 4 : 0;
    return `<g opacity="${active ? 1 : 0.55}">
      <line x1="${x}" y1="${y - 62}" x2="${x}" y2="${y - 70}" class="${c}" stroke-width="2"/>
      <circle cx="${x}" cy="${y - 72}" r="3" class="${c}"/>
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

  // leftward: grow the bubble to the left, so it doesn't cover what the robot works on
  function bubbleSvg(x, y, text, leftward) {
    const w = Math.max(60, text.length * 8.3 + 24);
    const bx = Math.min(1094 - w, Math.max(6, leftward ? x + 26 - w : x - w / 2));
    const by = y - 112;
    return `<g><rect x="${bx}" y="${by}" width="${w}" height="26" rx="12" class="bubble"/>
      <path d="M${x - 6} ${by + 26} L${x} ${by + 36} L${x + 6} ${by + 26}" class="bubble"/>
      <rect x="${x - 7}" y="${by + 24}" width="14" height="3" fill="var(--surface)"/>
      <text x="${bx + w / 2}" y="${by + 17}" text-anchor="middle" font-size="12" font-weight="600" class="mono">${esc(text)}</text></g>`;
  }

  // The pop-up banner for problem / idea / success moments
  const KIND = { problem: ['😟', 'PROBLEM'], idea: ['💡', 'IDEA'], win: ['🎉', 'IT WORKS'] };
  function bannerSvg(step, op) {
    if (!step.kind) return '';
    const [icon, label] = KIND[step.kind];
    return `<g class="ban-wrap" opacity="${op}"><rect x="150" y="6" width="800" height="62" rx="14" class="ban ban-${step.kind}"/>
      <text x="190" y="48" text-anchor="middle" font-size="30">${icon}</text>
      <text x="226" y="28" font-size="11" font-weight="800" class="ban-label">${label}</text>
      <text x="226" y="52" font-size="18" font-weight="800">${esc(step.headline)}</text></g>`;
  }

  function codePanel(code, hl, x, y, w, h) {
    let o = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" class="panel"/>`;
    o += `<text x="${x + 12}" y="${y + 18}" font-size="11.5" font-weight="700" class="muted">${esc(code.title)}</text>`;
    code.lines.forEach((l, i) => {
      const ly = y + 38 + i * 16.5;
      if (hl === i) o += `<rect x="${x + 6}" y="${ly - 12}" width="${w - 12}" height="16" rx="3" class="codeline"/>`;
      o += `<text x="${x + 12}" y="${ly}" font-size="12" class="mono" xml:space="preserve">${esc(l)}</text>`;
    });
    return o;
  }

  const lampSvg = (x, y, name, on, note) => `<circle cx="${x}" cy="${y}" r="8" class="${on ? 'lamp-on' : 'lamp-off'}"/>
    <text x="${x + 14}" y="${y + 4}" font-size="12.5" font-weight="700">${name}</text>
    <text x="${x + 14}" y="${y + 19}" font-size="10" class="muted">${note}</text>`;

  const pillSvg = (x, y, name, on) => `<rect x="${x}" y="${y}" width="80" height="24" rx="12" class="pill${on ? ' on' : ''}"/>
    <text x="${x + 40}" y="${y + 16}" text-anchor="middle" font-size="11.5" font-weight="700" class="mono">${name}=${on ? 1 : 0}</text>`;

  function termLines(text, x, y, maxLines, size, lh) {
    const lines = text.split('\n');
    let o = '';
    lines.slice(-maxLines).forEach((l, i, arr) => {
      o += `<text x="${x}" y="${y + i * lh}" font-size="${size}" class="termtext" xml:space="preserve">${esc(l.replace(/\r/g, ''))}${i === arr.length - 1 ? '▌' : ''}</text>`;
    });
    return o;
  }

  // ---------------------------------------------------------------- views

  function viewBoard(c) {
    const s = c.base, st = c.st, prev = c.prev;
    let o = '<rect x="20" y="40" width="640" height="384" rx="16" class="pcb"/>';
    o += '<text x="38" y="66" font-size="13" font-weight="700">Development board</text>';
    // STM32 chip
    o += '<rect x="60" y="100" width="290" height="300" rx="10" class="chip"/>';
    o += '<text x="74" y="124" font-size="15" font-weight="800">STM32</text><text x="74" y="142" font-size="11" class="muted">the microcontroller</text>';
    o += '<rect x="226" y="156" width="98" height="78" rx="8" class="uartbox"/>';
    o += '<text x="275" y="190" text-anchor="middle" font-size="14" font-weight="800">UART</text><text x="275" y="208" text-anchor="middle" font-size="10" class="muted">sends letters</text><text x="275" y="221" text-anchor="middle" font-size="10" class="muted">bit by bit</text>';
    // Wires to the ST-LINK
    o += '<path d="M324 182 L430 182" class="wire"/><text x="377" y="174" text-anchor="middle" font-size="11" font-weight="700">TX →</text>';
    o += '<path d="M430 214 L324 214" class="wire-rx"/><text x="377" y="230" text-anchor="middle" font-size="11" class="muted">← RX</text>';
    // ST-LINK
    o += '<rect x="430" y="140" width="170" height="130" rx="10" class="chip"/>';
    o += '<text x="515" y="170" text-anchor="middle" font-size="15" font-weight="800">ST-LINK</text>';
    o += '<text x="515" y="190" text-anchor="middle" font-size="11" class="muted">debugger chip</text>';
    o += '<text x="515" y="222" text-anchor="middle" font-size="12" font-weight="700">UART → USB</text>';
    o += '<text x="515" y="242" text-anchor="middle" font-size="10" class="muted">also flashes your program</text>';
    // USB connector and cable
    o += '<rect x="626" y="186" width="34" height="38" rx="4" class="usb"/><text x="643" y="246" text-anchor="middle" font-size="10" font-weight="700">USB</text>';
    o += '<path d="M600 205 L626 205" class="cable"/><path d="M660 205 C 700 205, 700 300, 740 300" class="cable"/>';
    // Laptop
    o += '<rect x="730" y="70" width="350" height="250" rx="12" class="laptop"/>';
    o += '<rect x="744" y="84" width="322" height="222" rx="6" class="term"/>';
    o += '<text x="756" y="104" font-size="11" class="termdim">terminal · serial port · 115200</text>';
    o += termLines(c.moves && c.step.fly && c.t < 0.9 ? prev.term : st.term, 756, 134, 9, 15, 20);
    o += '<path d="M710 320 L1100 320 L1080 344 L730 344 Z" class="laptop"/>';
    o += '<text x="905" y="370" text-anchor="middle" font-size="13" font-weight="700">Laptop</text>';
    // Code
    o += codePanel(CODE[s.code], c.step.line, 16, 436, 648, 112);
    return o;
  }

  function viewUart(c) {
    const s = c.base, st = c.st, prev = c.prev;
    let o = codePanel(CODE[s.code], c.step.line, 16, 14, 500, 178);

    // The message in memory
    if (s.buf.show) {
      o += `<rect x="${BUF[0]}" y="${BUF[1]}" width="${BUF[2]}" height="${BUF[3]}" rx="8" class="panel"/>`;
      o += `<text x="28" y="220" font-size="12" font-weight="700">${esc(s.buf.name)}</text>`;
      MSG.forEach((ch, i) => {
        const x = 28 + i * 48;
        const cls = i === s.buf.next ? 'cell next' : i < s.buf.done ? 'cell sent' : 'cell';
        o += `<rect x="${x}" y="228" width="42" height="30" rx="4" class="${cls}"/>`;
        o += `<text x="${x + 21}" y="248" text-anchor="middle" font-size="14" font-weight="700" class="mono${i < s.buf.done ? ' muted' : ''}">${esc(SHOW(ch))}</text>`;
        if (s.buf.hex) o += `<text x="${x + 21}" y="276" text-anchor="middle" font-size="10.5" class="muted mono">0x${HEX(ch)}</text>`;
      });
    }

    // Counters
    const k = c.moves && c.sameView ? c.t : 1;
    const rows = [['wait', 'CPU pulses spent waiting'], ['free', 'rounds of own work (≈)'], ['irq', 'interrupts (bells)']];
    o += `<rect x="${CNT[0]}" y="${CNT[1]}" width="${CNT[2]}" height="${CNT[3]}" rx="8" class="panel"/>`;
    rows.forEach(([key, label], i) => {
      const y = CNT[1] + 28 + i * 30, on = st.cntOn[key];
      const v = lerp(c.sameView ? prev.cnt[key] : st.cnt[key], st.cnt[key], k);
      o += `<g opacity="${on ? 1 : 0.3}"><text x="28" y="${y}" font-size="12">${label}</text>
        <text x="${CNT[0] + CNT[2] - 12}" y="${y}" text-anchor="end" font-size="15" font-weight="800" class="mono">${fmt(v)}</text></g>`;
    });

    // DMA job card
    if (s.card) {
      o += `<rect x="${CARD[0]}" y="${CARD[1]}" width="${CARD[2]}" height="${CARD[3]}" rx="8" class="card-bg"/>`;
      o += `<text x="${CARD[0] + 10}" y="${CARD[1] + 18}" font-size="12" font-weight="700">DMA job card</text>`;
      ['from  tx_buf', 'to    UART mailbox', 'count 10 letters', 'tell  half, done, error', 'go!'].forEach((l, i) => {
        o += `<text x="${CARD[0] + 10}" y="${CARD[1] + 38 + i * 16}" font-size="11.5" class="mono" xml:space="preserve">${l}</text>`;
      });
    }

    // UART
    o += `<rect x="${UART[0]}" y="${UART[1]}" width="${UART[2]}" height="${UART[3]}" rx="10" class="zone"/>`;
    o += `<text x="${UART[0] + 14}" y="${UART[1] + 20}" font-size="13" font-weight="700">UART</text>`;
    o += `<rect x="590" y="170" width="70" height="44" rx="6" class="cell${s.tdr ? ' full' : ''}"/>`;
    o += `<text x="625" y="199" text-anchor="middle" font-size="18" font-weight="800" class="mono">${esc(s.tdr ? SHOW(s.tdr) : '')}</text>`;
    o += '<text x="625" y="230" text-anchor="middle" font-size="11" font-weight="700">mailbox</text><text x="625" y="243" text-anchor="middle" font-size="9.5" class="muted">TDR · 1 letter</text>';
    o += lampSvg(700, 182, 'TXE', s.flags.txe, 'mailbox empty');
    o += lampSvg(790, 182, 'TC', s.flags.tc, 'all sent');
    o += '<text x="590" y="290" font-size="11" font-weight="700">conveyor</text><text x="648" y="290" font-size="9.5" class="muted">(shift register)</text>';
    const bits = s.shift ? frameBits(s.shift) : null;
    const cur = c.step.bits && c.moves && c.sameView ? Math.min(9, Math.floor(c.t * 10)) : -1;
    const bitName = (j) => (j === 0 ? 'S' : j === 9 ? 'P' : String(j - 1));
    for (let j = 0; j < 10; j++) {
      const x = 590 + j * 25;
      o += `<rect x="${x}" y="300" width="24" height="36" rx="3" class="cell${j === cur ? ' cur' : ''}"/>`;
      if (bits) o += `<text x="${x + 12}" y="324" text-anchor="middle" font-size="14" font-weight="700" class="mono">${bits[j]}</text>`;
      if (s.shift !== 'idle') o += `<text x="${x + 12}" y="350" text-anchor="middle" font-size="9" class="muted mono">${bitName(j)}</text>`;
    }
    if (s.shift) o += `<text x="845" y="290" text-anchor="end" font-size="11" class="muted mono">'${esc(s.shift === 'idle' ? 'idle' : SHOW(s.shift))}'</text>`;
    o += pillSvg(590, 368, 'TXEIE', s.ctrl.txeie) + pillSvg(678, 368, 'TCIE', s.ctrl.tcie) + pillSvg(766, 368, 'DMAT', s.ctrl.dmat);

    // Wire and terminal
    o += '<path d="M840 318 L880 318" class="wire"/>';
    o += `<rect x="${TERM[0]}" y="${TERM[1]}" width="${TERM[2]}" height="${TERM[3]}" rx="8" class="term"/>`;
    o += `<text x="${TERM[0] + 12}" y="${TERM[1] + 20}" font-size="11" class="termdim">laptop terminal</text>`;
    const showTerm = c.step.bits && c.moves && c.sameView && c.t < 0.9 ? prev.term : st.term;
    if (!showTerm && s.termNote) o += `<text x="${TERM[0] + 12}" y="${TERM[1] + 48}" font-size="12" class="termdim">${esc(s.termNote)}</text>`;
    o += termLines(showTerm, TERM[0] + 12, TERM[1] + 48, 12, 14, 19);

    // Waveform on the TX pin
    o += '<rect x="560" y="428" width="526" height="118" rx="8" class="panel"/>';
    o += '<text x="572" y="447" font-size="12" font-weight="700">TX wire: what it does</text>';
    o += '<text x="572" y="466" font-size="10" class="muted">1 (high)</text><text x="572" y="512" font-size="10" class="muted">0 (low)</text>';
    const animating = c.step.bits && c.moves && c.sameView;
    const wch = animating ? c.step.bits : s.wave;
    const prog = animating ? c.t : 1;
    const X0 = 640, BW = 43, HI = 462, LO = 508;
    if (!wch) {
      o += `<path d="M${X0 - 20} ${HI} L${X0 + 10 * BW} ${HI}" class="wave-idle"/>`;
    } else {
      const fb = frameBits(wch);
      const n = prog * 10;
      let d = `M${X0 - 20} ${HI} L${X0} ${HI}`, y = HI;
      for (let j = 0; j < 10 && j < n; j++) {
        const ny = fb[j] ? HI : LO;
        const x0 = X0 + j * BW, x1 = X0 + Math.min(j + 1, n) * BW;
        if (ny !== y) d += ` L${x0} ${ny}`;
        d += ` L${x1} ${ny}`;
        y = ny;
      }
      o += `<path d="${d}" class="wave"/>`;
      if (wch === 'idle') {
        o += `<text x="${X0 + 5 * BW}" y="532" text-anchor="middle" font-size="10.5" class="muted">idle frame: 10 high bits</text>`;
        o += '<text x="1076" y="447" text-anchor="end" font-size="11" class="muted mono">idle frame = 87 µs</text>';
      } else {
        for (let j = 0; j < 10; j++) o += `<text x="${X0 + j * BW + BW / 2}" y="532" text-anchor="middle" font-size="9.5" class="muted mono">${bitName(j)}</text>`;
        o += `<text x="1076" y="447" text-anchor="end" font-size="11" class="muted mono">'${esc(SHOW(wch))}' = 10 bits = 87 µs</text>`;
      }
    }
    return o;
  }

  function viewMap(c) {
    const s = c.base;
    let o = codePanel(CODE[s.code], c.step.line, 16, 78, 520, 172);
    o += '<rect x="652" y="18" width="442" height="528" rx="10" class="cupboard"/>';
    SHELVES.forEach(([id, name, addr, size], i) => {
      const y = 30 + i * 74;
      o += `<rect x="660" y="${y}" width="426" height="56" rx="6" class="shelf${(id === s.map.bufAt) ? ' hot' : ''}"/>`;
      o += `<text x="672" y="${y + 22}" font-size="13" font-weight="700">${name}</text>`;
      o += `<text x="672" y="${y + 41}" font-size="11" class="muted mono">${addr} · ${size}</text>`;
      if (i < SHELVES.length - 1) o += `<line x1="680" y1="${y + 65}" x2="1066" y2="${y + 65}" class="gap"/>`;
    });
    const note = (id, text) => `<text x="1074" y="${shelfY(id) + 22}" text-anchor="end" font-size="11" class="muted">${text}</text>`;
    o += note('flash', 'code, constants') + note('dtcm', 'our variables') + note('itcm', 'fast code (unused)');
    const tok = (id) => `<rect x="960" y="${shelfY(id) + 30}" width="112" height="22" rx="6" class="token"/><text x="1016" y="${shelfY(id) + 46}" text-anchor="middle" font-size="12" font-weight="700" class="mono">tx_buf</text>`;
    if (!(c.moves && c.step.fly)) o += tok(s.map.bufAt);
    if (s.map.bufAt === 'axi') o += `<text x="1074" y="${shelfY('axi') + 22}" text-anchor="end" font-size="11" class="muted">.dma_buffer</text>`;

    // Roads
    const MX = [470, 446, 100, 50];
    o += `<rect x="${MX[0]}" y="${MX[1]}" width="${MX[2]}" height="${MX[3]}" rx="8" class="matrix"/>`;
    o += `<text x="${MX[0] + 50}" y="${MX[1] + 22}" text-anchor="middle" font-size="12" font-weight="700">bus</text><text x="${MX[0] + 50}" y="${MX[1] + 38}" text-anchor="middle" font-size="12" font-weight="700">matrix</text>`;
    ['flash', 'axi', 'sram12', 'sram4', 'periph'].forEach((id) => {
      o += `<path d="M${MX[0] + 100} ${MX[1] + 25} C 610 ${MX[1] + 25}, 610 ${shelfY(id) + 28}, 660 ${shelfY(id) + 28}" class="road"/>`;
    });
    o += `<path d="M362 300 C 420 300, 420 ${MX[1] + 15}, ${MX[0]} ${MX[1] + 15}" class="road"/>`;
    o += `<path d="M362 490 C 420 490, 420 ${MX[1] + 35}, ${MX[0]} ${MX[1] + 35}" class="road-dma"/>`;
    o += `<path d="M362 292 C 520 250, 560 ${shelfY('dtcm') + 20}, 660 ${shelfY('dtcm') + 20}" class="road-tcm"/>`;
    o += `<path d="M362 312 C 390 590, 600 ${shelfY('itcm') + 28}, 660 ${shelfY('itcm') + 28}" class="road-tcm"/>`;
    if (s.map.blocked) {
      const yb = shelfY('dtcm') + 42;
      o += `<path d="M362 478 C 430 470, 450 ${yb}, 540 ${yb} L 660 ${yb}" class="road-bad"/>`;
      o += `<line x1="590" y1="${yb - 12}" x2="614" y2="${yb + 12}" class="xmark"/><line x1="614" y1="${yb - 12}" x2="590" y2="${yb + 12}" class="xmark"/>`;
    }
    if (s.map.roadOk) o += `<text x="600" y="${shelfY('axi') + 50}" font-size="11" font-weight="700" class="oktxt">DMA ✓</text>`;
    o += '<text x="16" y="282" font-size="11" class="muted">CPU: <tspan font-weight="700" fill="var(--robot-cpu)">private wires</tspan> to ITCM and DTCM,</text><text x="16" y="297" font-size="11" class="muted">everything else through the bus matrix.</text>';
    o += '<text x="16" y="520" font-size="11" class="muted">DMA: only through</text><text x="16" y="535" font-size="11" class="muted">the bus matrix.</text>';
    return o;
  }

  function viewCache(c) {
    const s = c.base, st = c.st, prev = c.prev;
    let o = codePanel(CODE[s.code], c.step.line, 16, 78, 470, 176);
    o += '<rect x="604" y="14" width="482" height="136" rx="8" class="shelf"/>';
    o += '<text x="616" y="34" font-size="13" font-weight="700">Flash 0x0800 0000</text><text x="1076" y="34" text-anchor="end" font-size="10.5" class="muted">slow for the CPU: ~8 pulses per trip</text>';
    o += '<rect x="616" y="66" width="458" height="32" rx="5" class="cell"/><text x="626" y="87" font-size="12" class="mono">loop code: 8 instructions</text>';
    o += '<rect x="616" y="106" width="458" height="32" rx="5" class="cell"/><text x="626" y="127" font-size="12" class="mono">where is tx_done? → 0x2000 008C</text>';
    o += '<rect x="604" y="160" width="482" height="80" rx="8" class="shelf"/>';
    o += '<text x="616" y="180" font-size="13" font-weight="700">DTCM 0x2000 0000</text><text x="1076" y="180" text-anchor="end" font-size="10.5" class="muted">private wires to the CPU, no tray needed</text>';
    o += '<text x="626" y="212" font-size="12" class="mono">tx_done = 0     free_work = …</text>';
    o += `<rect x="604" y="250" width="482" height="96" rx="8" class="shelf${s.cache.mpu ? ' hot' : ''}"/>`;
    o += '<text x="616" y="270" font-size="13" font-weight="700">AXI SRAM 0x2400 0000</text><text x="1076" y="270" text-anchor="end" font-size="10.5" class="muted">the DMA reads here</text>';
    o += `<text x="626" y="300" font-size="12" class="mono">tx_buf: ${esc(s.cache.shelf)}</text>`;
    if (s.cache.mpu) o += '<rect x="616" y="312" width="458" height="26" rx="6" class="mpu"/><text x="845" y="330" text-anchor="middle" font-size="11.5" font-weight="700">MPU rule: 0x2400 0000 + 1 KB, no tray (not cacheable)</text>';

    o += '<path d="M604 82 L560 82 L560 380 L506 380" class="bus"/>';
    o += '<text x="566" y="230" font-size="10.5" class="muted" transform="rotate(90 566 230)">bus to Flash</text>';

    const tray = (y, name, on, content) => `<rect x="196" y="${y}" width="310" height="46" rx="8" class="tray${on ? '' : ' off'}"/>
      <text x="206" y="${y + 18}" font-size="12" font-weight="700">${name} ${on ? 'ON' : 'OFF'}</text>
      <text x="206" y="${y + 36}" font-size="11" class="mono">${esc(on ? content || '(empty)' : '')}</text>`;
    o += tray(328, 'I-cache tray (instructions)', s.cache.ic, s.cache.trayI) + tray(382, 'D-cache tray (data)', s.cache.dc, s.cache.trayD);
    o += '<text x="196" y="320" font-size="10.5" class="muted">fast copies next to the CPU</text>';

    const k = c.moves && c.sameView ? c.t : 1;
    const cpr = lerp(c.sameView ? prev.cache.cpr : st.cache.cpr, st.cache.cpr, k);
    const call = lerp(c.sameView ? prev.cache.call : st.cache.call, st.cache.call, k);
    o += '<rect x="16" y="470" width="420" height="76" rx="8" class="panel"/>';
    o += '<text x="28" y="490" font-size="11.5">pulses per round of own work</text>';
    o += `<text x="28" y="530" class="bigval${st.cache.cpr < 10 ? ' oktxt' : ''}">${cpr.toFixed(2)}</text>`;
    o += `<text x="250" y="490" font-size="11.5">pulses to start a send</text><text x="250" y="530" class="bigval" style="font-size:24px">${fmt(call)}</text>`;

    o += '<rect x="820" y="370" width="266" height="176" rx="8" class="term"/>';
    o += '<text x="832" y="390" font-size="11" class="termdim">laptop terminal</text>';
    s.cache.cterm.forEach((l, i) => { o += `<text x="832" y="${414 + i * 19}" font-size="12.5" class="termtext" xml:space="preserve">${esc(l)}</text>`; });
    return o;
  }

  const VIEWS = { board: viewBoard, uart: viewUart, map: viewMap, cache: viewCache };
  const VIEW_ROBOTS = { board: ['cpu'], uart: ['cpu', 'uart', 'dma'], map: ['cpu', 'dma'], cache: ['cpu', 'dma'] };

  function frame(i, t) {
    const st = STATES[i], prev = STATES[Math.max(0, i - 1)], step = STEPS[i];
    const sameView = prev.view === st.view;
    const moves = t < 1 && i > 0;
    const base = moves && sameView && t < 0.6 ? prev : st;
    const c = { st, prev: sameView ? prev : st, base, step, t, moves, sameView };
    const fade = moves && !sameView ? clamp01(t * 2.5) : 1;
    let o = `<svg viewBox="0 0 1100 560" role="img" aria-label="${esc(step.title)}"><g opacity="${fade}">`;
    o += VIEWS[st.view](c);

    // Flying tokens
    if (moves && step.fly) {
      for (const f of step.fly) {
        const t0 = f.t0 || 0, t1 = f.t1 === undefined ? 1 : f.t1;
        const q = clamp01((t - t0) / (t1 - t0));
        if (q <= 0 || q >= 1) continue;
        const a = ANCHOR[st.view](f.from), b = ANCHOR[st.view](f.to);
        const x = lerp(a[0], b[0], q), y = lerp(a[1], b[1], q) - Math.sin(q * Math.PI) * 30;
        const w = Math.max(28, f.label.length * 8.5 + 14);
        o += `<rect x="${x - w / 2}" y="${y - 14}" width="${w}" height="28" rx="14" class="${f.cls}"/><text x="${x}" y="${y + 5}" text-anchor="middle" font-size="13" font-weight="700" class="tw mono">${esc(f.label)}</text>`;
      }
    }

    // Robots (the programmer "YOU" only appears with an idea)
    const vis = VIEW_ROBOTS[st.view].filter((k) => k !== 'dma' || st.dma);
    if (step.kind === 'idea') vis.push('dev');
    for (const k of vis) {
      const a = c.prev.robots[k], b = k === 'dev' ? HOME[st.view].dev : st.robots[k];
      let x = b[0], y = b[1], walking = 0;
      if (moves && sameView && k !== 'dev') { x = lerp(a[0], b[0], t); y = lerp(a[1], b[1], t); walking = (x !== b[0] || y !== b[1]) ? t : 0; }
      o += robotSvg(k, x, y, k === step.robot || k === 'dev' || !step.robot, walking);
      if (step.say && step.say[k] && (!moves || t > 0.3)) o += bubbleSvg(x, y, step.say[k], st.view === 'uart' && x > 450 && x < 600);
    }

    if (!moves && step.focus) {
      const [x, y, w, h] = step.focus;
      o += `<rect x="${x - 4}" y="${y - 4}" width="${w + 8}" height="${h + 8}" rx="10" class="focus"/>`;
    }
    o += bannerSvg(step, moves ? clamp01((t - 0.5) * 3) : 1);
    return o + '</g></svg>';
  }

  // ---------------------------------------------------------------- playback

  const params = new URLSearchParams(location.search);
  const video = params.has('video');
  if (video) document.body.classList.add('video');
  const firstOf = (ch) => STEPS.findIndex((s) => s.ch === ch);
  const lastOf = (ch) => STEPS.length - 1 - [...STEPS].reverse().findIndex((s) => s.ch === ch);
  const startCh = Math.min(CH.length, Math.max(1, Number(params.get('ch')) || 1));
  const endCh = Math.min(CH.length, Math.max(startCh, Number(params.get('end')) || CH.length));
  const FIRST = firstOf(startCh), LAST = video ? lastOf(endCh) : STEPS.length - 1;

  // ?step=N opens the lesson at step N (handy for sharing one moment)
  const stepParam = Number(params.get('step'));
  const START = stepParam >= 1 && stepParam <= STEPS.length ? stepParam - 1 : FIRST;
  const anim = { i: START, t: 1, raf: 0, last: 0, auto: false, wait: 0 };
  if (stepParam && params.has('t')) anim.t = clamp01(Number(params.get('t'))); // freeze a frame, for checking
  let moreOpen = false; // keep "Look closer" open once the reader opened it

  const SPEED = {
    slow: { dur: 1300, dwell: (s) => 1400 + s.text.length * 26 },
    normal: { dur: 850, dwell: (s) => 900 + s.text.length * 17 },
    fast: { dur: 420, dwell: (s) => 400 + s.text.length * 8 },
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
      <div class="title">${icon}${s.title}</div><div>${s.text}</div>${more}
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
    const dur = STEPS[anim.i].bits ? sp.dur * 2.2 : sp.dur;
    if (anim.t < 1) {
      anim.t = clamp01(anim.t + dt / dur);
      draw();
      if (anim.t >= 1) anim.wait = sp.dwell(STEPS[anim.i]);
      anim.raf = requestAnimationFrame(tick);
    } else if (anim.auto) {
      anim.wait -= dt;
      if (anim.wait <= 0) {
        if (anim.i < LAST) goNext(); else { anim.auto = false; renderPopup(); return; }
      }
      anim.raf = requestAnimationFrame(tick);
    }
  }

  let scrolled = video;
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
      jump(Math.max(FIRST, anim.i - 1));
    } else {
      jump(FIRST);
    }
  });
  $('#chapters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ch]');
    if (b) { jump(firstOf(Number(b.dataset.ch))); bringIntoView(); }
  });
  $('#btn-restart').onclick = () => jump(FIRST);
  $('#btn-play').onclick = () => {
    if (anim.auto) { anim.auto = false; cancelAnimationFrame(anim.raf); anim.t = 1; draw(); renderPopup(); return; }
    if (anim.i === LAST) jump(FIRST);
    anim.auto = true;
    anim.wait = 0;
    renderPopup();
    run();
  };
  // Keyboard: right arrow or space = next, left arrow = back
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('select, input, textarea, summary')) return;
    if (e.key === 'ArrowRight' || e.key === ' ') {
      e.preventDefault();
      if (anim.i < LAST) { anim.auto = false; goNext(); run(); }
    } else if (e.key === 'ArrowLeft') {
      jump(Math.max(FIRST, anim.i - 1));
    }
  });

  if (params.get('speed') && SPEED[params.get('speed')]) $('#speed').value = params.get('speed');
  renderPopup();
  draw();
})();
