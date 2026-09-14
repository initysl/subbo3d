/**
 * A small Web Audio engine for one-shot impact sounds.
 *
 * No audio files: everything is synthesised. That keeps the asset pipeline
 * off the critical path exactly as the geometry and textures do, and impact
 * sounds want their pitch and gain driven by the collision impulse anyway,
 * which is raw Web Audio work regardless.
 */

/** Simultaneous voices. Beyond this the oldest is dropped rather than queued. */
const MAX_VOICES = 12;

export interface AudioEngine {
  readonly ctx: AudioContext;
  /** Master gain, so the whole thing can be ducked or muted. */
  readonly out: GainNode;
  /** Shared noise source data, generated once. */
  readonly noise: AudioBuffer;
  /** True if a voice was granted; false if we are at the cap. */
  takeVoice(): boolean;
  releaseVoice(): void;
  setMuted(muted: boolean): void;
  dispose(): void;
}

/**
 * Browsers will not start an AudioContext without a user gesture, so this
 * must be called from inside a pointer handler, not at mount.
 */
export function createAudioEngine(): AudioEngine | null {
  const Ctor =
    typeof window === "undefined"
      ? undefined
      : window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  let ctx: AudioContext;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  void ctx.resume();

  const out = ctx.createGain();
  out.gain.value = 0.7;
  out.connect(ctx.destination);

  // One second of white noise, reused by every percussive sound.
  const frames = Math.floor(ctx.sampleRate);
  const noise = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

  let voices = 0;

  return {
    ctx,
    out,
    noise,
    takeVoice() {
      if (voices >= MAX_VOICES) return false;
      voices++;
      return true;
    },
    releaseVoice() {
      if (voices > 0) voices--;
    },
    setMuted(muted: boolean) {
      out.gain.setTargetAtTime(muted ? 0 : 0.7, ctx.currentTime, 0.02);
    },
    dispose() {
      try {
        out.disconnect();
        void ctx.close();
      } catch {
        // Closing an already-closed context is not worth surfacing.
      }
    },
  };
}
