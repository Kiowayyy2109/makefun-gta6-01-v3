// Port Aurelia — all sound is synthesized with WebAudio at play time.
// No audio files exist; every effect is an oscillator, a filtered noise
// burst or a short envelope, so the game stays fully offline and self-made.

export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenTimer = 0;
  let muted = false;

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch { ctx = null; }
    return !!ctx;
  }

  function tone(freq, dur, type, vol, slideTo, delay = 0) {
    if (!ensure() || muted) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain); gain.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol, freq, delay = 0) {
    if (!ensure() || muted) return;
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buffer;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = freq || 1200;
    const gain = ctx.createGain(); gain.gain.value = vol;
    src.connect(filter); filter.connect(gain); gain.connect(master);
    src.start(t0);
  }

  function startEngine() {
    if (!ensure() || engineOsc) return;
    engineOsc = ctx.createOscillator(); engineOsc.type = 'sawtooth'; engineOsc.frequency.value = 55;
    engineGain = ctx.createGain(); engineGain.gain.value = 0.0;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 420;
    engineOsc.connect(filter); filter.connect(engineGain); engineGain.connect(master);
    engineOsc.start();
  }
  function setEngine(speedRatio, dt) {
    if (!engineOsc) return;
    const target = Math.min(0.16, 0.03 + Math.abs(speedRatio) * 0.13);
    engineGain.gain.value += (target - engineGain.gain.value) * Math.min(1, dt * 6);
    engineOsc.frequency.value = 50 + Math.abs(speedRatio) * 130;
  }
  function stopEngine() {
    if (!engineOsc) return;
    try { engineOsc.stop(); } catch { /* already stopped */ }
    engineOsc = null; engineGain = null;
  }

  function updateSiren(active, dt) {
    if (active && !sirenOsc && ensure() && !muted) {
      sirenOsc = ctx.createOscillator(); sirenOsc.type = 'triangle'; sirenOsc.frequency.value = 700;
      sirenGain = ctx.createGain(); sirenGain.gain.value = 0.035;
      sirenOsc.connect(sirenGain); sirenGain.connect(master); sirenOsc.start();
    }
    if (sirenOsc) {
      sirenTimer += dt;
      sirenOsc.frequency.value = (sirenTimer % 0.9) < 0.45 ? 700 : 950;
      if (!active) { try { sirenOsc.stop(); } catch { /* noop */ } sirenOsc = null; sirenGain = null; }
    }
  }

  return {
    unlock() { ensure(); },
    setMuted(value) { muted = value; if (muted) { stopEngine(); updateSiren(false, 0); } },
    isMuted() { return muted; },
    gunshot() { noise(0.16, 0.5, 2600); tone(120, 0.1, 'square', 0.2, 40); },
    melee() { noise(0.09, 0.3, 700); },
    crash() { noise(0.28, 0.45, 500); tone(70, 0.25, 'sine', 0.3, 30); },
    pickup() { tone(660, 0.09, 'sine', 0.22); tone(990, 0.14, 'sine', 0.22, null, 0.07); },
    cash() { tone(880, 0.08, 'triangle', 0.2); tone(1320, 0.16, 'triangle', 0.2, null, 0.06); },
    checkpoint() { tone(520, 0.08, 'square', 0.12); tone(780, 0.12, 'square', 0.12, null, 0.07); },
    jingle() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.22, null, i * 0.11)); },
    fail() { tone(300, 0.3, 'sawtooth', 0.16, 140); },
    busted() { [392, 330, 262].forEach((f, i) => tone(f, 0.25, 'triangle', 0.2, null, i * 0.16)); },
    enterCar() { noise(0.07, 0.2, 900); tone(180, 0.08, 'sine', 0.12, 90, 0.05); },
    startEngine, setEngine, stopEngine, updateSiren,
  };
}
