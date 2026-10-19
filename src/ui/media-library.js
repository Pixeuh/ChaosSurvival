const audioResources = Object.freeze({
  'k7-son-final-8': new URL(
    '../../assets/dragon-studio-uplifting-trance-584759.mp3',
    import.meta.url,
  ).href,
  'sport-dubstep-kulakovka': new URL(
    '../../assets/kulakovka-sport-dubstep-283969.mp3',
    import.meta.url,
  ).href,
  'i-love-chiptune-punk-brutaldesign': new URL(
    '../../assets/brutaldesign-i-love-chiptune-punk-506083.mp3',
    import.meta.url,
  ).href,
  'lost-in-time-nightcore-nightcorefreemusic4u': new URL(
    '../../assets/nightcorefreemusic4u-lost-in-time-nightcore-310196.mp3',
    import.meta.url,
  ).href,
});

export function mediaAudioResource(audioRef) {
  return typeof audioRef === 'string' ? audioResources[audioRef] ?? null : null;
}

export function isMediaTrack(file) {
  return Boolean(file?.audioRef && mediaAudioResource(file.audioRef));
}

export function mediaAudioReferences() {
  return Object.keys(audioResources);
}
