import { claimMusicFocus, releaseMusicFocus } from './music-focus.js';

const GAME_MUSIC_VOLUME = 0.35;

export function createGameMusic(url, AudioConstructor = () => new Audio(url), masterVolume = 1) {
  let audio = null;
  let active = false;
  let paused = false;
  let disposed = false;
  let hasMusicFocus = false;
  let volumeScale = Number.isFinite(masterVolume) ? Math.max(0, Math.min(1, masterVolume)) : 1;

  function updateVolume() {
    if (audio) audio.volume = GAME_MUSIC_VOLUME * volumeScale;
  }

  function play() {
    if (disposed) return false;
    try {
      const result = audio.play();
      result?.catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  function start() {
    if (disposed) return false;
    try {
      audio ??= AudioConstructor();
      if (!audio) return false;
      audio.loop = true;
      updateVolume();
      audio.currentTime = 0;
      active = true;
      paused = false;
      if (!hasMusicFocus) {
        claimMusicFocus(audio);
        hasMusicFocus = true;
      }
      return play();
    } catch {
      active = false;
      paused = false;
      return false;
    }
  }

  function pause() {
    if (!active || paused || !audio) return;
    paused = true;
    try {
      audio.pause();
    } catch {
      // Audio is optional and must never interfere with gameplay.
    }
  }

  function resume() {
    if (!active || !paused || !audio || disposed) return;
    paused = false;
    play();
  }

  function stop() {
    active = false;
    paused = false;
    if (hasMusicFocus) {
      releaseMusicFocus(audio);
      hasMusicFocus = false;
    }
    if (!audio) return;
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {
      // A not-yet-loaded media file may reject seeking; stopping still succeeds.
    }
  }

  function dispose() {
    if (disposed) return;
    stop();
    disposed = true;
    if (!audio) return;
    try {
      audio.removeAttribute?.('src');
      audio.load?.();
    } catch {
      // Cleanup remains best effort for browsers with partial media support.
    }
    audio = null;
  }

  function setMasterVolume(value) {
    if (!Number.isFinite(value)) return;
    volumeScale = Math.max(0, Math.min(1, value));
    updateVolume();
  }

  return Object.freeze({ start, pause, resume, stop, dispose, setMasterVolume });
}
