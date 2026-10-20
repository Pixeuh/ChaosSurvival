// Small offline synth cues: no downloaded sounds, no dependency on music timing.
export class DesktopSounds {
  constructor(getVolume, getContext) {
    this.getVolume = getVolume;
    this.getContext = getContext;
  }
  async unlock() {
    try {
      this.context = this.getContext() ?? this.context;
      if (!this.context) {
        const AudioContextClass = globalThis.window?.AudioContext ?? globalThis.window?.webkitAudioContext;
        if (AudioContextClass) this.context = new AudioContextClass();
      }
      if (!this.context) return false;
      if (this.context.state !== 'running') await this.context.resume();
      return this.context.state === 'running';
    } catch {
      /* Sound effects are optional. */
      return false;
    }
  }
  play(kind) {
    const context = this.getContext() ?? this.context;
    if (!context || context.state !== 'running' || !this.getVolume()) return;
    if (kind === 'wizz') return this.playWizz(context);
    const notes = {
      online: [659, 880, 1047],
      message: [880, 1175],
      offline: [659, 523, 392],
      send: [523, 659],
      catch: [440, 1568, 880],
      victory: [523, 659, 784, 1047, 1319, 1568],
    }[kind] ?? [880];
    notes.forEach((frequency, index) => {
      const start = context.currentTime + index * 0.09;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(this.getVolume() * 0.09, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.16);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.18);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    });
  }
  playWizz(context) {
    const start = context.currentTime;
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    oscillator.type = 'sawtooth';
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1050, start);
    filter.Q.setValueAtTime(1.4, start);
    const steps = [360, 1180, 240, 1040, 310, 1320, 420, 260];
    oscillator.frequency.setValueAtTime(steps[0], start);
    steps.slice(1).forEach((frequency, index) => {
      oscillator.frequency.linearRampToValueAtTime(frequency, start + (index + 1) * 0.045);
    });
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.linearRampToValueAtTime(this.getVolume() * 0.1, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.39);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.4);
    oscillator.onended = () => {
      oscillator.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }
}
