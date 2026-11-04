/**
 * Booth audio (plan D12). The call voice is a synthetic placeholder until a teammate's recording
 * is added (public/audio/voice.ogg, TODO in PROGRESS.md): a buzz source through two formant filters,
 * with a syllable envelope. It is gated by the *simulated receiver*: when the selected policy's
 * playout has no audio (frozen / dropped), the voice goes silent. Hold B to hear Today's phone.
 * UI tones are short sine blips. Nothing is loaded from the network.
 */
import type { SimSnapshot } from '../../engine/index';

class BoothAudio {
  private ctx: AudioContext | null = null;
  private voiceGain: GainNode | null = null;
  private master: GainNode | null = null;
  private env = 0;
  private syl = 0;
  muted = false;

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(ctx.destination);
      const src = ctx.createOscillator();
      src.type = 'sawtooth';
      src.frequency.value = 118;
      const vib = ctx.createOscillator();
      vib.frequency.value = 5.2;
      const vibG = ctx.createGain();
      vibG.gain.value = 6;
      vib.connect(vibG).connect(src.frequency);
      const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 650; f1.Q.value = 6;
      const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1500; f2.Q.value = 8;
      const mix = ctx.createGain(); mix.gain.value = 1.6;
      src.connect(f1).connect(mix);
      src.connect(f2).connect(mix);
      this.voiceGain = ctx.createGain();
      this.voiceGain.gain.value = 0;
      mix.connect(this.voiceGain).connect(this.master);
      src.start(); vib.start();
      // formant wander so it sounds like speech, not a tone
      const wander = () => {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        f1.frequency.setTargetAtTime(450 + Math.random() * 450, t, 0.05);
        f2.frequency.setTargetAtTime(1100 + Math.random() * 1000, t, 0.05);
        src.frequency.setTargetAtTime(105 + Math.random() * 30, t, 0.1);
        setTimeout(wander, 120 + Math.random() * 120);
      };
      wander();
    } catch { this.ctx = null; }
  }

  /** gate the voice on the simulated playout of the selected policy */
  update(snap: SimSnapshot, policy: string, dt: number) {
    if (!this.ctx || !this.voiceGain) return;
    const pv = snap.policies[policy];
    const playing = !!pv && pv.callState !== 'frozen' && pv.callState !== 'dropped' && !this.muted;
    // syllables ~4 per second with pauses between phrases
    this.syl += dt * 4.2;
    const phrase = Math.sin(snap.t * 0.9) > -0.6;
    const s = Math.max(0, Math.sin(this.syl * Math.PI)) * (phrase ? 1 : 0);
    this.env += (s - this.env) * Math.min(1, dt * 30);
    const target = playing ? 0.22 * this.env : 0;
    this.voiceGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.012);
  }

  tone(sev: 'info' | 'heads' | 'threat') {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    const f = sev === 'threat' ? [520, 390] : sev === 'heads' ? [740, 880] : [660, 990];
    o.frequency.setValueAtTime(f[0], t);
    o.frequency.setValueAtTime(f[1], t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.26);
  }
}

export const audio = new BoothAudio();
