import type { AudioEngine } from "./engine";

/**
 * Procedural one-shot sounds.
 *
 * Each is a short noise burst or damped tone shaped by a filter — enough to
 * read as felt, plastic or net without a single recorded sample.
 */

export interface ShotOptions {
  /** Centre frequency of the band the noise is pushed through. */
  freq: number;
  /** Filter resonance. Higher rings more, and reads as harder material. */
  q: number;
  /** Seconds to silence. */
  decay: number;
  gain: number;
  /** -1 (left) to 1 (right). */
  pan: number;
  /** Optional damped sine underneath, for weight. */
  body?: number;
}

function schedule(engine: AudioEngine, node: AudioNode, stopAt: number): void {
  const panOut = node;
  panOut.connect(engine.out);
  window.setTimeout(
    () => {
      try {
        panOut.disconnect();
      } catch {
        // Already torn down.
      }
      engine.releaseVoice();
    },
    Math.ceil(stopAt * 1000) + 60,
  );
}

/** A filtered noise burst: the workhorse for every impact. */
export function playImpact(engine: AudioEngine, o: ShotOptions): void {
  if (!engine.takeVoice()) return;
  const { ctx } = engine;
  const now = ctx.currentTime;

  const src = ctx.createBufferSource();
  src.buffer = engine.noise;
  src.loop = true;

  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = o.freq;
  band.Q.value = o.q;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(o.gain, now + 0.002);
  env.gain.exponentialRampToValueAtTime(0.0001, now + o.decay);

  const pan = ctx.createStereoPanner();
  pan.pan.value = Math.max(-1, Math.min(1, o.pan));

  src.connect(band).connect(env).connect(pan);
  schedule(engine, pan, o.decay);

  src.start(now);
  src.stop(now + o.decay + 0.02);

  // A low damped sine under the noise gives the hit weight rather than just
  // brightness — it is what separates a thud from a tick.
  if (o.body && o.body > 0) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(o.freq * 0.28, now);
    osc.frequency.exponentialRampToValueAtTime(o.freq * 0.16, now + o.decay);

    const benv = ctx.createGain();
    benv.gain.setValueAtTime(0, now);
    benv.gain.linearRampToValueAtTime(o.body, now + 0.003);
    benv.gain.exponentialRampToValueAtTime(0.0001, now + o.decay * 0.9);

    osc.connect(benv).connect(pan);
    osc.start(now);
    osc.stop(now + o.decay + 0.02);
  }
}

/** The referee's whistle, for kick-off and goals. */
export function playWhistle(engine: AudioEngine, duration = 0.32): void {
  if (!engine.takeVoice()) return;
  const { ctx } = engine;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(2100, now);

  // The warble is what makes it read as a pea whistle rather than a beep.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 26;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 110;
  lfo.connect(lfoGain).connect(osc.frequency);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(0.18, now + 0.02);
  env.gain.setValueAtTime(0.18, now + duration * 0.7);
  env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(env);
  schedule(engine, env, duration);

  osc.start(now);
  lfo.start(now);
  osc.stop(now + duration + 0.02);
  lfo.stop(now + duration + 0.02);
}
