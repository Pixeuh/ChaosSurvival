const SOUND_DEFINITIONS = Object.freeze({
  hover: { notes: [640], duration: .045, wave: 'square', volume: .035 },
  select: { notes: [520, 780], duration: .11, wave: 'square', volume: .055 },
  back: { notes: [420, 280], duration: .1, wave: 'triangle', volume: .05 },
  difficulty: { notes: [440, 554], duration: .09, wave: 'triangle', volume: .045 },
  bomb: { notes: [240, 180], duration: .13, wave: 'triangle', volume: .09 },
  explosion: { notes: [150, 90], duration: .2, wave: 'sawtooth', volume: .11 },
  chain: { notes: [190, 110, 73], duration: .24, wave: 'sawtooth', volume: .1 },
  block: { notes: [330, 220], duration: .12, wave: 'square', volume: .055 },
  bonus: { notes: [660, 880, 1100], duration: .19, wave: 'triangle', volume: .07 },
  elimination: { notes: [392, 262], duration: .2, wave: 'triangle', volume: .06 },
  round: { notes: [523, 659, 784], duration: .22, wave: 'square', volume: .055 },
  sudden: { notes: [700, 520, 700], duration: .3, wave: 'triangle', volume: .065 },
  victory: { notes: [523, 659, 784], duration: .27, wave: 'triangle', volume: .075 },
  defeat: { notes: [392, 330, 262], duration: .3, wave: 'triangle', volume: .06 },
  champion: { notes: [523, 659, 784, 1047], duration: .42, wave: 'triangle', volume: .08 },
});

export function createBombArenaAudio({ AudioContextCtor = globalThis.AudioContext ?? globalThis.webkitAudioContext } = {}) {
  let context = null, master = null, muted = false, paused = false, disposed = false;
  let sfxVolume = .65;
  let voices = new Set();
  const ensureContext = () => {
    if (!context && AudioContextCtor) {
      context = new AudioContextCtor(); master = context.createGain(); master.gain.value = muted ? 0 : sfxVolume; master.connect(context.destination);
    }
    return context;
  };
  const stopVoices = () => { for (const voice of voices) { try { voice.stop(); } catch {} } voices.clear(); };
  return {
    unlock() {
      const audio = ensureContext();
      if (audio?.state === 'suspended') return audio.resume().catch(() => {});
      return Promise.resolve();
    },
    play(name) {
      if (disposed || muted || paused) return false;
      const audio = ensureContext(), sound = SOUND_DEFINITIONS[name];
      if (!audio || !sound || audio.state !== 'running') return false;
      if (voices.size > 10) return false;
      const now = audio.currentTime, gap = sound.duration / sound.notes.length;
      sound.notes.forEach((frequency, index) => {
        const oscillator = audio.createOscillator(), gain = audio.createGain();
        oscillator.type = sound.wave; oscillator.frequency.setValueAtTime(frequency, now + index * gap);
        if (name === 'explosion') oscillator.frequency.exponentialRampToValueAtTime(Math.max(45, frequency * .45), now + (index + .9) * gap);
        gain.gain.setValueAtTime(.0001, now + index * gap);
        gain.gain.exponentialRampToValueAtTime(Math.max(.0002, sound.volume * sfxVolume), now + index * gap + .008);
        gain.gain.exponentialRampToValueAtTime(.0001, now + (index + 1) * gap);
        oscillator.connect(gain); gain.connect(master); voices.add(oscillator);
        oscillator.onended = () => { voices.delete(oscillator); try { oscillator.disconnect(); gain.disconnect(); } catch {} };
        oscillator.start(now + index * gap); oscillator.stop(now + (index + 1) * gap + .01);
      });
      return true;
    },
    setSfxVolume(value) { sfxVolume = Math.max(0, Math.min(1, Number(value) || 0)); if (master && !muted) master.gain.setTargetAtTime(sfxVolume, context.currentTime, .025); },
    setMuted(value) { muted = Boolean(value); if (master) master.gain.setTargetAtTime(muted ? 0 : sfxVolume, context.currentTime, .02); if (muted) stopVoices(); },
    setPaused(value) {
      paused = Boolean(value);
      if (paused) { stopVoices(); context?.suspend().catch(() => {}); }
      else if (context?.state === 'suspended') context.resume().catch(() => {});
    },
    get muted() { return muted; },
    get paused() { return paused; },
    get hasMusic() { return false; },
    dispose() { if (disposed) return; disposed = true; stopVoices(); if (context) { const old = context; context = null; master = null; old.close().catch(() => {}); } },
  };
}

export const BOMB_ARENA_SOUND_NAMES = Object.freeze(Object.keys(SOUND_DEFINITIONS));
