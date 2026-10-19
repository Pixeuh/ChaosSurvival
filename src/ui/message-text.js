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

export function appendMessageText(element, text) {
  for (const part of String(text).split(new RegExp(`(${classicPattern})`, 'g'))) {
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
