// Tiny synthesised sound effects (no audio files needed).
let ctx = null, noise = null, master = null;
export const audio = { muted: false };

function init() {
  if (ctx) return true;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  } catch (e) { return false; }
}
export function unlockAudio() { if (init() && ctx.state === 'suspended') ctx.resume(); }

function noiseHit({ dur = 0.6, freq = 800, type = 'lowpass', gain = 0.8, q = 1 }) {
  const src = ctx.createBufferSource(); src.buffer = noise;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); const t = ctx.currentTime;
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t, Math.random()); src.stop(t + dur);
  return f;
}
function tone({ freq = 440, to = null, dur = 0.2, type = 'sine', gain = 0.3, delay = 0 }) {
  const o = ctx.createOscillator(); const g = ctx.createGain(); const t = ctx.currentTime + delay;
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
}

export function sfx(name) {
  if (audio.muted || !init()) return;
  switch (name) {
    case 'fire': noiseHit({ dur: 0.35, freq: 1400, gain: 0.5 }); tone({ freq: 160, to: 60, dur: 0.3, type: 'triangle', gain: 0.4 }); break;
    case 'boom': {
      const f = noiseHit({ dur: 1.1, freq: 500, gain: 1 });
      f.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 1);
      tone({ freq: 90, to: 30, dur: 0.8, type: 'sine', gain: 0.7 });
      break;
    }
    case 'splash': noiseHit({ dur: 0.9, freq: 2500, type: 'bandpass', gain: 0.6, q: 0.6 }); break;
    case 'shield': tone({ freq: 600, to: 1800, dur: 0.35, type: 'sawtooth', gain: 0.12 }); tone({ freq: 900, to: 300, dur: 0.5, type: 'sine', gain: 0.2, delay: 0.1 }); break;
    case 'coin': tone({ freq: 988, dur: 0.1, type: 'square', gain: 0.12 }); tone({ freq: 1319, dur: 0.25, type: 'square', gain: 0.12, delay: 0.09 }); break;
    case 'ping': tone({ freq: 1200, dur: 0.6, type: 'sine', gain: 0.25 }); tone({ freq: 1200, dur: 0.6, type: 'sine', gain: 0.1, delay: 0.4 }); break;
    case 'turn': tone({ freq: 523, dur: 0.15, type: 'triangle', gain: 0.25 }); tone({ freq: 784, dur: 0.3, type: 'triangle', gain: 0.25, delay: 0.14 }); break;
    case 'sink': tone({ freq: 300, to: 60, dur: 1.6, type: 'sawtooth', gain: 0.12 }); noiseHit({ dur: 1.5, freq: 300, gain: 0.5 }); break;
    case 'click': tone({ freq: 700, dur: 0.05, type: 'square', gain: 0.06 }); break;
    case 'win': [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.35, type: 'triangle', gain: 0.25, delay: i * 0.15 })); break;
    case 'error': tone({ freq: 200, dur: 0.2, type: 'square', gain: 0.08 }); break;
  }
}
