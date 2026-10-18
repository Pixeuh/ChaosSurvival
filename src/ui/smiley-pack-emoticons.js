export const smileyPackEmoticons = Object.freeze([
  Object.freeze({ token: ':sparkle:', label: 'Étoile', src: new URL('./emoticons/smiley-pack/sparkle.svg', import.meta.url).href }),
  Object.freeze({ token: ':blush:', label: 'Timide', src: new URL('./emoticons/smiley-pack/blush.svg', import.meta.url).href }),
  Object.freeze({ token: ':party:', label: 'Fête', src: new URL('./emoticons/smiley-pack/party.svg', import.meta.url).href }),
  Object.freeze({ token: ':love:', label: 'Amour', src: new URL('./emoticons/smiley-pack/love.svg', import.meta.url).href }),
  Object.freeze({ token: ':sleep:', label: 'Sommeil', src: new URL('./emoticons/smiley-pack/sleep.svg', import.meta.url).href }),
  Object.freeze({ token: ':pixelcat:', label: 'Chat pixel', src: new URL('./emoticons/smiley-pack/pixelcat.svg', import.meta.url).href }),
  Object.freeze({ token: ':wow:', label: 'Étonné', src: new URL('./emoticons/smiley-pack/wow.svg', import.meta.url).href }),
]);

export function isSmileyPackInstalled(progression) {
  return progression?.data?.flags?.smileyPack2009Installed === true;
}

export function insertEmoticon(input, token) {
  if (!input || typeof token !== 'string') return false;
  const value = String(input.value ?? '');
  const start = Number.isInteger(input.selectionStart) ? input.selectionStart : value.length;
  const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
  input.value = `${value.slice(0, start)}${token}${value.slice(end)}`;
  const caret = start + token.length;
  input.focus?.();
  input.setSelectionRange?.(caret, caret);
  return true;
}
