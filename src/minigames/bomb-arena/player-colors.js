export const PLAYER_PALETTES = Object.freeze({
  justme: Object.freeze(['#f2c94c', '#956714', '#fff0a3']),
  pixelgirl: Object.freeze(['#ff74b9', '#a63370', '#ffe0f0']),
  turbo: Object.freeze(['#27d68b', '#08734f', '#b5ffe0']),
  luna: Object.freeze(['#8b83fa', '#4b4a9c', '#e4dcff']),
});

export const PLAYER_COLORS = Object.freeze(
  Object.fromEntries(Object.entries(PLAYER_PALETTES).map(([id, colors]) => [id, colors[0]])),
);
