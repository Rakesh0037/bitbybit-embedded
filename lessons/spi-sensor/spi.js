/* BitByBit Embedded - "Read a sensor over SPI" lesson.
 *
 * Everything on the page is derived from one `state` object. Any change
 * (part, clock, mode, fault) recomputes the simulated transfer and redraws.
 *
 * The transfer is simulated on the wires, not scripted: both sides follow the
 * real edge rules (the sensor reads MOSI on one SCK edge and changes MISO on
 * the other; the master changes MOSI at the start of each bit and reads MISO
 * in the middle). A reader always gets the value the line had just before
 * the edge, so a wrong SPI mode produces its real one-bit shift by itself.
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------- data

  const MCUS = [
    {
      id: 'stm32',
      name: 'STM32',
      board: 'Nucleo-144 board',
      blurb: 'Arm Cortex-M microcontroller from ST. It starts every transfer and makes the clock.',
      facts: ['Arm Cortex-M', 'SPI master', 'All 4 SPI modes'],
      spi: 'SPI1',
      // Arduino header pins of the Nucleo-144 board
      pins: {
        sck: { pin: 'PA5', hdr: 'D13' },
        miso: { pin: 'PA6', hdr: 'D12' },
        mosi: { pin: 'PB5', hdr: 'D11' },
        cs: { pin: 'PD14', hdr: 'D10' },
      },
      hse: 8, // MHz, from the on-board ST-LINK MCO (bypass mode, no crystal)
    },
    {
      id: 'more',
      name: 'More microcontrollers',
      board: '',
      blurb: 'Other families will follow.',
      facts: [],
      soon: true,
    },
  ];

  const hex = (v) => (v === null || v === undefined) ? '--' : '0x' + v.toString(16).toUpperCase().padStart(2, '0');
  const bin = (v) => v.toString(2).padStart(8, '0').replace(/(\d{4})(\d{4})/, '$1 $2');

  const SENSORS = [
    {
      id: 'generic',
      name: 'Generic SPI sensor',
      maker: 'Learning model · start here',
      measures: 'Works in all 4 SPI modes, so you can learn each mode without errors',
      interfaces: ['SPI'],
      maxSck: 10,
      modes: [0, 1, 2, 3],
      pinNames: { sck: 'SCK', mosi: 'MOSI', miso: 'MISO', cs: 'CS' },
      reg: 0x0F, regName: 'WHO_AM_I', expected: 0xA5,
      readCmd: (r) => r | 0x80,
      decode(b) {
        const read = (b & 0x80) !== 0;
        const reg = b & 0x7F;
        return { read, reg, text: `bit 7 = ${read ? 1 : 0} → <strong>${read ? 'READ' : 'WRITE'}</strong>, bits 6–0 → register ${hex(reg)}` };
      },
      notes: [
        'A model sensor for learning. It follows whichever SPI mode you choose, so every mode works. Real sensors usually allow only some modes: compare with the BME280 and ADXL345.',
        'First byte: bit 7 = read/write (<strong>1 = read</strong>), bits 6–0 = register address. Many real sensors use this same pattern.',
      ],
    },
    {
      id: 'bme280',
      name: 'BME280',
      maker: 'Bosch Sensortec',
      measures: 'Temperature, humidity, pressure',
      interfaces: ['SPI', 'I²C'],
      maxSck: 10, // MHz
      modes: [0, 3],
      pinNames: { sck: 'SCK', mosi: 'SDI', miso: 'SDO', cs: 'CSB' },
      reg: 0xD0, regName: 'chip_id', expected: 0x60,
      readCmd: (r) => r | 0x80,
      // In SPI mode bit 7 of the first byte is R/W and replaces the register MSB.
      decode(b) {
        const read = (b & 0x80) !== 0;
        const reg = (b & 0x7F) | 0x80;
        return { read, reg, text: `bit 7 = ${read ? 1 : 0} → <strong>${read ? 'READ' : 'WRITE'}</strong>, bits 6–0 = ${hex(b & 0x7F)} → register ${hex(reg)}` };
      },
      notes: [
        'Pulling CSB low selects SPI. After that the BME280 stays in SPI mode until it is powered off.',
        'Only 7 address bits are sent. Bit 7 of the first byte is the read/write bit: <strong>1 = read</strong>, 0 = write.',
      ],
    },
    {
      id: 'adxl345',
      name: 'ADXL345',
      maker: 'Analog Devices',
      measures: '3-axis acceleration',
      interfaces: ['SPI', 'I²C'],
      maxSck: 5,
      modes: [3],
      pinNames: { sck: 'SCL/SCLK', mosi: 'SDA/SDI', miso: 'SDO', cs: 'CS' },
      reg: 0x00, regName: 'DEVID', expected: 0xE5,
      readCmd: (r) => r | 0x80,
      decode(b) {
        const read = (b & 0x80) !== 0;
        const mb = (b & 0x40) !== 0;
        const reg = b & 0x3F;
        return { read, reg, text: `bit 7 = ${read ? 1 : 0} → <strong>${read ? 'READ' : 'WRITE'}</strong>, bit 6 (multi-byte) = ${mb ? 1 : 0}, bits 5–0 → register ${hex(reg)}` };
      },
      notes: [
        'The datasheet allows only <strong>SPI mode 3</strong> (CPOL = 1, CPHA = 1).',
        'First byte: bit 7 = read/write (1 = read), bit 6 = multi-byte (read several registers in one go), bits 5–0 = register.',
      ],
    },
  ];

  const FAULTS = [
    { id: 'rcc', t: 'Forgot to enable the SPI1 clock', d: '__HAL_RCC_SPI1_CLK_ENABLE() is missing. The peripheral is powered down.' },
    { id: 'af', t: 'SCK pin not switched to SPI (AF5)', d: 'The SCK pin stays in its reset state, so the clock never reaches the wire.' },
    { id: 'cs', t: 'CS never goes low', d: 'Wrong CS pin, or the HAL_GPIO_WritePin() before the transfer is missing.' },
    { id: 'readbit', t: 'Forgot the read bit', d: 'Sent the bare register address. Bit 7 is 0, so the sensor sees a write.' },
    { id: 'miso', t: 'MISO wire is broken', d: 'Loose jumper wire or bad solder joint on the sensor output.' },
  ];

  // ---------------------------------------------------------------- state

  const state = {
    mcu: null,
    sensor: null,
    clock: { osc: 'hse', m: 1, n: 50, q: 4, kernel: 'pll1q', mbr: 4 },
    mode: 0,
    faults: new Set(),
    history: [],
  };

  const $ = (s) => document.querySelector(s);
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fmtMHz = (f) => !isFinite(f) ? '—' : f >= 1 ? `${+f.toFixed(3)} MHz` : `${+(f * 1000).toFixed(1)} kHz`;
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------------------------------------------------------------- clock

  function clockCalc() {
    const c = state.clock;
    const oscF = { hse: state.mcu.hse, hsi: 64, csi: 4 }[c.osc];
    const ref = oscF / c.m;
    const vco = ref * c.n;
    const pllq = vco / c.q;
    const errors = [];
    if (ref < 1 || ref > 16) errors.push(`PLL input = ${fmtMHz(ref)}. It must be between 1 and 16 MHz, otherwise the PLL cannot lock. Change the divider M.`);
    if (vco < 192 || vco > 836) errors.push(`VCO = ${fmtMHz(vco)}. It must be between 192 and 836 MHz (wide range), otherwise the PLL cannot lock. Change N.`);
    const pllOk = errors.length === 0;
    const kernel = c.kernel === 'pll1q' ? (pllOk ? pllq : NaN) : 64;
    const div = 2 ** (c.mbr + 1);
    return { oscF, ref, vco, pllq, pllOk, errors, kernel, div, sck: kernel / div };
  }

  // ---------------------------------------------------------------- mode

  const cpolOf = (m) => m >> 1;
  const cphaOf = (m) => m & 1;
  // The master reads in the middle of each bit period; whether that edge rises depends on both bits.
  const sampleEdge = (m) => (cpolOf(m) ^ cphaOf(m)) ? 'falling' : 'rising';

  // The edge on which the sensor reads MOSI. A sensor that supports the mode
  // follows it; the BME280 and ADXL345 always read on rising edges.
  const sensorReadEdge = (sensor, m) => (sensor.modes.includes(m) ? sampleEdge(m) : 'rising');
  const other = (e) => (e === 'rising' ? 'falling' : 'rising');

  function modeCompat(sensor, m) {
    if (sensor.modes.includes(m)) return 'ok';
    return sampleEdge(m) === 'rising' ? 'warn' : 'bad';
  }

  // ---------------------------------------------------------------- timeline
  //
  // Time runs in half-clock units u. 0..2 idle, CS falls at 2, the master
  // loads at 3, bit i occupies [T0 + 2i, T0 + 2i + 2), CS rises at 37.

  const T0 = 4, CS_LOW = 2, CS_HIGH = 37, UEND = 39;
  const bitStart = (i) => T0 + 2 * i;
  const bitMid = (i) => T0 + 2 * i + 1;

  function edgeAt(arr, u) {
    if (u <= 0 || u >= arr.length) return null;
    const a = arr[u - 1], b = arr[u];
    if (a === 'z' || b === 'z' || a === b) return null;
    return b === 1 ? 'rising' : 'falling';
  }

  // ---------------------------------------------------------------- simulation

  function simulate() {
    const s = state.sensor;
    const f = state.faults;
    const clk = clockCalc();
    const compat = modeCompat(s, state.mode);
    const cpol = cpolOf(state.mode), cpha = cphaOf(state.mode);
    const cmd = f.has('readbit') ? s.reg & 0x7F : s.readCmd(s.reg);
    const noKernel = !isFinite(clk.sck);
    const r = {
      cmd, tx: [cmd, 0x00], rx: [0xFF, 0xFF], hal: 'HAL_OK', compat, noKernel,
      cs: f.has('cs') ? 'off' : 'run',
      sck: f.has('rcc') || f.has('af') || noKernel ? 'off' : 'run',
      mosi: f.has('rcc') || noKernel ? 'off' : 'run',
      reads: [], outFalls: [], got: null, decoded: null, decodeU: null, out: null,
      misoBits: Array(16).fill('z'), flipped: Array(16).fill(false),
      verdict: 'bad', title: '', lines: [],
    };
    r.masterReads = r.mosi === 'run';
    r.sensorActive = r.cs === 'run' && r.sck === 'run';

    // What the master drives
    const w = { cs: [], sck: [], mosi: [], sensorMiso: Array(UEND).fill('z') };
    for (let u = 0; u < UEND; u++) {
      const inside = u >= T0 && u < T0 + 32;
      const bit = Math.floor((u - T0) / 2), half = (u - T0) % 2;
      w.cs.push(r.cs === 'off' ? 1 : (u >= CS_LOW && u < CS_HIGH ? 0 : 1));
      if (r.sck === 'off') w.sck.push('z');
      else if (!inside) w.sck.push(cpol);
      else w.sck.push((cpha ? half === 0 : half === 1) ? 1 - cpol : cpol);
      w.mosi.push(r.mosi === 'off' || !inside ? 'z' : (r.tx[bit >> 3] >> (7 - (bit & 7))) & 1);
    }

    // The sensor: reads MOSI on its read edge while selected
    const rdEdge = sensorReadEdge(s, state.mode);
    r.sensorEdge = rdEdge;
    if (r.sensorActive) {
      for (let u = T0; u <= T0 + 32; u++) {
        if (edgeAt(w.sck, u) !== rdEdge) continue;
        const v = w.mosi[u - 1];
        // At the start of a bit the master is changing MOSI at the same moment
        r.reads.push({ u, v: v === 'z' ? '?' : v, race: (u - T0) % 2 === 0 && u < T0 + 32 });
      }
      if (r.reads.length >= 8) {
        r.got = r.reads.slice(0, 8).reduce((a, x) => (a << 1) | (x.v === 1 ? 1 : 0), 0);
        r.decoded = s.decode(r.got);
        r.decodeU = r.reads[7].u + 0.5;
        if (r.decoded.read) r.out = r.decoded.reg === s.reg ? s.expected : 0x00;
      }
      // ...and shifts its answer out on the opposite edges that follow
      if (r.out !== null) {
        for (let u = Math.ceil(r.decodeU); u < CS_HIGH && r.outFalls.length < 8; u++) {
          if (edgeAt(w.sck, u) === other(rdEdge)) r.outFalls.push(u);
        }
        r.outFalls.forEach((u0, k) => {
          const end = k < r.outFalls.length - 1 ? r.outFalls[k + 1] : CS_HIGH;
          for (let u = u0; u < end; u++) w.sensorMiso[u] = (r.out >> (7 - k)) & 1;
        });
      }
    }
    // What arrives at the MCU pin
    w.miso = f.has('miso') ? Array(UEND).fill('z') : w.sensorMiso.slice();
    r.wave = w;

    // The master: reads MISO in the middle of every bit
    const tooFast = clk.sck > s.maxSck;
    if (r.masterReads) {
      const p = clk.sck / s.maxSck <= 1.5 ? 0.08 : 0.3;
      for (let i = 0; i < 16; i++) {
        let v = w.miso[bitStart(i)];
        if (tooFast && v !== 'z' && Math.random() < p) { v ^= 1; r.flipped[i] = true; }
        r.misoBits[i] = v;
      }
      const byte = (b) => r.misoBits.slice(b * 8, b * 8 + 8).reduce((a, v) => (a << 1) | (v === 'z' ? 1 : v), 0);
      r.rx = [byte(0), byte(1)];
    } else {
      r.rx = [0x00, 0x00];
      r.hal = 'HAL_TIMEOUT';
    }

    // Verdict and explanation
    const L = (t) => r.lines.push(t);
    const set = (v, t) => { r.verdict = v; r.title = t; };
    const right = r.rx[1] === s.expected;
    const race = 'On real hardware this is a race. It may work with a slow clock on your desk and fail with a longer wire or a warmer board.';

    if (!r.masterReads) {
      if (f.has('rcc')) {
        set('bad', 'SPI1 has no clock, so nothing happens');
        L('<code>__HAL_RCC_SPI1_CLK_ENABLE()</code> was never called. Without its bus clock, SPI1 ignores every register write, so the configuration never arrives.');
      } else {
        set('bad', 'No kernel clock: SPI1 cannot make SCK');
        L('The PLL settings in 3.3 are invalid, so <code>pll1_q_ck</code> does not exist. SPI1 has nothing to divide down into SCK.');
      }
      L('<code>HAL_SPI_TransmitReceive()</code> waits for a "transfer done" flag that never comes, and returns <strong>HAL_TIMEOUT</strong> after 10 ms.');
      L('SCK and MOSI never move. <code>rx[]</code> keeps its old content (0x00).');
    } else if (r.sck === 'off') {
      set('bad', 'HAL says OK, but the answer is 0xFF');
      L(`${state.mcu.pins.sck.pin} is still in its reset state (analog mode). SPI1 runs its clock internally, but the signal never reaches the pin.`);
      L('The sensor sees no clock, so it never shifts anything out. MISO is not driven, and the pull-up makes every bit read as 1: <strong>0xFF</strong>.');
      L('HAL only checks its own peripheral and cannot see the pin, so it reports <strong>HAL_OK</strong>.');
    } else if (r.cs === 'off') {
      set('bad', 'CS stays high, so the sensor ignores everything');
      L('On a scope, SCK and MOSI toggle perfectly. But the sensor is not selected, so it ignores them and keeps MISO released (high-Z) → <strong>0xFF</strong>.');
      if (s.id === 'bme280') L('For the BME280 it is worse: CSB never went low, so it stays in I²C mode.');
      L('Typical causes: CS pin not set up as an output, the wrong pin, or the <code>HAL_GPIO_WritePin(..., GPIO_PIN_RESET)</code> before the transfer is missing.');
    } else if (r.got !== cmd) {
      set('bad', 'Wrong SPI mode: the command arrived shifted by one bit');
      L(`In mode ${state.mode} the master changes MOSI on the rising edge, which is exactly the edge the sensor reads on (red dots). The sensor catches every bit one clock late.`);
      L(`The sensor received ${hex(r.got)} instead of ${hex(cmd)}: ${r.decoded.text}.`);
      if (!r.decoded.read) L('Bit 7 is now 0, so the sensor treats this as a write and never answers → <strong>0xFF</strong>.');
      L(race);
    } else if (!r.decoded.read) {
      set('bad', 'The sensor thought you were writing');
      L(`Command sent: ${hex(cmd)} = ${bin(cmd)}. Bit 7 is 0 → WRITE.`);
      L(`The sensor stores your dummy byte 0x00 into register ${hex(r.decoded.reg)}. That register is read-only, so nothing happened. On a configuration register you would have silently changed the sensor's settings.`);
      L('During a write the sensor does not drive MISO → <strong>0xFF</strong>.');
    } else if (f.has('miso')) {
      set('bad', 'MISO is broken: the sensor answers, but nobody hears it');
      L('The sensor received the command and drives the answer on its SDO pin, but the wire is open.');
      L('The MCU pin only sees its pull-up → <strong>0xFF</strong>. Without the pull-up it would read random values.');
      L('An ID of 0xFF (or 0x00) is the classic sign of a dead MISO line or a chip that is not selected.');
    } else if (compat === 'bad' && !right) {
      set('bad', 'Wrong SPI mode: the answer arrived shifted by one bit');
      L(`The command arrived correctly: in mode ${state.mode} the sensor reads at the end of each bit, just before MOSI changes.`);
      L(`But the sensor changes MISO on the falling edge, and in mode ${state.mode} that is exactly when the master reads it (red text in the step popups). The master catches every answer bit one clock late: ${hex(r.out)} becomes <strong>${hex(r.rx[1])}</strong>.`);
      L(race);
    } else if (tooFast && !right) {
      set('bad', 'SCK too fast: bits flip at random');
      L(`SCK = ${fmtMHz(clk.sck)}, but the ${s.name} allows at most ${s.maxSck} MHz. The data line has not settled when it is read.`);
      L('Press <em>Read again</em>: the value changes from read to read.');
    } else if (tooFast) {
      set('warn', 'Out of spec. It worked this time.');
      L(`SCK = ${fmtMHz(clk.sck)}, but the ${s.name} allows at most ${s.maxSck} MHz. Press <em>Read again</em> a few times.`);
    } else if (compat === 'warn') {
      set('warn', 'It worked, but only by luck');
      L(`The ${s.name} datasheet allows only mode ${s.modes.join(' or ')}. Mode ${state.mode} reads on the same rising edges, so the bits arrive, but the clock idles at the wrong level. That is outside the datasheet: it may fail on another board or batch.`);
    } else {
      set('ok', `Success: ${hex(r.rx[1])} is the ${s.name} ${s.regName}`);
      L('<code>rx[0]</code> = 0xFF is junk. While the command was going out, the sensor was still listening and had not started driving MISO yet.');
      L('It takes 16 clocks: 8 to send the command, and 8 more to clock the answer out. To get those 8 clocks the master has to send something, so it sends a dummy byte 0x00. <strong>In SPI, the master always sends in order to receive.</strong>');
    }

    if (tooFast && r.verdict !== 'ok') {
      const need = [2, 4, 8, 16, 32, 64, 128, 256].find((dv) => clk.kernel / dv <= s.maxSck);
      if (need) L(`Fix: set the prescaler in 3.3 to /${need} or higher (${fmtMHz(clk.kernel / need)}).`);
    }
    return r;
  }

  // ---------------------------------------------------------------- step-by-step story

  function buildEvents(r) {
    const s = state.sensor, w = r.wave, ev = [];
    // Where each step's popup points to (scene coordinates)
    const F = {
      cs: { x: 500, y: WY.cs }, sck: { x: 500, y: WY.sck },
      tx: { x: 170, y: ROW_Y.top + 13 }, rx: { x: 170, y: ROW_Y.bottom + 13 }, in: { x: 830, y: ROW_Y.top + 13 },
      mosiM: { x: PIN_M + 8, y: WY.mosi }, mosiS: { x: PIN_S - 14, y: WY.mosi },
      misoM: { x: PIN_M + 14, y: WY.miso }, misoS: { x: PIN_S - 8, y: WY.miso },
    };
    const E = (u, title, text, focus) => ev.push({ u, title, text, focus });
    const cpol = cpolOf(state.mode);
    const bad = (t) => `<span class="bad">${t}</span>`;

    E(0, 'Idle: nobody is talking',
      `CS is <b>HIGH</b>, so the ${s.name} is not selected and ignores the bus. SCK rests at its idle level, <b>${cpol ? 'HIGH' : 'LOW'}</b> (CPOL = ${cpol}). MISO is released: nobody drives it.`, F.cs);
    if (r.cs === 'off') {
      E(CS_LOW, 'CS should go LOW now…', `The program should pull CS LOW to select the sensor, but the line stays <b>HIGH</b>. ${bad(`The ${s.name} keeps ignoring everything that follows.`)}`, F.cs);
    } else {
      E(CS_LOW, 'The master pulls CS LOW', `<code>HAL_GPIO_WritePin(CS, GPIO_PIN_RESET)</code>: CS goes <b>LOW</b>. That means "${s.name}, listen to me". From now on the sensor watches SCK and MOSI.`, F.cs);
    }

    if (!r.masterReads) {
      E(3, 'The master tries to start', `<code>HAL_SPI_TransmitReceive()</code> writes to SPI1, but SPI1 has no clock${r.noKernel ? ' (invalid PLL settings)' : ''}. ${bad('Nothing happens: SCK and MOSI stay still.')}`, F.tx);
      E(CS_HIGH, 'Timeout', `HAL waits for a "done" flag that never comes. After 10 ms it gives up and returns <b>HAL_TIMEOUT</b>.`, F.rx);
    } else {
      E(3, 'The master loads the command', `<code>HAL_SPI_TransmitReceive()</code> puts tx[0] = <b>${hex(r.tx[0])}</b> (${bin(r.tx[0])}) into SPI1's TX register. It goes out MSB first: bit 7 first.`, F.tx);
      if (r.sck === 'off') {
        E(T0 - 0.5, 'The clock never reaches the wire', `SPI1 is running and shifts the bits onto MOSI, but ${state.mcu.pins.sck.pin} is not connected to SPI1 (no AF5). ${bad('The SCK wire stays flat, so the sensor never sees an edge and never reads anything.')}`, F.sck);
      }
      for (let u = T0; u <= T0 + 32; u++) {
        const parts = [];
        const off = u - T0, bit = Math.floor(off / 2);
        const start = off % 2 === 0 && bit < 16, mid = off % 2 === 1;
        const edge = edgeAt(w.sck, u);
        if (start) {
          const bp = 7 - (bit & 7), v = w.mosi[u];
          if (bit === 8) parts.push('Command sent. Now the master sends the dummy byte <b>0x00</b>, only to make 8 more clock pulses for the answer.');
          const how = edge ? ` on this <b>${edge}</b> edge` : bit === 0 && r.sck === 'run' ? ', before the first clock edge (CPHA = 0 wants the bit ready before the first edge)' : '';
          parts.push(`The master puts bit ${bp} = <b>${v}</b> on MOSI${how}, and holds it there for the whole bit.`);
        }
        const k = r.outFalls.indexOf(u);
        if (k >= 0) parts.push(`The sensor puts answer bit ${7 - k} = <b>${(r.out >> (7 - k)) & 1}</b> on MISO, on this ${other(r.sensorEdge)} edge.`);
        const x = r.reads.find((y) => y.u === u);
        if (x) {
          const idx = r.reads.indexOf(x);
          parts.push(`${r.sensorEdge === 'rising' ? '↑ Rising' : '↓ Falling'} edge: the sensor reads MOSI = <b>${x.v}</b>${idx >= 8 ? ' (dummy bit, ignored)' : ''}.` + (x.race ? ' ' + bad('But the master is changing MOSI at this exact moment, so the sensor catches the old value!') : ''));
        }
        if (mid && r.masterReads && bit < 16) {
          const v = r.misoBits[bit];
          let t = `${edge === 'rising' ? '↑ ' : edge === 'falling' ? '↓ ' : ''}The master reads MISO = <b>${v === 'z' ? 1 : v}</b>`;
          if (v === 'z') t += ' (nobody drives it, the pull-up makes it 1)';
          t += '.';
          if (k >= 0) t += ' ' + bad('The sensor changes MISO at this exact moment, so the master catches the old value!');
          if (r.flipped[bit]) t += ' ' + bad('The clock is too fast: this bit arrived wrong!');
          parts.push(t);
        }
        if (parts.length) {
          const b = Math.min(bit, 15) + 1;
          const focus = x && x.race ? F.mosiS : start ? F.mosiM : x ? F.mosiS : k >= 0 ? F.misoS : F.misoM;
          E(u, `Bit ${b} of 16${edge ? ` · ${edge === 'rising' ? '↑ rising' : '↓ falling'} edge` : ''}`, parts.join(' '), focus);
        }
      }
      if (r.decodeU !== null) {
        const d = r.decoded;
        let t = `The sensor now has all 8 command bits: <b>${hex(r.got)}</b>${r.got !== r.cmd ? ' ' + bad(`(the master sent ${hex(r.cmd)}!)`) : ''}. ${d.text}. `;
        t += d.read
          ? (d.reg === s.reg ? `It loads the ${s.regName} value <b>${hex(r.out)}</b> into its output register, ready to send.` : `It loads the content of that register, not the ${s.regName}.`)
          : bad('A write: it will store the next byte into that register and sends nothing back.');
        E(r.decodeU, 'The sensor decodes the command', t, F.in);
      }
      E(CS_HIGH, r.cs === 'off' ? 'Transfer finished' : 'The master pulls CS HIGH',
        r.cs === 'off'
          ? `16 clock pulses done, but nobody was listening. HAL returns <b>${r.hal}</b>.`
          : `16 clock pulses done. CS goes <b>HIGH</b>: the sensor releases MISO and stops listening. HAL returns <b>${r.hal}</b>.`, F.cs);
    }
    E(UEND - 1, 'Result', `rx[1] = <b>${hex(r.rx[1])}</b>, expected ${hex(s.expected)}. ${r.verdict === 'ok' ? r.title + '.' : bad(r.title + '.')}`, F.rx);
    ev.sort((a, b) => a.u - b.u);
    return ev;
  }

  // ---------------------------------------------------------------- step 1 & 2: choices

  function renderChoices() {
    $('#mcu-list').innerHTML = MCUS.map((m) => `
      <button class="choice ${state.mcu === m ? 'selected' : ''}" data-mcu="${m.id}" ${m.soon ? 'disabled' : ''}>
        <span class="title">${m.name}</span>
        <span class="meta">${m.board}${m.soon ? 'Coming soon' : ''}</span>
        <span>${m.blurb}</span>
        <span class="facts">${m.facts.map((f) => `<span>${f}</span>`).join('')}</span>
      </button>`).join('');

    $('#sensor-list').innerHTML = SENSORS.map((s) => `
      <button class="choice ${state.sensor === s ? 'selected' : ''}" data-sensor="${s.id}">
        <span class="title">${s.name}</span>
        <span class="meta">${s.maker}</span>
        <span>${s.measures}</span>
        <span class="facts">
          <span>SPI up to ${s.maxSck} MHz</span>
          <span>${s.modes.length === 4 ? 'All 4 modes' : `Only mode ${s.modes.join(' & ')}`}</span>
          <span>${s.regName} ${hex(s.reg)} = ${hex(s.expected)}</span>
        </span>
      </button>`).join('');

    $('#step2').classList.toggle('locked', !state.mcu);
    $('#step3').classList.toggle('locked', !state.sensor);
    document.querySelectorAll('.stepper a').forEach((a) => {
      const n = +a.dataset.step;
      a.classList.toggle('done', (n === 1 && !!state.mcu) || (n === 2 && !!state.sensor));
      a.classList.toggle('locked', (n === 2 && !state.mcu) || (n === 3 && !state.sensor));
    });
  }

  document.addEventListener('click', (e) => {
    const mcuBtn = e.target.closest('[data-mcu]');
    if (mcuBtn) {
      state.mcu = MCUS.find((m) => m.id === mcuBtn.dataset.mcu);
      renderChoices();
      if (state.sensor) renderAll();
      $('#step2').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const sBtn = e.target.closest('[data-sensor]');
    if (sBtn) {
      state.sensor = SENSORS.find((s) => s.id === sBtn.dataset.sensor);
      state.history = [];
      renderChoices();
      renderAll();
      $('#step3').scrollIntoView({ behavior: 'smooth' });
    }
  });

  // ---------------------------------------------------------------- 3.1 why SPI

  function renderWhy() {
    const s = state.sensor;
    const has = (i) => s.interfaces.includes(i);
    const rows = [
      ['SPI', 'SCK, MOSI, MISO + one CS per device (4)', 'Tens of MHz', 'The master drives SCK', has('SPI') ? '✅ The sensor has it. Fast, simple, sends and receives at the same time.' : '❌ Not offered'],
      ['I²C', 'SDA, SCL + pull-up resistors (2)', '100 kHz / 400 kHz / 1 MHz', 'The master drives SCL', has('I²C') ? '✅ Also possible. Fewer wires, but slower, and each device needs an address.' : '❌ Not offered'],
      ['UART', 'TX, RX (2)', 'Up to a few Mbit/s', 'Nobody: both sides must agree on the baud rate', '❌ The sensor has no UART'],
      ['CAN', 'CANH, CANL (differential) + transceiver', 'Up to 1 Mbit/s (8 with CAN FD)', 'Nobody: every node keeps its own bit timing', '❌ Made for cables between control units, not chips on one board'],
      ['LIN', '1 wire + transceiver', 'Up to 20 kbit/s', 'The master sends a sync byte', '❌ For slow car-body electronics'],
    ];
    $('#why-body').innerHTML = `
      <p>The ${s.name} offers <strong>${s.interfaces.join(' and ')}</strong>. The other buses are listed here so you can see why they do not fit this task.</p>
      <div class="table-scroll"><table>
        <thead><tr><th>Bus</th><th>Wires</th><th>Speed</th><th>Who makes the clock?</th><th>For this task</th></tr></thead>
        <tbody>${rows.map((r) => `<tr${r[0] === 'SPI' ? ' style="background:var(--accent-soft)"' : ''}><td><strong>${r[0]}</strong></td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="note info"><strong>Why SPI over I²C here?</strong> SPI drives its lines actively high and low (push-pull), so the edges are sharp and it runs at MHz speeds without pull-up resistors. There are no addresses to get wrong: the CS wire selects the chip. The price is two more wires, plus one extra CS wire for every additional sensor.</div>`;
  }

  // ---------------------------------------------------------------- 3.2 wiring

  function renderWiring(sim) {
    const m = state.mcu, s = state.sensor, f = state.faults;
    const rows = [
      { key: 'sck', name: 'SCK', y: 95, dir: 'r', what: 'clock, made by the MCU' },
      { key: 'mosi', name: 'MOSI', y: 150, dir: 'r', what: 'Master Out → Slave In' },
      { key: 'miso', name: 'MISO', y: 205, dir: 'l', what: 'Master In ← Slave Out' },
      { key: 'cs', name: 'CS', y: 260, dir: 'r', what: 'chip select, low = "you, listen"' },
    ];
    const x1 = 250, x2 = 610, mid = (x1 + x2) / 2;
    let svg = `<svg viewBox="0 0 860 345" role="img" aria-label="SPI wiring between ${m.name} and ${s.name}">
      <rect class="box" x="20" y="20" width="230" height="290" rx="10"/>
      <text x="35" y="48" font-weight="700" font-size="17">${m.name}</text>
      <text x="35" y="68" class="muted" font-size="13">master</text>
      <rect class="box" x="610" y="20" width="230" height="290" rx="10"/>
      <text x="625" y="48" font-weight="700" font-size="17">${s.name}</text>
      <text x="625" y="68" class="muted" font-size="13">${s.maker} · slave</text>`;

    for (const r of rows) {
      const p = m.pins[r.key];
      let st = 'flow';
      let label = r.what;
      if (r.key === 'sck' && sim.sck === 'off') { st = 'dead'; label = f.has('af') ? 'pin not switched to SPI: no clock' : 'silent: SPI1 has no clock'; }
      if (r.key === 'mosi' && sim.mosi === 'off') { st = 'dead'; label = 'silent: SPI1 has no clock'; }
      if (r.key === 'cs' && f.has('cs')) { st = 'dead'; label = 'stays HIGH: sensor not selected'; }
      if (r.key === 'miso') {
        if (f.has('miso')) { st = 'broken'; label = 'wire broken'; }
        else if (sim.out === null) { st = 'dead'; label = 'not driven (high-Z): the sensor stays silent'; }
      }
      const cls = `sig-${r.key}`;
      const arrowX = r.dir === 'r' ? x2 : x1;
      const arrowPts = r.dir === 'r' ? `${arrowX},${r.y} ${arrowX - 12},${r.y - 6} ${arrowX - 12},${r.y + 6}` : `${arrowX},${r.y} ${arrowX + 12},${r.y - 6} ${arrowX + 12},${r.y + 6}`;
      svg += `<text x="240" y="${r.y + 5}" text-anchor="end" font-size="13" class="mono">${p.pin} · ${p.hdr}  <tspan font-weight="700">${r.name}</tspan></text>`;
      svg += `<text x="620" y="${r.y + 5}" font-size="13" class="mono"><tspan font-weight="700">${s.pinNames[r.key]}</tspan></text>`;
      if (st === 'broken') {
        svg += `<line x1="${x1}" y1="${r.y}" x2="${mid - 18}" y2="${r.y}" class="sig-z" stroke-width="3"/>`;
        svg += `<line x1="${mid + 18}" y1="${r.y}" x2="${x2}" y2="${r.y}" class="${cls} flow rev" stroke-width="3"/>`;
        svg += `<path d="M${mid - 8} ${r.y - 8} l16 16 M${mid + 8} ${r.y - 8} l-16 16" class="stroke-bad" stroke-width="3"/>`;
      } else if (st === 'dead') {
        svg += `<line x1="${x1}" y1="${r.y}" x2="${x2}" y2="${r.y}" class="sig-z" stroke-width="3"/>`;
      } else {
        svg += `<line x1="${x1}" y1="${r.y}" x2="${x2}" y2="${r.y}" class="${cls} flow ${r.dir === 'l' ? 'rev' : ''}" stroke-width="3"/>`;
        svg += `<polygon points="${arrowPts}" class="fill-${r.key}"/>`;
      }
      svg += `<text x="${mid}" y="${r.y - 10}" text-anchor="middle" font-size="12.5" ${st !== 'flow' ? 'class="fill-bad"' : 'class="muted"'}>${label}</text>`;
    }
    svg += `<text x="430" y="336" text-anchor="middle" font-size="12" class="muted">Also connect 3V3 and GND. Keep the wires short: SPI is meant for one board.</text></svg>`;
    $('#wiring-svg').innerHTML = svg;

    $('#wiring-notes').innerHTML = `
      <div class="note info"><strong>Who drives what:</strong> the MCU drives SCK, MOSI and CS. The sensor drives MISO, and <em>only while CS is low</em>. The rest of the time it lets go of the line (high-Z), so several sensors can share one MISO wire.</div>
      <div class="note info"><strong>CS is a plain GPIO here</strong> (software NSS): you pull ${m.pins.cs.pin} low before the transfer and back high afterwards.</div>
      ${s.notes.map((n) => `<div class="note info"><strong>${s.name}:</strong> ${n}</div>`).join('')}`;
  }

  // ---------------------------------------------------------------- 3.3 clock

  function renderClockControls() {
    const c = state.clock;
    const mbrOpts = [2, 4, 8, 16, 32, 64, 128, 256];
    $('#clock-controls').innerHTML = `
      <div class="ctl">
        <span class="label">① Oscillator</span>
        <label><input type="radio" name="osc" value="hse" ${c.osc === 'hse' ? 'checked' : ''}> HSE ${state.mcu.hse} MHz (High-Speed External)</label>
        <label><input type="radio" name="osc" value="hsi" ${c.osc === 'hsi' ? 'checked' : ''}> HSI 64 MHz (High-Speed Internal RC oscillator)</label>
        <label><input type="radio" name="osc" value="csi" ${c.osc === 'csi' ? 'checked' : ''}> CSI 4 MHz (low-power internal oscillator)</label>
        <div class="hint">On the Nucleo, HSE comes from the ST-LINK chip, not a crystal. HSI is less accurate but always there.</div>
      </div>
      <div class="ctl">
        <span class="label">② PLL1 (Phase-Locked Loop): divide, multiply, divide</span>
        <div class="row"><input type="number" id="pll-m" min="1" max="63" value="${c.m}"> M ÷ (DIVM, input divider)</div>
        <div class="row"><input type="number" id="pll-n" min="8" max="420" value="${c.n}"> N × (DIVN, multiplier)</div>
        <div class="row"><input type="number" id="pll-q" min="1" max="128" value="${c.q}"> Q ÷ (DIVQ, output divider)</div>
        <div class="hint">PLL1 also makes the CPU clock (output P). That is why real projects often feed SPI from PLL2 or PLL3 instead.</div>
      </div>
      <div class="ctl">
        <span class="label">③ SPI1 kernel clock (SPI123SEL: source select for SPI1/2/3)</span>
        <label><input type="radio" name="ker" value="pll1q" ${c.kernel === 'pll1q' ? 'checked' : ''}> pll1_q_ck (default)</label>
        <label><input type="radio" name="ker" value="per" ${c.kernel === 'per' ? 'checked' : ''}> per_ck = HSI 64 MHz</label>
        <label class="disabled"><input type="radio" disabled> pll2_p_ck / pll3_p_ck</label>
        <label class="disabled"><input type="radio" disabled> I2S_CKIN (external pin)</label>
        <div class="hint">One switch (multiplexer) shared by SPI1, SPI2 and SPI3.</div>
      </div>
      <div class="ctl">
        <span class="label">④ SPI prescaler (MBR: Master Baud Rate): ÷<span id="mbr-val">${mbrOpts[c.mbr]}</span></span>
        <input type="range" id="mbr" min="0" max="7" step="1" value="${c.mbr}" aria-label="SPI prescaler">
        <div class="hint">Only powers of two, from ÷2 to ÷256. This is the knob you turn most.</div>
      </div>`;

    $('#clock-controls').oninput = (e) => {
      const t = e.target;
      if (t.name === 'osc') c.osc = t.value;
      else if (t.name === 'ker') c.kernel = t.value;
      else if (t.id === 'pll-m') c.m = clampInt(t.value, 1, 63);
      else if (t.id === 'pll-n') c.n = clampInt(t.value, 8, 420);
      else if (t.id === 'pll-q') c.q = clampInt(t.value, 1, 128);
      else if (t.id === 'mbr') { c.mbr = +t.value; $('#mbr-val').textContent = mbrOpts[c.mbr]; }
      else return;
      renderClockChain(true);
      refreshSim(false);
    };
  }

  const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(+v || lo)));

  let prevChain = {};
  function renderClockChain(animate) {
    const k = clockCalc(), c = state.clock, s = state.sensor;
    const pllUsed = c.kernel === 'pll1q';
    const nodes = [
      { id: 'osc', k: 'Oscillator', v: fmtMHz(k.oscF), d: c.osc.toUpperCase() },
      { id: 'ref', k: '÷ M (DIVM)', v: fmtMHz(k.ref), d: 'PLL reference', bad: k.ref < 1 || k.ref > 16 },
      { id: 'vco', k: '× N (DIVN)', v: fmtMHz(k.vco), d: 'VCO (Voltage-Controlled Oscillator)', bad: k.vco < 192 || k.vco > 836 },
      { id: 'pllq', k: '÷ Q (DIVQ)', v: k.pllOk ? fmtMHz(k.pllq) : '—', d: 'pll1_q_ck', bad: !k.pllOk },
      { id: 'ker', k: 'Kernel clock', v: fmtMHz(k.kernel), d: pllUsed ? 'from pll1_q_ck' : 'from per_ck (HSI)', bad: !isFinite(k.kernel) },
      { id: 'sck', k: '÷ MBR → SCK (Serial Clock)', v: fmtMHz(k.sck), d: `÷${k.div} → ${state.mcu.pins.sck.pin}`, out: true, bad: !isFinite(k.sck) || k.sck > s.maxSck },
    ];
    $('#clock-chain').innerHTML = nodes.map((n, i) => `
      ${i ? '<span class="arrow" aria-hidden="true">→</span>' : ''}
      <div class="node ${n.bad ? 'bad' : ''} ${n.out ? 'out' : ''} ${animate && prevChain[n.id] !== n.v ? 'pulse' : ''}" ${!pllUsed && i > 0 && i < 4 ? 'style="opacity:.45"' : ''}>
        <div class="k">${n.k}</div><div class="v">${n.v}</div><div class="d">${n.d}</div>
      </div>`).join('');
    prevChain = Object.fromEntries(nodes.map((n) => [n.id, n.v]));

    // Meter: SCK against the sensor limit, scale = 2 × limit
    const pct = isFinite(k.sck) ? Math.min(100, (k.sck / (2 * s.maxSck)) * 100) : 0;
    const color = !isFinite(k.sck) ? 'var(--sig-z)' : k.sck > s.maxSck ? 'var(--bad)' : 'var(--ok)';
    $('#sck-meter').innerHTML = `
      <div class="meter">
        <div style="font-size:.9rem;margin-bottom:4px"><strong>SCK = ${fmtMHz(k.sck)}</strong>. The ${s.name} accepts at most <strong>${s.maxSck} MHz</strong>.</div>
        <div class="bar"><div class="fill" style="width:${pct}%;background:${color}"></div><div class="limit" style="left:50%"></div></div>
        <div class="scale"><span>0</span><span>${s.maxSck} MHz limit</span><span>${2 * s.maxSck} MHz</span></div>
      </div>`;

    const notes = [];
    k.errors.forEach((e) => notes.push(`<div class="note bad"><strong>PLL:</strong> ${e}${pllUsed ? '' : ' (SPI is on per_ck right now, so this does not affect SCK. But the CPU uses PLL1 too.)'}</div>`));
    if (isFinite(k.sck) && k.sck > s.maxSck) notes.push(`<div class="note bad"><strong>Too fast:</strong> above ${s.maxSck} MHz the ${s.name}'s output cannot follow. Make the prescaler bigger.</div>`);
    else if (isFinite(k.sck) && k.sck < 0.1) notes.push(`<div class="note warn"><strong>Very slow:</strong> this works, but each read takes ${(16 / k.sck).toFixed(0)} µs.</div>`);
    else if (isFinite(k.sck)) notes.push(`<div class="note ok"><strong>OK:</strong> one bit every ${(1000 / k.sck).toFixed(0)} ns. The 16-bit read takes ${(16 / k.sck).toFixed(2)} µs.</div>`);
    if (isFinite(k.sck)) {
      const kb = (k.sck * 1000) / 8; // kByte/s
      notes.push(`<div class="note info"><strong>The kernel clock is not SCK, and MHz is not MB/s.</strong> The kernel clock (${fmtMHz(k.kernel)}) only feeds the SPI block. SCK = kernel ÷ MBR, and the smallest divider is ÷2, so the fastest SCK here would be <strong>${fmtMHz(k.kernel / 2)}</strong>. One SCK period moves <strong>one bit</strong> in each direction at the same time (MOSI out, MISO in). Now: SCK ${fmtMHz(k.sck)} → ${+k.sck.toFixed(3)} Mbit/s = ${kb >= 1000 ? `${+(kb / 1000).toFixed(2)} MByte/s` : `${+kb.toFixed(1)} kByte/s`} each way (8 bits = 1 byte). Even at ${fmtMHz(k.kernel / 2)} that is only ${+(k.kernel / 16).toFixed(2)} MByte/s, not ${+k.kernel.toFixed(0)} MB/s.</div>`);
      notes.push(`<div class="note info"><strong>Two microcontrollers, both with a ${fmtMHz(k.kernel)} kernel clock?</strong> There is still only <strong>one</strong> SCK on the bus: the master makes it, and the slave just follows its edges. It needs no matching clock of its own. The speed is set by the slowest part: the master (kernel ÷ 2), the slave's maximum SCK in slave mode (from its datasheet), and the wires (jumper wires stop working cleanly long before 50 MHz). Gaps between bytes and CS handling reduce the real throughput further.</div>`);
    }
    notes.push(`<div class="note info"><strong>Two clocks, two jobs:</strong> the bus clock (APB2, Advanced Peripheral Bus 2, switched on by <code>__HAL_RCC_SPI1_CLK_ENABLE()</code>) lets the CPU read and write the SPI registers. The <em>kernel clock</em> above is what gets divided into SCK. Without the first, SPI1 is deaf. Without the second, it has nothing to send.</div>`);
    $('#clock-notes').innerHTML = notes.join('');
  }

  // ---------------------------------------------------------------- 3.4 mode

  function modeMiniSvg(m) {
    const cpol = cpolOf(m), cpha = cphaOf(m);
    const yHi = 12, yLo = 36, x0 = 6, w = 32;
    const lvl = (v) => (v ? yHi : yLo);
    const idle = cpol, act = 1 - cpol;
    const seq = [idle];
    for (let i = 0; i < 3; i++) seq.push(...(cpha ? [act, idle] : [idle, act]));
    seq.push(idle);
    // every entry is half a clock period wide
    let d = `M${x0} ${lvl(seq[0])}`;
    let x = x0;
    for (let i = 0; i < seq.length; i++) {
      if (i && seq[i] !== seq[i - 1]) d += ` L${x} ${lvl(seq[i])}`;
      x += w / 2;
      d += ` L${x} ${lvl(seq[i])}`;
    }
    // sample points: middle of each bit period
    let dots = '';
    for (let i = 0; i < 3; i++) {
      const sx = x0 + w / 2 + i * w + w / 2;
      dots += `<line x1="${sx}" y1="4" x2="${sx}" y2="44" class="sample"/><circle cx="${sx}" cy="24" r="3.5" class="fill-mosi"/>`;
    }
    return `<svg viewBox="0 0 ${x0 * 2 + w * 4} 48" aria-hidden="true"><path d="${d}" fill="none" class="sig-sck" stroke-width="2.5"/>${dots}</svg>`;
  }

  function renderMode() {
    const s = state.sensor;
    $('#mode-list').innerHTML = [0, 1, 2, 3].map((m) => {
      const c = modeCompat(s, m);
      const badge = c === 'ok' ? `<span class="badge ok">${s.name}: supported</span>` : c === 'warn' ? '<span class="badge warn">reads the bits, but not in the datasheet</span>' : '<span class="badge bad">reads on the wrong edge</span>';
      return `<button class="mode-btn ${state.mode === m ? 'selected' : ''}" data-mode="${m}">
        <div class="t">Mode ${m}</div>
        <div class="s">CPOL = ${cpolOf(m)} (idle ${cpolOf(m) ? 'high' : 'low'}) · CPHA = ${cphaOf(m)} (${cphaOf(m) ? '2nd' : '1st'} edge)</div>
        ${modeMiniSvg(m)}
        <div class="s">The master reads on the <strong>${sampleEdge(m)}</strong> edge (orange dots)</div>
        ${badge}
      </button>`;
    }).join('');

    const c = modeCompat(s, state.mode);
    $('#mode-notes').innerHTML = c === 'ok'
      ? `<div class="note ok"><strong>Match:</strong> mode ${state.mode} is in the ${s.name} datasheet. Both sides read on the ${sampleEdge(state.mode)} edge and change the data on the ${other(sampleEdge(state.mode))} edge, so each bit has half a clock period to settle.</div>`
      : c === 'warn'
        ? `<div class="note warn"><strong>Risky:</strong> the bits are read on the right edge, but the clock idles at the wrong level. The datasheet only allows mode ${s.modes.join(' or ')}.</div>`
        : `<div class="note bad"><strong>Mismatch:</strong> the master reads on the <em>falling</em> edge and the ${s.name} on the <em>rising</em> edge. One side always looks at the line exactly when the other side changes it. Watch what happens in 3.5 and 3.6.</div>`;
  }

  $('#mode-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    state.mode = +b.dataset.mode;
    an.step = 0; an.shown = 0;
    renderMode();
    refreshSim(false);
  });

  // ---------------------------------------------------------------- 3.6 transfer: animated scene

  let sim = null, events = [], stops = [];
  const anim = { u: 0, playing: false, last: 0, raf: 0, stepMode: false, dwellUntil: 0, recorded: false };

  // Scene geometry (viewBox 1000 × 440)
  const WY = { cs: 140, sck: 185, mosi: 230, miso: 275 };
  const PIN_M = 320, PIN_S = 680;
  const ROW_Y = { top: 326, bottom: 386 };
  const cellX = (side, k) => (side === 'm' ? 40 : 700) + k * 34;

  function wireSvg(arr, y, cls, xa, xb, u, delay) {
    const c = Math.min(UEND - 1, Math.floor(u));
    const cur = arr[c], prev = c > 0 ? arr[c - 1] : cur;
    // A new level travels from the driver to the receiver
    const f = prev === cur ? 1 : clamp01((u - c - delay) / 0.3);
    const fx = lerp(xa, xb, f);
    const ly = (v) => (v === 'z' ? y : v ? y - 10 : y + 10);
    const seg = (v, x1, x2) => Math.abs(x1 - x2) < 0.5 ? '' : v === 'z'
      ? `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" class="sig-z" stroke-width="2.5"/>`
      : `<line x1="${x1}" y1="${ly(v)}" x2="${x2}" y2="${ly(v)}" class="${cls}" stroke-width="3.5"/>`;
    let o = seg(cur, xa, fx) + seg(prev, fx, xb);
    if (f > 0 && f < 1 && cur !== 'z' && prev !== 'z') o += `<line x1="${fx}" y1="${ly(cur)}" x2="${fx}" y2="${ly(prev)}" class="${cls}" stroke-width="3.5"/>`;
    return o;
  }

  const token = (x, y, v, kind) =>
    `<circle cx="${x}" cy="${y}" r="11" class="fill-${kind}"/><text x="${x}" y="${y + 4.5}" text-anchor="middle" font-size="13" font-weight="700" class="tw mono">${v}</text>`;

  const cell = (x, y, txt, cls) =>
    `<rect x="${x}" y="${y}" width="30" height="26" rx="4" class="cell ${cls}"/>` +
    (txt === '' ? '' : `<text x="${x + 15}" y="${y + 18}" text-anchor="middle" font-size="13" font-weight="700" class="mono ${/on-|bad|z/.test(cls) && !/gone/.test(cls) ? 'tw' : 'muted'}">${txt}</text>`);

  function flash(x, y, t, race, label) {
    const a = 1 - t / 0.6;
    return `<circle cx="${x}" cy="${y}" r="${14 + t * 22}" fill="none" stroke-width="3" class="${race ? 'stroke-bad' : 'sig-sck'}" opacity="${a}"/>` +
      `<text x="${x}" y="${y + 34}" text-anchor="middle" font-size="12" font-weight="700" class="${race ? 'tc-bad' : 'tc-sck'}" opacity="${Math.min(1, a * 1.6)}">${label}</text>`;
  }

  function masterStatus(u) {
    const r = sim;
    if (u < CS_LOW) return 'Idle';
    if (u < 3) return r.cs === 'off' ? 'Should pull CS low…' : 'Pulls CS low';
    if (!r.masterReads) return u < CS_HIGH ? 'SPI1 is not running…' : 'HAL_TIMEOUT';
    if (u < T0) return 'Loads tx[0]';
    if (u < T0 + 32) return `Clocking bit ${Math.floor((u - T0) / 2) + 1} of 16`;
    if (u < CS_HIGH) return 'All 16 bits done';
    return `Done: rx[1] = ${hex(r.rx[1])}`;
  }

  function sensorStatus(u) {
    const r = sim;
    if (u < CS_LOW || r.cs === 'off') return 'Not selected: ignoring the bus';
    if (u >= CS_HIGH) return 'Released MISO, idle again';
    if (r.sck === 'off') return 'Selected, waiting for a clock…';
    if (r.decodeU === null || u < r.decodeU) return 'Listening: receiving the command';
    if (!r.decoded.read) return `Write to ${hex(r.decoded.reg)}: no answer`;
    return `Answering with ${hex(r.out)}`;
  }

  function sceneSvg(u) {
    const r = sim, s = state.sensor, m = state.mcu, w = r.wave, clk = clockCalc();
    const c = Math.min(UEND - 1, Math.floor(u));
    let o = '<svg viewBox="0 0 1000 560" role="img" aria-label="Animated SPI transfer between the STM32 and the sensor">';

    // Chips
    o += `<rect class="box" x="20" y="20" width="300" height="405" rx="10"/><rect class="box" x="680" y="20" width="300" height="405" rx="10"/>`;
    o += `<text x="36" y="50" font-size="18" font-weight="700">${m.name}</text><text x="36" y="70" font-size="13" class="muted">master · ${m.spi}, mode ${state.mode}, SCK ${fmtMHz(clk.sck)}</text>`;
    o += `<text x="696" y="50" font-size="18" font-weight="700">${s.name}</text><text x="696" y="70" font-size="13" class="muted">slave · mode ${s.modes.join('/')}, max ${s.maxSck} MHz</text>`;
    o += `<text x="36" y="100" font-size="14" font-weight="600">▸ ${masterStatus(u)}</text>`;
    o += `<text x="696" y="100" font-size="14" font-weight="600">▸ ${sensorStatus(u)}</text>`;

    // Pins
    for (const k of ['cs', 'sck', 'mosi', 'miso']) {
      o += `<text x="308" y="${WY[k] + 5}" text-anchor="end" font-size="12.5" class="mono"><tspan class="muted">${m.pins[k].pin}</tspan> <tspan font-weight="700" class="tc-${k}">${k.toUpperCase()}</tspan></text>`;
      o += `<text x="692" y="${WY[k] + 5}" font-size="12.5" font-weight="700" class="mono tc-${k}">${s.pinNames[k]}</text>`;
    }

    // Wires: a level of 1 sits above the wire, 0 below, high-Z on it (dashed)
    o += wireSvg(w.cs, WY.cs, 'sig-cs', PIN_M, PIN_S, u, 0);
    o += wireSvg(w.sck, WY.sck, 'sig-sck', PIN_M, PIN_S, u, 0);
    o += wireSvg(w.mosi, WY.mosi, 'sig-mosi', PIN_M, PIN_S, u, 0.3);
    const broken = state.faults.has('miso');
    if (broken) {
      o += wireSvg(w.sensorMiso, WY.miso, 'sig-miso', PIN_S, 520, u, 0.3);
      o += `<line x1="${PIN_M}" y1="${WY.miso}" x2="480" y2="${WY.miso}" class="sig-z" stroke-width="2.5"/>`;
      o += `<path d="M492 ${WY.miso - 8} l16 16 M508 ${WY.miso - 8} l-16 16" class="stroke-bad" stroke-width="3"/>`;
    } else {
      o += wireSvg(w.miso, WY.miso, 'sig-miso', PIN_S, PIN_M, u, 0.3);
    }

    // Wire labels
    const lt = (v) => (v === 'z' ? 'released (high-Z)' : v ? '1 (HIGH)' : '0 (LOW)');
    const lab = (k, txt, extra = '') => `<text x="500" y="${WY[k] - 18}" text-anchor="middle" font-size="12.5" class="tc-${k}" ${extra}>${txt}</text>`;
    o += lab('cs', w.cs[c] ? 'CS HIGH · sensor not selected' : 'CS LOW · sensor selected');
    const e = edgeAt(w.sck, c);
    if (e && u - c < 0.6) {
      o += `<line x1="${PIN_M}" y1="${WY.sck + (w.sck[c] ? -10 : 10)}" x2="${PIN_S}" y2="${WY.sck + (w.sck[c] ? -10 : 10)}" class="sig-sck" stroke-width="10" opacity="${0.35 * (1 - (u - c) / 0.6)}"/>`;
      o += lab('sck', e === 'rising' ? '↑ RISING EDGE' : '↓ FALLING EDGE', 'font-weight="700" font-size="14"');
    } else {
      o += lab('sck', w.sck[c] === 'z' ? 'SCK · no clock' : `SCK ${lt(w.sck[c])}`);
    }
    o += lab('mosi', `MOSI ${lt(w.mosi[c])}`);
    o += lab('miso', `MISO ${lt(broken ? w.sensorMiso[c] : w.miso[c])}`);

    // Who reads, and when
    r.reads.forEach((x, i) => {
      if (u >= x.u && u < x.u + 0.6) o += flash(PIN_S - 14, WY.mosi, u - x.u, x.race, x.race ? 'READ · line is changing!' : i < 8 ? 'READ' : 'READ (ignored)');
    });
    if (r.masterReads) for (let i = 0; i < 16; i++) {
      const mu = bitMid(i);
      if (u >= mu && u < mu + 0.6) o += flash(PIN_M + 14, WY.miso, u - mu, r.outFalls.includes(mu), r.outFalls.includes(mu) ? 'READ · line is changing!' : 'READ');
    }

    // Registers
    const txB = u >= bitStart(8) ? 1 : 0;
    o += `<text x="40" y="${ROW_Y.top - 8}" font-size="12.5" font-weight="600">TX register${u >= 3 && r.masterReads ? `: tx[${txB}] = ${hex(r.tx[txB])}${txB ? ' (dummy)' : ''}` : ''}</text>`;
    for (let k = 0; k < 8; k++) {
      if (u < 3 || !r.masterReads) { o += cell(cellX('m', k), ROW_Y.top, '', ''); continue; }
      const v = (r.tx[txB] >> (7 - k)) & 1;
      o += cell(cellX('m', k), ROW_Y.top, v, u >= bitStart(txB * 8 + k) + 0.3 ? 'gone' : 'on-mosi');
    }
    const nRx = r.masterReads ? [...Array(16).keys()].filter((i) => u >= bitMid(i) + 0.5).length : 0;
    const rxB = nRx > 8 ? 1 : 0;
    let rxLab = `RX register: rx[${rxB}]`;
    if (rxB === 0 && nRx === 8) rxLab += ` = ${hex(r.rx[0])} (junk)`;
    if (rxB === 1) rxLab += `${nRx === 16 ? ` = ${hex(r.rx[1])}` : ''} · rx[0] was ${hex(r.rx[0])}`;
    o += `<text x="40" y="${ROW_Y.bottom - 8}" font-size="12.5" font-weight="600">${rxLab}</text>`;
    for (let k = 0; k < 8; k++) {
      const i = rxB * 8 + k;
      if (i >= nRx) { o += cell(cellX('m', k), ROW_Y.bottom, '', ''); continue; }
      const v = r.misoBits[i];
      o += cell(cellX('m', k), ROW_Y.bottom, v === 'z' ? 1 : v, r.flipped[i] ? 'bad' : v === 'z' ? 'z' : 'on-miso');
    }
    const ins = r.reads.slice(0, 8);
    const nIn = ins.filter((x) => u >= x.u + 0.5).length;
    const decoded = r.decodeU !== null && u >= r.decodeU;
    o += `<text x="700" y="${ROW_Y.top - 8}" font-size="12.5" font-weight="600">IN: command${decoded ? ` = ${hex(r.got)} → ${r.decoded.read ? 'READ' : 'WRITE'} ${hex(r.decoded.reg)}` : ''}</text>`;
    for (let k = 0; k < 8; k++) {
      o += k < nIn ? cell(cellX('s', k), ROW_Y.top, ins[k].v, ins[k].race ? 'bad' : 'on-mosi') : cell(cellX('s', k), ROW_Y.top, '', '');
    }
    const showOut = decoded && r.out !== null;
    o += `<text x="700" y="${ROW_Y.bottom - 8}" font-size="12.5" font-weight="600">OUT: answer${showOut ? ` = ${hex(r.out)}` : ''}</text>`;
    for (let k = 0; k < 8; k++) {
      if (!showOut) { o += cell(cellX('s', k), ROW_Y.bottom, '', ''); continue; }
      const gone = r.outFalls[k] !== undefined && u >= r.outFalls[k] + 0.3;
      o += cell(cellX('s', k), ROW_Y.bottom, (r.out >> (7 - k)) & 1, gone ? 'gone' : 'on-miso');
    }

    // Moving bits. MOSI: TX register → pin → wire, parked at the sensor pin until read.
    if (r.mosi === 'run') for (let i = 0; i < 16; i++) {
      const st = bitStart(i), t = u - st;
      if (t < 0 || t >= 2) continue;
      const rd = r.reads.find((x) => x.u >= st + 0.6 && x.u < st + 2);
      if (u >= (rd ? rd.u : st + 2)) continue;
      const v = w.mosi[st], k = i & 7, ly = WY.mosi + (v ? -10 : 10);
      if (t < 0.3) o += token(lerp(cellX('m', k) + 15, PIN_M, t / 0.3), lerp(ROW_Y.top + 13, ly, t / 0.3), v, 'mosi');
      else o += token(lerp(PIN_M + 16, PIN_S - 16, clamp01((t - 0.3) / 0.3)), ly, v, 'mosi');
    }
    // Sensor read: pin → IN register
    ins.forEach((x, k) => {
      const t = u - x.u;
      if (t >= 0 && t < 0.5) o += token(lerp(PIN_S - 16, cellX('s', k) + 15, t / 0.5), lerp(WY.mosi, ROW_Y.top + 13, t / 0.5), x.v, x.race ? 'bad' : 'mosi');
    });
    // MISO: OUT register → pin → wire, parked at the MCU pin until read
    r.outFalls.forEach((uf, k) => {
      const t = u - uf, next = r.outFalls[k + 1] ?? CS_HIGH;
      const mr = [...Array(16).keys()].map(bitMid).find((mu) => mu >= uf + 0.6 && mu < next);
      if (t < 0 || u >= (mr ?? next)) return;
      const v = (r.out >> (7 - k)) & 1, ly = WY.miso + (v ? -10 : 10);
      if (t < 0.3) o += token(lerp(cellX('s', k) + 15, PIN_S, t / 0.3), lerp(ROW_Y.bottom + 13, ly, t / 0.3), v, 'miso');
      else o += token(lerp(PIN_S - 16, broken ? 530 : PIN_M + 16, clamp01((t - 0.3) / 0.3)), ly, v, 'miso');
    });
    // Master read: pin → RX register
    if (r.masterReads) for (let i = 0; i < 16; i++) {
      const t = u - bitMid(i);
      if (t < 0 || t >= 0.5) continue;
      const v = r.misoBits[i];
      o += token(lerp(PIN_M + 16, cellX('m', i & 7) + 15, t / 0.5), lerp(WY.miso, ROW_Y.bottom + 13, t / 0.5), v === 'z' ? 1 : v, r.flipped[i] ? 'bad' : v === 'z' ? 'z' : 'miso');
    }
    // Point from the step popup (top centre at y = 53.5 % of 560) to where it happens
    const fo = currentEvent().focus;
    if (fo) o += `<line x1="500" y1="300" x2="${fo.x}" y2="${fo.y}" class="focus-line"/><circle cx="${fo.x}" cy="${fo.y}" r="20" class="focus-ring"/>`;
    return o + '</svg>';
  }

  // ---------------------------------------------------------------- 3.6 transfer: oscilloscope

  const X0 = 86, UW = 24;
  const X = (u) => X0 + u * UW;
  const ROWS = { cs: 52, sck: 108, mosi: 164, miso: 220 };
  const AMP = 14;

  function wavePaths(arr, yc) {
    let solid = '', dashed = '';
    const y = (v) => (v ? yc - AMP : yc + AMP);
    for (let u = 0; u < arr.length; u++) {
      const v = arr[u], p = arr[u - 1];
      if (v === 'z') { dashed += `M${X(u)} ${yc} L${X(u + 1)} ${yc} `; continue; }
      if (u === 0 || p === 'z') solid += `M${X(u)} ${y(v)} `;
      else if (p !== v) solid += `L${X(u)} ${y(v)} `;
      solid += `L${X(u + 1)} ${y(v)} `;
    }
    return { solid, dashed };
  }

  function renderScope() {
    const r = sim, w = r.wave;
    const W = X(UEND) + 14;
    let o = `<svg viewBox="0 0 ${W} 250" role="img" aria-label="Oscilloscope view of the SPI transfer">`;
    o += `<defs><clipPath id="reveal"><rect id="reveal-rect" x="0" y="0" width="0" height="250"/></clipPath></defs>`;
    const phase = (a, b, t) => `<rect x="${X(a)}" y="6" width="${(b - a) * UW - 2}" height="22" rx="4" class="box"/><text x="${X((a + b) / 2)}" y="21" text-anchor="middle" font-size="11.5">${t}</text>`;
    o += phase(0, CS_LOW, 'idle') + phase(CS_LOW, T0, 'CS ↓') + phase(T0, bitStart(8), `byte 1: command ${hex(r.tx[0])}`) +
      phase(bitStart(8), T0 + 32, 'byte 2: dummy 0x00 out, answer in') + phase(T0 + 32, UEND, 'CS ↑');
    for (const [k, n] of [['cs', 'CS'], ['sck', 'SCK'], ['mosi', 'MOSI'], ['miso', 'MISO']]) {
      o += `<text x="10" y="${ROWS[k] + 5}" font-weight="700" font-size="14" class="mono tc-${k}">${n}</text>`;
    }
    o += '<g clip-path="url(#reveal)">';
    for (let i = 0; i < 16; i++) o += `<line x1="${X(bitMid(i))}" y1="34" x2="${X(bitMid(i))}" y2="244" class="sample"/>`;
    for (const k of ['cs', 'sck', 'mosi', 'miso']) {
      const { solid, dashed } = wavePaths(w[k], ROWS[k]);
      if (dashed) o += `<path d="${dashed}" fill="none" class="sig-z" stroke-width="2"/>`;
      if (solid) o += `<path d="${solid}" fill="none" class="sig-${k}" stroke-width="2.5"/>`;
    }
    for (let i = 0; i < 16; i++) {
      const xm = X(bitMid(i)), vm = w.mosi[bitStart(i)], vs = w.miso[bitStart(i)];
      if (vm !== 'z') o += `<text x="${xm}" y="${ROWS.mosi - AMP - 5}" text-anchor="middle" font-size="11" class="mono muted">${vm}</text>`;
      if (vs !== 'z') o += `<text x="${xm}" y="${ROWS.miso - AMP - 5}" text-anchor="middle" font-size="11" class="mono muted">${vs}</text>`;
    }
    r.reads.forEach((x) => { o += `<circle cx="${X(x.u)}" cy="${ROWS.mosi}" r="${x.race ? 5 : 4}" class="${x.race ? 'fill-bad' : 'fill-mosi'}"/>`; });
    if (r.masterReads) for (let i = 0; i < 16; i++) {
      const race = r.outFalls.includes(bitMid(i));
      o += `<circle cx="${X(bitMid(i))}" cy="${ROWS.miso}" r="${race ? 5 : 4}" class="${race ? 'fill-bad' : 'fill-miso'}"/>`;
    }
    o += '</g>';
    o += `<line id="cursor" class="cursor" x1="0" y1="34" x2="0" y2="244"/>`;
    $('#timing-svg').innerHTML = o + '</svg>';
  }

  // ---------------------------------------------------------------- 3.6 transfer: playback

  const SPEEDS = {
    slow: { u: 1.2, dwell: (ev) => 1500 + ev.text.length * 30 },
    normal: { u: 2.5, dwell: (ev) => 700 + ev.text.length * 14 },
    fast: { u: 8, dwell: () => 0 },
  };

  function currentEvent() {
    let ev = events[0];
    for (const e of events) if (e.u <= anim.u + 1e-6) ev = e;
    return ev;
  }

  function draw() {
    $('#scene').innerHTML = sceneSvg(anim.u);
    const rect = $('#reveal-rect');
    if (rect) rect.setAttribute('width', X(anim.u));
    const cur = $('#cursor');
    if (cur) { cur.setAttribute('x1', X(anim.u)); cur.setAttribute('x2', X(anim.u)); }
    // The popup is only rebuilt when the step changes, so its buttons stay clickable
    const ev = currentEvent(), idx = events.indexOf(ev);
    if (anim.popKey !== idx) {
      anim.popKey = idx;
      const last = idx === events.length - 1;
      $('#popup').innerHTML = `<div class="stepno">Step ${idx + 1} of ${events.length}</div><div class="title">${ev.title}</div><div>${ev.text}</div>
        <div class="nav"><button data-pop="back" ${idx === 0 ? 'disabled' : ''}>◀ Back</button>${last
          ? '<button data-pop="replay" class="primary">↻ Start again</button>'
          : '<button data-pop="next" class="primary">Next ▶</button>'}</div>`;
    }
    $('#btn-play').textContent = anim.playing && !anim.stepMode ? '❚❚ Pause' : '▶ Auto-play';
    renderResult(anim.u >= UEND - 1);
  }

  function nextStop() {
    const s = stops.find((x) => x > anim.u + 1e-6);
    return s === undefined ? UEND : s;
  }

  function tick(t) {
    if (!anim.playing) return;
    const dt = (t - anim.last) / 1000;
    anim.last = t;
    if (t < anim.dwellUntil) { anim.raf = requestAnimationFrame(tick); return; }
    const sp = SPEEDS[$('#speed').value];
    const target = nextStop();
    anim.u = Math.min(target, anim.u + dt * sp.u);
    if (anim.u >= target - 1e-9) {
      anim.u = target;
      if (anim.stepMode || target >= UEND) { anim.playing = false; anim.stepMode = false; draw(); return; }
      anim.dwellUntil = t + sp.dwell(currentEvent());
    }
    draw();
    anim.raf = requestAnimationFrame(tick);
  }

  function start(stepMode) {
    cancelAnimationFrame(anim.raf);
    anim.playing = true;
    anim.stepMode = stepMode;
    anim.dwellUntil = 0;
    anim.last = performance.now();
    anim.raf = requestAnimationFrame(tick);
    draw();
  }
  function pause() { anim.playing = false; anim.stepMode = false; cancelAnimationFrame(anim.raf); if (sim) draw(); }
  function restart() { pause(); anim.u = 0; anim.recorded = false; draw(); }

  $('#btn-play').onclick = () => {
    if (anim.playing && !anim.stepMode) return pause();
    if (anim.u >= UEND - 1) restart();
    start(false);
  };
  $('#popup').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pop]');
    if (!b) return;
    if (b.dataset.pop === 'next') start(true);
    else if (b.dataset.pop === 'replay') restart();
    else {
      pause();
      // back to where the previous step's animation ends
      const idx = events.indexOf(currentEvent());
      anim.u = idx > 0 ? Math.min(stops[idx - 1], events[idx].u - 0.01) : 0;
      draw();
    }
  });
  $('#btn-restart').onclick = restart;
  $('#btn-again').onclick = () => { newRead(); start(false); };

  function renderResult(done) {
    const s = state.sensor;
    if (!done) {
      $('#result').innerHTML = '';
      return;
    }
    if (!anim.recorded) { state.history.unshift(sim.rx[1]); state.history = state.history.slice(0, 8); anim.recorded = true; }
    $('#result').innerHTML = `<div class="result">
      <div class="result-head">
        <div><div style="color:var(--muted);font-size:.85rem">rx[1] (the answer)</div><div class="big">${hex(sim.rx[1])}</div></div>
        <div><div style="color:var(--muted);font-size:.85rem">expected</div><div class="big" style="color:var(--muted)">${hex(s.expected)}</div></div>
        <div><div style="color:var(--muted);font-size:.85rem">HAL status</div><div class="big" style="font-size:1.1rem">${sim.hal}</div></div>
      </div>
      <div class="note ${sim.verdict}"><strong>${sim.title}</strong>
        <ul>${sim.lines.map((l) => `<li>${l}</li>`).join('')}</ul>
      </div>
      <div class="history">Last reads: ${state.history.map((v) => `<span class="v">${hex(v)}</span>`).join('')}</div>
    </div>`;
  }

  // ---------------------------------------------------------------- 3.6 faults

  function renderFaults() {
    $('#fault-list').innerHTML = FAULTS.map((f) => `
      <label class="fault ${state.faults.has(f.id) ? 'on' : ''}">
        <input type="checkbox" data-fault="${f.id}" ${state.faults.has(f.id) ? 'checked' : ''}>
        <span><span class="t">${f.t}</span><br><span class="d">${f.d}</span></span>
      </label>`).join('') + `
      <div class="toolbar"><button id="btn-watch" class="primary">▲ Watch it in 3.6</button>
      <span id="fault-quick" style="font-size:.9rem;color:var(--muted)"></span></div>`;
    $('#btn-watch').onclick = () => { $('#transfer').scrollIntoView({ behavior: 'smooth' }); restart(); start(false); };
    $('#fault-quick').innerHTML = `Right now: rx[1] = <strong class="mono">${hex(sim.rx[1])}</strong>, ${sim.hal} → ${sim.verdict === 'ok' ? '✅ correct' : sim.verdict === 'warn' ? '⚠️ lucky' : '❌ wrong'}`;
  }

  $('#fault-list').addEventListener('change', (e) => {
    const id = e.target.dataset.fault;
    if (!id) return;
    if (e.target.checked) state.faults.add(id); else state.faults.delete(id);
    refreshSim(false);
  });

  // ---------------------------------------------------------------- 3.7 code

  function renderCode() {
    const m = state.mcu, s = state.sensor, c = state.clock, k = clockCalc(), f = state.faults;
    const pin = (p) => ({ port: p[1], n: +p.slice(2) });
    const sck = pin(m.pins.sck.pin), miso = pin(m.pins.miso.pin), mosi = pin(m.pins.mosi.pin), cs = pin(m.pins.cs.pin);
    const ports = [...new Set([sck.port, miso.port, mosi.port, cs.port])].sort();
    const cpol = cpolOf(state.mode), cpha = cphaOf(state.mode);
    const out = [];
    const C = (t) => out.push({ t, c: true });
    const P = (t) => out.push({ t });
    const F = (t) => out.push({ t, fault: true });
    const oscName = { hse: 'HSE', hsi: 'HSI', csi: 'CSI' }[c.osc];

    C('/* ---- 1. Clocks ---------------------------------------------------- */');
    C(`/* PLL1 (in SystemClock_Config): ${oscName} ${k.oscF} MHz / M=${c.m} * N=${c.n} / Q=${c.q} = ${k.pllOk ? fmtMHz(k.pllq) : 'invalid'} */`);
    P(`osc.PLL.PLLSource = RCC_PLLSOURCE_${oscName};`);
    P(`osc.PLL.PLLM = ${c.m};`);
    P(`osc.PLL.PLLN = ${c.n};`);
    P(`osc.PLL.PLLQ = ${c.q};`);
    P('');
    C('/* Pick the SPI1 kernel clock: the clock that is divided down to SCK */');
    P('RCC_PeriphCLKInitTypeDef pclk = {0};');
    P('pclk.PeriphClockSelection = RCC_PERIPHCLK_SPI123;');
    P(c.kernel === 'pll1q'
      ? `pclk.Spi123ClockSelection = RCC_SPI123CLKSOURCE_PLL;   /* pll1_q_ck = ${fmtMHz(k.kernel)} */`
      : 'pclk.Spi123ClockSelection = RCC_SPI123CLKSOURCE_CLKP;  /* per_ck = HSI 64 MHz */');
    P('HAL_RCCEx_PeriphCLKConfig(&pclk);');
    P('');
    C('/* Bus clocks: without them the registers ignore every write */');
    if (f.has('rcc')) F('/* __HAL_RCC_SPI1_CLK_ENABLE(); */        /* <-- MISTAKE: forgotten */');
    else P('__HAL_RCC_SPI1_CLK_ENABLE();');
    ports.forEach((p) => P(`__HAL_RCC_GPIO${p}_CLK_ENABLE();`));
    P('');
    C('/* ---- 2. Pins ------------------------------------------------------ */');
    P('GPIO_InitTypeDef g = {0};');
    P('g.Mode      = GPIO_MODE_AF_PP;');
    P('g.Speed     = GPIO_SPEED_FREQ_HIGH;');
    P('g.Alternate = GPIO_AF5_SPI1;');
    if (f.has('af')) F(`/* ${m.pins.sck.pin} never configured: stays in analog mode */  /* <-- MISTAKE */`);
    else P(`g.Pin = GPIO_PIN_${sck.n};  g.Pull = GPIO_NOPULL;  HAL_GPIO_Init(GPIO${sck.port}, &g);  /* ${m.pins.sck.pin} = SCK  */`);
    P(`g.Pin = GPIO_PIN_${miso.n};  g.Pull = GPIO_PULLUP;  HAL_GPIO_Init(GPIO${miso.port}, &g);  /* ${m.pins.miso.pin} = MISO, pull-up: an idle line reads 1 */`);
    P(`g.Pin = GPIO_PIN_${mosi.n};  g.Pull = GPIO_NOPULL;  HAL_GPIO_Init(GPIO${mosi.port}, &g);  /* ${m.pins.mosi.pin} = MOSI */`);
    P('');
    C('/* CS is a plain output that we drive ourselves */');
    P(`HAL_GPIO_WritePin(GPIO${cs.port}, GPIO_PIN_${cs.n}, GPIO_PIN_SET);       /* start deselected */`);
    P(`g.Pin = GPIO_PIN_${cs.n};  g.Mode = GPIO_MODE_OUTPUT_PP;  g.Pull = GPIO_NOPULL;  g.Alternate = 0;`);
    P(`HAL_GPIO_Init(GPIO${cs.port}, &g);                                  /* ${m.pins.cs.pin} = CS */`);
    P('');
    C('/* ---- 3. SPI1 ------------------------------------------------------ */');
    P('hspi1.Instance               = SPI1;');
    P('hspi1.Init.Mode              = SPI_MODE_MASTER;            /* we make the clock */');
    P('hspi1.Init.Direction         = SPI_DIRECTION_2LINES;       /* MOSI + MISO */');
    P('hspi1.Init.DataSize          = SPI_DATASIZE_8BIT;');
    P(`hspi1.Init.CLKPolarity       = SPI_POLARITY_${cpol ? 'HIGH' : 'LOW'};          /* CPOL = ${cpol} */`);
    P(`hspi1.Init.CLKPhase          = SPI_PHASE_${cpha ? '2EDGE' : '1EDGE'};          /* CPHA = ${cpha}  -> mode ${state.mode} */`);
    P('hspi1.Init.NSS               = SPI_NSS_SOFT;               /* CS handled by GPIO */');
    P(`hspi1.Init.BaudRatePrescaler = SPI_BAUDRATEPRESCALER_${k.div};${' '.repeat(Math.max(1, 4 - String(k.div).length))}/* ${fmtMHz(k.kernel)} / ${k.div} = ${fmtMHz(k.sck)} */`);
    P('hspi1.Init.FirstBit          = SPI_FIRSTBIT_MSB;');
    P('hspi1.Init.MasterKeepIOState = SPI_MASTER_KEEP_IO_STATE_ENABLE; /* hold SCK at idle between transfers */');
    P('HAL_SPI_Init(&hspi1);');
    P('');
    C(`/* ---- 4. Read ${s.regName} ----------------------------------------------- */`);
    if (f.has('readbit')) F(`uint8_t tx[2] = { ${hex(sim.cmd)}, 0x00 };   /* <-- MISTAKE: read bit 7 missing */`);
    else P(`uint8_t tx[2] = { ${hex(sim.cmd)}, 0x00 };   /* ${hex(s.reg)} | 0x80 (read), then a dummy byte */`);
    P('uint8_t rx[2] = { 0 };');
    if (f.has('cs')) F(`/* HAL_GPIO_WritePin(GPIO${cs.port}, GPIO_PIN_${cs.n}, GPIO_PIN_RESET); */  /* <-- MISTAKE: never selected */`);
    else P(`HAL_GPIO_WritePin(GPIO${cs.port}, GPIO_PIN_${cs.n}, GPIO_PIN_RESET);   /* CS low: select */`);
    P('HAL_StatusTypeDef st = HAL_SPI_TransmitReceive(&hspi1, tx, rx, 2, 10);');
    P(`HAL_GPIO_WritePin(GPIO${cs.port}, GPIO_PIN_${cs.n}, GPIO_PIN_SET);     /* CS high: release */`);
    C(`/* st = ${sim.hal}, rx[1] = ${hex(sim.rx[1])}, expected ${hex(s.expected)} */`);
    if (f.has('miso')) F('/* Hardware: MISO wire open between the board and the sensor */');

    $('#code-body').innerHTML = out.map((l) => {
      const t = esc(l.t);
      if (l.fault) return `<span class="fault-line">${t}</span>`;
      if (l.c) return `<span class="c">${t}</span>`;
      return t.replace(/(\/\*.*\*\/)/, '<span class="c">$1</span>');
    }).join('\n');
  }

  // ---------------------------------------------------------------- 3.5 one clock cycle up close
  //
  // The first three bits of the command, stretched out. Time runs in half
  // clock periods h: CS falls at h = 1, SCK pulses during [2,3), [4,5), [6,7),
  // CS rises at 7.5. Only the data timing differs between CPHA 0 and 1.

  const AN = { x0: 130, hw: 108, rows: { cs: 100, sck: 180, mosi: 260 }, amp: 18 };
  const ax = (h) => AN.x0 + h * AN.hw;
  const an = { step: 0, shown: 0, raf: 0 };
  const fmtNs = (ns) => (ns >= 1000 ? `${+(ns / 1000).toFixed(2)} µs` : `${+ns.toFixed(1)} ns`);
  // CPHA = 0 puts the first bit just after CS falls; CPHA = 1 on the first edge
  const DATA_H = { 0: [1.15, 3, 5], 1: [2, 4, 6] };

  function anatomySteps() {
    const s = state.sensor, m = state.mode;
    const cpol = cpolOf(m), cpha = cphaOf(m);
    const idle = cpol ? 'HIGH' : 'LOW', act = cpol ? 'LOW' : 'HIGH';
    const lead = cpol ? 'falling' : 'rising', trail = cpol ? 'rising' : 'falling';
    const k = clockCalc(), ok = isFinite(k.sck);
    const half = ok ? fmtNs(500 / k.sck) : 'T/2', T = ok ? fmtNs(1000 / k.sck) : 'T', f = ok ? fmtMHz(k.sck) : 'f';
    const b = [0, 1, 2].map((i) => (sim.tx[0] >> (7 - i)) & 1);
    const readEdge = cpha ? trail : lead;
    const sensorNote = readEdge === sensorReadEdge(s, m)
      ? `The ${s.name} reads it: <b>${b[0]}</b>.`
      : `<span class="bad">But the ${s.name} reads on ${sensorReadEdge(s, m)} edges, not ${readEdge} ones. That is the mismatch from 3.4.</span>`;
    const st = [];
    const S = (to, marks, title, text) => st.push({ to, marks, title, text });

    S(1, [{ span: [0, 1], row: 'cs', label: 'CS HIGH: idle' }], 'Before the transfer',
      `CS is HIGH. SCK rests at its idle level, <b>${idle}</b> (CPOL = ${cpol}). MOSI is not driven. No clock is running: between transfers SPI has no clock at all.`);
    S(1.1, [{ edge: 1, kind: 'cs', label: 'CS ↓' }], 'The master pulls CS LOW',
      'The sensor is now selected and starts watching SCK and MOSI. The clock has not started yet.');
    if (!cpha) {
      S(1.4, [{ edge: 1.15, kind: 'change', label: `MOSI = ${b[0]} · ${idle} half starts` }], 'Data first!',
        `With CPHA = 0 the master puts bit 7 = <b>${b[0]}</b> on MOSI right away, before any clock edge. At the same moment the clock's first ${idle} half starts: SCK stays ${idle} for T/2 = <b>${half}</b>. In this mode the very first edge is already a <b>read</b> edge, so the bit has to be waiting on the wire before that edge comes.`);
      S(2, [{ span: [1.15, 2], row: 'sck', label: `${idle} ${half}` }, { span: [1.15, 2], row: 'mosi', label: 'setup' }], 'Wait half a clock period',
        `For T/2 = <b>${half}</b> nothing happens: SCK stays ${idle} and the bit on MOSI settles. This waiting time is the <b>setup time</b>. The sensor needs only a few nanoseconds (its datasheet says how many); the rest is safety margin.`);
      S(2.1, [{ edge: 2, kind: 'read', label: `${lead} edge: READ` }], `1st edge (${lead}): the bit is read`,
        `SCK jumps from ${idle} to ${act}. At exactly this moment the bit on MOSI is read. ${sensorNote} Before and after this moment, the level on MOSI does not matter.`);
      S(3, [{ span: [2, 3], row: 'sck', label: `${act} ${half}` }, { span: [2, 3], row: 'mosi', label: 'hold' }], `SCK stays ${act} for T/2`,
        `SCK stays ${act} for another <b>${half}</b>. The master keeps MOSI unchanged: the bit has to stay a little after the read edge (<b>hold time</b>).`);
      S(3.4, [{ edge: 3, kind: 'change', label: `${trail} edge: MOSI = ${b[1]}` }], `2nd edge (${trail}): the master changes the bit`,
        `SCK goes back to ${idle}. Now, and only now, the master puts the next bit, bit 6 = <b>${b[1]}</b>, on MOSI${b[1] === b[0] ? ' (the same value as bit 7, so the line does not move)' : ''}. Changing on this edge gives the new bit a full T/2 before the next read edge.`);
      S(3.4, [{ bracket: [1.15, 3], label: `bit 7 = one period T = ${T}` }], 'One bit = one clock period',
        `Bit 7 took one full clock period, T = <b>${T}</b> = 1 / ${f}: first ${idle} for T/2, then ${act} for T/2. Both halves are equal (<b>50 % duty cycle</b>) because the SPI prescaler always divides by an even number. So in mode ${m} every period is <b>"${idle} first, then ${act}"</b>, and the master holds each bit for the whole period, from one ${trail} edge to the next.`);
    } else {
      S(2, [{ span: [1, 2], row: 'sck', label: 'still idle' }], 'Clock first!',
        `With CPHA = 1 nothing is put on MOSI yet, and SCK still rests ${idle}. In this mode the first edge is a <b>change</b> edge, not a read edge, so the master does not need the bit in advance.`);
      S(2.4, [{ edge: 2, kind: 'change', label: `${lead} edge: MOSI = ${b[0]}` }], `1st edge (${lead}): the master puts the bit`,
        `SCK jumps from ${idle} to ${act}, and on this same edge the master puts bit 7 = <b>${b[0]}</b> on MOSI.`);
      S(3, [{ span: [2, 3], row: 'sck', label: `${act} ${half}` }, { span: [2, 3], row: 'mosi', label: 'setup' }], `SCK stays ${act} for T/2`,
        `For T/2 = <b>${half}</b> SCK stays ${act} and the bit settles. This is the <b>setup time</b>.`);
      S(3.1, [{ edge: 3, kind: 'read', label: `${trail} edge: READ` }], `2nd edge (${trail}): the bit is read`,
        `SCK goes back to ${idle}. At exactly this moment the bit on MOSI is read. ${sensorNote}`);
      S(4.4, [{ span: [3, 4], row: 'sck', label: `${idle} ${half}` }, { span: [3, 4], row: 'mosi', label: 'hold' }], `SCK stays ${idle} for T/2`,
        `The master keeps the bit for another T/2 (<b>hold time</b>), until the next ${lead} edge, where it puts bit 6 = <b>${b[1]}</b>${b[1] === b[0] ? ' (the same value, so the line does not move)' : ''}.`);
      S(4.4, [{ bracket: [2, 4], label: `bit 7 = one period T = ${T}` }], 'One bit = one clock period',
        `Bit 7 took one full clock period, T = <b>${T}</b> = 1 / ${f}: first ${act} for T/2, then ${idle} for T/2 (<b>50 % duty cycle</b>). So in mode ${m} every period is <b>"${act} first, then ${idle}"</b>. The bit is put on the ${lead} edge and read on the ${trail} edge.`);
    }
    S(7.6, [{ edge: 7.5, kind: 'cs', label: 'CS ↑' }], 'And the same again, 8 times per byte',
      `The rhythm repeats for every bit: put on one edge, read on the other. A byte takes 8 periods (8 × ${T}). Here we stop after 3 bits. When the transfer ends, SCK stops at its idle level and CS goes HIGH. <b>Unlike PWM, the SPI clock does not run all the time:</b> it only exists while data moves, exactly 8 pulses per byte.`);
    return st;
  }

  function anatomySvg(shown, steps, cur) {
    const cpol = cpolOf(state.mode), cpha = cphaOf(state.mode);
    const idle = cpol, act = 1 - cpol, R = AN.rows, A = AN.amp;
    const b = [0, 1, 2].map((i) => (sim.tx[0] >> (7 - i)) & 1);
    const dh = DATA_H[cpha];
    const segs = {
      cs: [[0, 1], [1, 0], [7.5, 1]],
      sck: [[0, idle], [2, act], [3, idle], [4, act], [5, idle], [6, act], [7, idle]],
      mosi: [[0, 'z'], [dh[0], b[0]], [dh[1], b[1]], [dh[2], b[2]], [7.5, 'z']],
    };
    const y = (row, v) => (v === 'z' ? R[row] : v ? R[row] - A : R[row] + A);
    let o = `<svg viewBox="0 0 1010 380" role="img" aria-label="One SPI clock cycle, step by step">`;
    o += `<defs><clipPath id="an-clip"><rect x="0" y="0" width="${ax(shown) + 2}" height="380"/></clipPath></defs>`;
    for (const [row, n] of [['cs', 'CS'], ['sck', 'SCK'], ['mosi', 'MOSI']]) {
      o += `<text x="20" y="${R[row] + 5}" font-weight="700" font-size="15" class="mono tc-${row}">${n}</text>`;
    }
    // Time axis: half periods, counted from CS falling
    const k = clockCalc(), half = isFinite(k.sck) ? 500 / k.sck : NaN;
    o += `<line x1="${ax(0)}" y1="312" x2="${ax(8)}" y2="312" class="axis"/>`;
    for (let h = 1; h <= 7; h++) {
      o += `<line x1="${ax(h)}" y1="308" x2="${ax(h)}" y2="316" class="axis"/>`;
      o += `<text x="${ax(h)}" y="330" text-anchor="middle" font-size="11.5" class="muted mono">${isFinite(half) ? fmtNs((h - 1) * half) : `${h - 1}·T/2`}</text>`;
    }
    o += `<text x="${ax(0)}" y="330" font-size="11.5" class="muted">time →</text>`;
    // Marks of every step so far stay on the drawing, numbered like the steps;
    // the current one is bold, earlier ones lighter. Edge labels use two lanes
    // so that close edges (CS falling, first bit) do not overlap.
    const NUM = '①②③④⑤⑥⑦⑧⑨⑩';
    steps.slice(0, cur + 1).forEach((st, i) => {
      const now = i === cur, op = now ? 1 : 0.5, n = NUM[i];
      for (const mk of st.marks) {
        if (mk.span) {
          const [h1, h2] = mk.span;
          o += `<rect x="${ax(h1)}" y="${R[mk.row] - A - 10}" width="${ax(h2) - ax(h1)}" height="${2 * A + 20}" rx="4" class="an-span" opacity="${now ? 1 : 0.6}"/>`;
          o += `<text x="${(ax(h1) + ax(h2)) / 2}" y="${mk.row === 'mosi' ? R.mosi + A + 24 : R[mk.row] - A - 16}" text-anchor="middle" font-size="12" font-weight="${now ? 700 : 500}" class="tc-${mk.row}" opacity="${op}">${n} ${mk.label}</text>`;
        } else if (mk.edge !== undefined) {
          const cls = mk.kind === 'read' ? 'ok' : mk.kind === 'cs' ? 'cs' : 'mosi';
          const ly = mk.kind === 'change' ? 46 : 24;
          o += `<line x1="${ax(mk.edge)}" y1="${ly + 6}" x2="${ax(mk.edge)}" y2="300" class="st-${cls}" stroke-width="${now ? 3 : 2}" stroke-dasharray="6 4" opacity="${op}"/>`;
          o += `<text x="${ax(mk.edge)}" y="${ly}" text-anchor="${mk.kind === 'change' ? 'start' : 'middle'}" dx="${mk.kind === 'change' ? -6 : 0}" font-size="12.5" font-weight="${now ? 700 : 500}" class="tc-${cls}" opacity="${op}">${n} ${mk.label}</text>`;
          if (mk.kind === 'read') o += `<circle cx="${ax(mk.edge)}" cy="${y('mosi', b[0])}" r="${now ? 7 : 5}" class="fill-ok" opacity="${op}"/>`;
        } else if (mk.bracket) {
          const [h1, h2] = mk.bracket;
          o += `<path d="M${ax(h1)} 350 v-8 M${ax(h1)} 346 H${ax(h2)} M${ax(h2)} 350 v-8" fill="none" class="st-ok" stroke-width="2" opacity="${op}"/>`;
          o += `<text x="${(ax(h1) + ax(h2)) / 2}" y="368" text-anchor="middle" font-size="13" font-weight="700" class="tc-ok" opacity="${op}">${n} ${mk.label}</text>`;
        }
      }
    });
    // Signals, revealed up to `shown`
    o += '<g clip-path="url(#an-clip)">';
    for (const row of ['cs', 'sck', 'mosi']) {
      let solid = '', dash = '';
      segs[row].forEach(([h, v], i) => {
        const h2 = i + 1 < segs[row].length ? segs[row][i + 1][0] : 8;
        const x1 = ax(h), x2 = ax(h2);
        if (v === 'z') { dash += `M${x1} ${R[row]} L${x2} ${R[row]} `; return; }
        const pv = i ? segs[row][i - 1][1] : 'z';
        solid += pv === 'z' ? `M${x1} ${y(row, v)} ` : `L${x1} ${y(row, v)} `;
        solid += `L${x2} ${y(row, v)} `;
      });
      if (dash) o += `<path d="${dash}" fill="none" class="sig-z" stroke-width="2.5"/>`;
      o += `<path d="${solid}" fill="none" class="sig-${row}" stroke-width="3"/>`;
    }
    // bit values on MOSI
    dh.forEach((h, i) => { o += `<text x="${(ax(h) + ax(i < 2 ? dh[i + 1] : 7.5)) / 2}" y="${R.mosi - A - 6}" text-anchor="middle" font-size="12" class="mono muted">bit ${7 - i} = ${b[i]}</text>`; });
    o += '</g>';
    return o + '</svg>';
  }

  function renderAnatomy(animate) {
    const steps = anatomySteps();
    an.step = Math.min(an.step, steps.length - 1);
    const st = steps[an.step];
    $('#anatomy-modes').innerHTML = 'Show it for: ' + [0, 1, 2, 3].map((m) =>
      `<button data-anmode="${m}" class="${state.mode === m ? 'selected' : ''}">Mode ${m}</button>`).join('');
    const from = an.shown, to = st.to;
    cancelAnimationFrame(an.raf);
    const paint = (h) => { an.shown = h; $('#anatomy-svg').innerHTML = anatomySvg(h, steps, an.step); };
    if (animate && to !== from) {
      const t0 = performance.now(), dur = 300 + Math.abs(to - from) * 250;
      const stepFn = (t) => {
        const p = clamp01((t - t0) / dur);
        paint(lerp(from, to, p));
        if (p < 1) an.raf = requestAnimationFrame(stepFn);
      };
      an.raf = requestAnimationFrame(stepFn);
    } else {
      paint(to);
    }
    const last = an.step === steps.length - 1;
    $('#anatomy-pop').innerHTML = `<div class="stepno">Step ${an.step + 1} of ${steps.length} · mode ${state.mode}</div>
      <div class="title">${st.title}</div><div>${st.text}</div>
      <div class="nav"><button data-an="back" ${an.step === 0 ? 'disabled' : ''}>◀ Back</button>${last
        ? '<button data-an="restart" class="primary">↻ Start again</button>'
        : '<button data-an="next" class="primary">Next ▶</button>'}</div>`;
  }

  $('#anatomy-pop').addEventListener('click', (e) => {
    const b = e.target.closest('[data-an]');
    if (!b) return;
    if (b.dataset.an === 'next') an.step++;
    else if (b.dataset.an === 'back') an.step = Math.max(0, an.step - 1);
    else { an.step = 0; an.shown = 0; }
    renderAnatomy(true);
  });
  $('#anatomy-modes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-anmode]');
    if (!b) return;
    state.mode = +b.dataset.anmode;
    an.step = 0; an.shown = 0;
    renderMode();
    refreshSim(false);
  });

  // ---------------------------------------------------------------- glue

  // A fresh simulated read (random bit errors differ from read to read)
  function newRead() {
    pause();
    sim = simulate();
    events = buildEvents(sim);
    stops = events.map((e, i) => Math.min(e.u + 0.75, i + 1 < events.length ? events[i + 1].u : UEND));
    anim.u = 0;
    anim.recorded = false;
    anim.popKey = null;
    renderScope();
  }

  function refreshSim(autoplay) {
    newRead();
    renderWiring(sim);
    renderFaults();
    renderCode();
    renderAnatomy(false);
    const s = state.sensor;
    $('#transfer-intro').innerHTML = `Goal: read the ${s.name} <strong>${s.regName}</strong> register (${hex(s.reg)}). If everything is right, it returns <strong>${hex(s.expected)}</strong>. Each step opens a popup that points to where it happens. Read it, then press <strong>Next</strong>. On the wires, a <b>1</b> sits above the wire and a <b>0</b> below it. Dashed means nobody drives the wire.`;
    draw();
    if (autoplay) start(false);
  }

  function renderAll() {
    $('#task-line').innerHTML = `${state.mcu.name} (master) reads the ${state.sensor.name} (slave) over ${state.mcu.spi}.`;
    renderWhy();
    renderClockControls();
    renderClockChain(false);
    renderMode();
    refreshSim(false);
  }

  renderChoices();
})();
