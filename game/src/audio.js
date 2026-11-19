// audio.js — all sound in Port Aurelia is synthesized with WebAudio at runtime.
// There are no audio files: an engine hum, a two-tone siren, gunshots, punches,
// crashes, pickups and short mission jingles are built from oscillators and
// filtered noise. The context is created lazily on the first user gesture so
// the browser autoplay policy never blocks the game.

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenTimer = 0;
  let sirenHigh = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    return true;
  }

  function tone(freq, dur, type, vol, slideTo, delay) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + (delay || 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol, filterFreq, delay) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + (delay || 0);
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t0);
  }

  function startEngine() {
    if (!ensure() || engineOsc) return;
    engineOsc = ctx.createOscillator();
    engineGain = ctx.createGain();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 55;
    engineGain.gain.value = 0.0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    engineOsc.connect(filter);
    filter.connect(engineGain);
    engineGain.connect(master);
    engineOsc.start();
  }

  function stopEngine() {
    if (!engineOsc) return;
    try { engineOsc.stop(); } catch (e) { /* already stopped */ }
    engineOsc.disconnect();
    engineGain.disconnect();
    engineOsc = null;
    engineGain = null;
  }

  function startSiren() {
    if (!ensure() || sirenOsc) return;
    sirenOsc = ctx.createOscillator();
    sirenGain = ctx.createGain();
    sirenOsc.type = 'triangle';
    sirenOsc.frequency.value = 660;
    sirenGain.gain.value = 0.0;
    sirenOsc.connect(sirenGain);
    sirenGain.connect(master);
    sirenOsc.start();
  }

  function stopSiren() {
    if (!sirenOsc) return;
    try { sirenOsc.stop(); } catch (e) { /* already stopped */ }
    sirenOsc.disconnect();
    sirenGain.disconnect();
    sirenOsc = null;
    sirenGain = null;
  }

  return {
    unlock() { ensure(); },
    setMuted(value) {
      muted = value;
      if (master && ctx) master.gain.setValueAtTime(muted ? 0 : 0.5, ctx.currentTime);
    },
    isMuted() { return muted; },
    click() { tone(880, 0.06, 'square', 0.08); },
    enterCar() { tone(220, 0.09, 'square', 0.12); tone(330, 0.08, 'square', 0.1, 0, 0.07); },
    gunshot() { noise(0.16, 0.5, 2600); tone(150, 0.1, 'square', 0.2, 40); },
    dryFire() { tone(1200, 0.03, 'square', 0.06); },
    punch() { noise(0.08, 0.3, 500); },
    hurt() { tone(140, 0.15, 'sawtooth', 0.18, 70); },
    crash(strength) { noise(0.25, Math.min(0.6, 0.2 + strength * 0.05), 700); tone(90, 0.2, 'square', 0.15, 40); },
    pickup() { tone(660, 0.09, 'sine', 0.16); tone(990, 0.12, 'sine', 0.16, 0, 0.07); },
    cash() { tone(1180, 0.07, 'square', 0.1); tone(1560, 0.1, 'square', 0.1, 0, 0.06); },
    missionDone() {
      const notes = [523, 659, 784, 1046];
      for (let i = 0; i < notes.length; i++) tone(notes[i], 0.16, 'triangle', 0.2, 0, i * 0.11);
    },
    missionFail() {
      const notes = [392, 330, 262, 196];
      for (let i = 0; i < notes.length; i++) tone(notes[i], 0.18, 'triangle', 0.18, 0, i * 0.12);
    },
    busted() {
      tone(440, 0.3, 'square', 0.14, 220);
      tone(220, 0.5, 'square', 0.14, 110, 0.25);
    },
    /** Called every frame: engine pitch follows speed, siren wails while police are close. */
    update(dt, driving, speedRatio, sirenNear) {
      if (!ctx) return;
      if (driving) {
        startEngine();
        if (engineOsc) {
          const target = 55 + Math.abs(speedRatio) * 130;
          engineOsc.frequency.setTargetAtTime(target, ctx.currentTime, 0.05);
          engineGain.gain.setTargetAtTime(0.05 + Math.abs(speedRatio) * 0.06, ctx.currentTime, 0.08);
        }
      } else if (engineOsc) {
        engineGain.gain.setTargetAtTime(0.0, ctx.currentTime, 0.1);
        if (Math.abs(speedRatio) < 0.01) stopEngine();
      }
      if (sirenNear) {
        startSiren();
        sirenTimer -= dt;
        if (sirenTimer <= 0) {
          sirenTimer = 0.42;
          sirenHigh = !sirenHigh;
          if (sirenOsc) sirenOsc.frequency.setTargetAtTime(sirenHigh ? 880 : 620, ctx.currentTime, 0.03);
        }
        if (sirenGain) sirenGain.gain.setTargetAtTime(0.045, ctx.currentTime, 0.1);
      } else if (sirenOsc) {
        sirenGain.gain.setTargetAtTime(0.0, ctx.currentTime, 0.1);
        stopSiren();
      }
    },
  };
}
