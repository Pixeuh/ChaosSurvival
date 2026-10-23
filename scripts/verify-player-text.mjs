import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { isValidPlayerText, resolvePlayerText } from '../src/story/player-identity.js';
import { popupContent } from '../src/config/popups.js';
import { QUICK_MESSAGES, REACTIONS } from '../src/minigames/bomb-arena/chat-lines.js';
import { BOMB_ARENA_REMINDER_SEQUENCES, BOMB_ARENA_REMINDER_VARIANTS } from '../src/story/narrative-orchestrator.js';
import { bombArenaRedownloadDialogue } from '../src/story/bomb-arena.js';

const root = new URL('../', import.meta.url);
const read = async (file) => JSON.parse(await readFile(new URL(file, root), 'utf8'));
export function textEntries(value, path = '') {
  if (typeof value === 'string') return [{ path, text: value }];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => textEntries(item, path ? `${path}.${key}` : key));
}
const dialogueEntries = (dialogue) => Object.entries(dialogue.nodes).flatMap(([id, node]) => [
  ...node.messages.map((message, index) => ({
    path: `nodes.${id}.messages.${index}`, text: message.text ?? message.file.name, kind: 'message',
    speaker: message.author ?? message.speaker,
  })),
  ...(node.choices ?? []).map((choice) => ({ path: `nodes.${id}.choices.${choice.id}`, text: choice.text, kind: 'choice' })),
]);

// Counts describe authored slots, not all combinations of narrative paths.
// Website paragraphs and comments are counted separately from MSN replies.
export async function collectNarrativeSources() {
  const sources = [];
  const add = (file, entries, kind = 'dialogue') => sources.push({ file, kind, entries });
  const files = (await readdir(new URL('src/dialogues/', root))).filter((file) => file.endsWith('.json')).sort();
  for (const file of files) add(`src/dialogues/${file}`, dialogueEntries(await read(`src/dialogues/${file}`)));
  const hotelConversations = await read('src/browser/sites/hopla-hotel/conversations.json');
  add('src/browser/sites/hopla-hotel/conversations.json', hotelConversations.flatMap((conversation) =>
    conversation.messages.map((message, index) => ({ path: `${conversation.id}.messages.${index}`, text: message.text, speaker: message.speaker }))));
  const hotel = await read('src/browser/sites/hopla-hotel/data.json');
  add('src/browser/sites/hopla-hotel/data.json', [hotel.room, ...hotel.rooms].flatMap((room) => room.npcs.flatMap((npc) => [
    { path: `${room.id}.${npc.id}.dialogue`, text: npc.dialogue },
    ...(npc.followUp ? [{ path: `${room.id}.${npc.id}.followUp`, text: npc.followUp }] : []),
    ...(npc.behavior?.messages ?? []).map((text, i) => ({ path: `${room.id}.${npc.id}.messages.${i}`, text })),
  ])));
  const buddy = await read('src/config/buddy.json');
  add('src/config/buddy.json', [...buddy.introduction.map(({ text }, i) => ({ path: `introduction.${i}`, text })),
    ...buddy.tips.map((text, i) => ({ path: `tips.${i}`, text }))]);
  add('src/story/narrative-orchestrator.js', textEntries({ sequences: BOMB_ARENA_REMINDER_SEQUENCES, variants: BOMB_ARENA_REMINDER_VARIANTS }).filter(({ path }) => path.endsWith('.text')));
  add('src/story/bomb-arena.js', dialogueEntries(bombArenaRedownloadDialogue('audit', await read('src/dialogues/pixelgirl-super-plombier-group.json'))));
  add('src/minigames/bomb-arena/chat-lines.js', [
    ...QUICK_MESSAGES.map(({ id, text }) => ({ path: `quick.${id}`, text })), ...textEntries(REACTIONS, 'reactions'),
  ]);
  add('src/config/popups.js', textEntries(popupContent).filter(({ path }) =>
    /\.messages\.\d+$|\.(heading|message|eyebrow|lead|prize|sticker|action|description|note)$/.test(path)), 'popup');
  const forum = await read('src/browser/sites/forumjeu/data.json');
  add('src/browser/sites/forumjeu/data.json', forum.categories.flatMap((category) => category.topics.flatMap((topic) =>
    topic.posts.map((post, i) => ({ path: `${category.id}.${topic.id}.posts.${i}`, text: post.text, speaker: post.author })))), 'website');
  for (const file of ['data', 'secondary-blogs', 'forum-blogs']) {
    const source = `src/browser/sites/skypage/${file}.json`;
    const data = await read(source);
    add(source, (data.blogs ?? data).flatMap((blog) => blog.articles.flatMap((article) => [
      ...article.paragraphs.map((text, i) => ({ path: `${blog.id}.${article.id}.paragraphs.${i}`, text, speaker: blog.nickname })),
      ...article.comments.map((comment, i) => ({ path: `${blog.id}.${article.id}.comments.${i}`, text: comment.text, speaker: comment.author })),
    ])), 'website');
  }
  const video = await read('electron/videotube-catalog.json');
  add('electron/videotube-catalog.json', video.videos.flatMap((item) => [
    { path: `${item.id}.description`, text: item.description },
    ...item.comments.map((comment, i) => ({ path: `${item.id}.comments.${i}`, text: comment.text, speaker: comment.author })),
  ]), 'website');
  const wiki = await read('src/browser/sites/wiki/data.json');
  add('src/browser/sites/wiki/data.json', [
    ...wiki.facts.map((fact, i) => ({ path: `facts.${i}`, text: fact.text })),
    ...wiki.articles.flatMap((article) => [
      { path: `${article.id}.intro`, text: article.intro },
      ...article.sections.flatMap((section) => section.paragraphs.map((text, i) => ({ path: `${article.id}.${section.id}.${i}`, text }))),
    ]),
  ], 'article');
  for (const file of ['src/config/filesystem.json', 'src/config/desktop-apps.json'])
    add(file, textEntries(await read(file)).filter(({ path }) => path.endsWith('.text')), 'document');
  return sources;
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(new URL(directory, root), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await sourceFiles(file));
    else if (/\.(json|js)$/.test(file)) files.push(file);
  }
  return files;
}

