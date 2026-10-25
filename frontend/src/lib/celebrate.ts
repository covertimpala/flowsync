import confetti from 'canvas-confetti';

const CELEBRATION_COLORS = ['#6c8dfa', '#45c586', '#e3a648', '#c89bf8', '#68d4f5'];

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!audioCtx) audioCtx = new Ctor();
    return audioCtx;
  } catch {
    return null;
  }
}

function playTone(ctx: AudioContext, freq: number, start: number, duration: number, peakGain = 0.25) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peakGain, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/** A short two-note "ding" synthesized with the Web Audio API — no sound
 * file to ship, works offline, and needs no licensing. */
function playCompletionChime() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  playTone(ctx, 880, now, 0.14); // A5
  playTone(ctx, 1318.5, now + 0.08, 0.22, 0.2); // E6, a rising fifth
}

/** Confetti burst from roughly where the completed task's checkbox is,
 * plus a synthesized chime. Call only on the false→true transition, never
 * on uncheck — this is a reward, not a toggle sound. `origin` is in
 * viewport fractions (0–1), from the triggering click/change event. */
export function celebrateTaskCompletion(origin?: { x: number; y: number }) {
  confetti({
    particleCount: 60,
    spread: 70,
    startVelocity: 35,
    gravity: 1.1,
    scalar: 0.9,
    ticks: 160,
    origin: origin ?? { x: 0.5, y: 0.6 },
    colors: CELEBRATION_COLORS,
  });
  playCompletionChime();
}
