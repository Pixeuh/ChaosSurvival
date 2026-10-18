import { smileyPackEmoticons } from './smiley-pack-emoticons.js';

const emoticons = {
  ':)': 'smile',
  ':D': 'smile',
  ':|': 'neutral',
  '>:)': 'devil',
  ';)': '😉',
  ':P': '😛',
  ':$': '😊',
  '<3': '♥',
  ":')": '😂',
};
const classicPattern = Object.keys(emoticons).sort((a, b) => b.length - a.length)
  .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
const escapePattern = (token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function appendMessageText(element, text, { smileyPackInstalled = false } = {}) {
  const customByToken = smileyPackInstalled
    ? new Map(smileyPackEmoticons.map((emoticon) => [emoticon.token, emoticon]))
    : new Map();
  const pattern = smileyPackInstalled
    ? [...customByToken.keys()].sort((a, b) => b.length - a.length).map(escapePattern).concat(classicPattern).join('|')
    : classicPattern;
  for (const part of String(text).split(new RegExp(`(${pattern})`, 'g'))) {
    const custom = customByToken.get(part);
    if (custom) {
      const face = document.createElement('img');
      face.className = 'msn-emoticon msn-custom-emoticon';
      face.src = custom.src;
      face.alt = custom.token;
      face.title = custom.label;
      face.setAttribute('role', 'img');
      face.setAttribute('aria-label', custom.label);
      element.append(face);
      continue;
    }
    if (!Object.hasOwn(emoticons, part)) {
      element.append(document.createTextNode(part));
      continue;
    }
    const imageEmoticon = ['smile', 'neutral', 'devil'].includes(emoticons[part]);
    const face = document.createElement(imageEmoticon ? 'img' : 'span');
    face.className = `msn-emoticon${part === '<3' ? ' heart' : ''}`;
    if (imageEmoticon) {
      face.src = new URL(`./emoticons/msn-${emoticons[part]}.svg`, document.baseURI).href;
      face.alt = part;
    } else face.textContent = emoticons[part];
    face.title = part;
    face.setAttribute('role', 'img');
    face.setAttribute('aria-label', part);
    element.append(face);
  }
}