export async function verifyPlayerTexts() {
  const sources = await collectNarrativeSources();
  for (const source of sources) for (const { path, text } of source.entries)
    assert.ok(isValidPlayerText(text), `Texte invalide : ${source.file}:${path}`);
  // All JSON strings are checked, including titles, descriptions and rules
  // outside the counted conversation corpus. Inline UI tokens are checked too.
  for (const file of [...await sourceFiles('src'), 'electron/videotube-catalog.json']) {
    const raw = await readFile(new URL(file, root), 'utf8');
    const entries = file.endsWith('.json') ? textEntries(JSON.parse(raw))
      : file === 'src/story/player-identity.js' ? []
      : [...raw.matchAll(/(?<!\$)\{player[^}\r\n]*(?:\}|$)/g)].map((match) => ({ path: `offset ${match.index}`, text: match[0] }));
    for (const { path, text } of entries) {
      assert.ok(isValidPlayerText(text), `Variante/variable invalide : ${file}:${path}`);
      for (const grammaticalGender of ['male', 'female']) {
        const rendered = resolvePlayerText(text, { nickname: 'PixelFan', identityGender: 'neither', grammaticalGender, completed: true });
        assert.equal(typeof rendered, 'string', `${file}:${path}`);
      }
    }
  }
  return sources;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sources = await verifyPlayerTexts();
  if (process.argv.includes('--inventory')) console.log(JSON.stringify(sources.map(({ file, kind, entries }) => ({
    file, kind, count: entries.length,
    variants: entries.filter(({ text }) => /\{player\.(gender|grammaticalGender):/.test(text)).map(({ path, text }) => ({
      path, male: resolvePlayerText(text, { nickname: 'Alex2009', grammaticalGender: 'male' }),
      female: resolvePlayerText(text, { nickname: 'Pixe', grammaticalGender: 'female' }),
    })),
  })), null, 2));
  else console.log(`Textes et variantes vérifiés : ${sources.length} sources, ${sources.reduce((n, source) => n + source.entries.length, 0)} unités narratives.`);
}
