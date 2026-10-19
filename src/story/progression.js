import { replaceGameStorage } from './reset-game.js';
import { normalizeVirtualFilesystemState } from './virtual-filesystem.js';
const TYPES = ['arcade', 'conversation', 'minigame'];
const STORAGE_KEY = 'chaos-survival-story-v1';
export const MINIGAME_REACTION_DELAY_MS = 2000;
export const HISTORY_KEY = 'chaos-survival-history-v1';
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const runId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const BOMB_ARENA_DIFFICULTIES = new Set(['PRO', 'PGM']);
const SAVED_BOMB_ARENA_DIFFICULTIES = new Set(['NOOB', ...BOMB_ARENA_DIFFICULTIES]);
const BOMB_ARENA_WINNERS = new Set(['justme', 'pixelgirl', 'turbo', 'luna']);
function normalizeBombArenaScores(scores) {
  if (!record(scores) || !['justme', 'pixelgirl', 'turbo', 'luna'].every((id) =>
    Number.isSafeInteger(scores[id]) && scores[id] >= 0)) return null;
  return Object.fromEntries(['justme', 'pixelgirl', 'turbo', 'luna'].map((id) => [id, scores[id]]));
}
function freshBombArenaProgress() {
  return {
    status: 'NOT_STARTED',
    expectedAt: null,
    returnedToMessengerAt: null,
    completedRounds: 0,
    nextRound: 1,
    nextDifficulty: 'PRO',
    overtimeRounds: 0,
    roundScores: { justme: 0, pixelgirl: 0, turbo: 0, luna: 0 },
    sessionWinner: null,
    sessionScores: null,
    sessionRoundsPlayed: null,
    nextReminderAt: null,
    reminderCount: 0,
    reminderSalvoCount: 0,
    reminderLastExtraVariant: null,
    interruptionCount: 0,
    reminderBurstRemaining: 0,
    reminderBurstSent: 0,
    reminderBurstNextAt: null,
    reminderBurstSalvo: null,
    reminderBurstSequence: null,
    reminderBurstMessageCount: 0,
    downloadedAt: null,
    extractedAt: null,
    firstLaunchedAt: null,
    firstGameStartedAt: null,
    firstGameCompletedAt: null,
    firstGameDifficulty: null,
    firstGameWinner: null,
    firstGameScores: null,
    firstGameRoundsPlayed: null,
    gamesPlayed: 0,
    justMeWins: 0,
    defeats: 0,
    lastDifficulty: null,
    lastWinner: null,
    lastScores: null,
    lastRoundsPlayed: null,
    completedMatchIds: [],
  };
}
function freshData(story) {
  return {
    version: 1,
    runId: runId(),
    started: false,
    current: story.start,
    completed: [],
    flags: {},
    choices: [],
    dialogues: {},
    conversations: {},
    optionalConversations: {},
    results: {},
    choiceOffers: {},
    files: {},
    virtualFilesystem: { deleted: [], added: {} },
    desktopShortcuts: [],
    desktopIconsRemoved: [],
    anomalies: {},
    dialogueArchives: {},
    unlockedConversations: [],
    level1Launches: 0,
    replayReactions: [],
    pendingMiniGameReaction: null,
    pendingConnectionMessages: {},
    tutorials: {},
    bombArena: freshBombArenaProgress(),
  };
}
export function createFreshProgressionData(story) {
  return freshData(story);
}
function validSaved(saved) {
  return record(saved) && saved.version === 1 && Array.isArray(saved.completed);
}

const validPrimitiveRecord = (value) =>
  Object.fromEntries(
    Object.entries(value).filter(
      ([key, item]) =>
        !['__proto__', 'constructor', 'prototype'].includes(key) &&
        ['string', 'number', 'boolean'].includes(typeof item) &&
        (typeof item !== 'number' || Number.isFinite(item)),
    ),
  );

function normalizeSaved(saved, story) {
  const ids = new Set(story.sequences.map((item) => item.id));
  if (!Array.isArray(saved.choices)) saved.choices = [];
  if (!record(saved.flags)) saved.flags = {};
  if (!record(saved.dialogues)) saved.dialogues = {};
  if (!record(saved.optionalConversations)) saved.optionalConversations = {};
  for (const [id, state] of Object.entries(saved.optionalConversations)) {
    if (!/^[a-z0-9-]{1,100}$/i.test(id) || !record(state) ||
      !['locked', 'available', 'started', 'completed', 'expired'].includes(state.status)) {
      delete saved.optionalConversations[id];
      continue;
    }
    for (const key of ['expirationDueAt', 'expiredAt'])
      if (!Number.isFinite(state[key])) delete state[key];
  }
  if (!record(saved.results)) saved.results = {};
  saved.completed = [...new Set(saved.completed.filter((id) => ids.has(id)))];
  if (saved.current !== null && !ids.has(saved.current)) {
    const last = [...saved.completed]
      .reverse()
      .find((id) => story.sequences.find((item) => item.id === id)?.next);
    saved.current = last ? story.sequences.find((item) => item.id === last).next : story.start;
  }
  if (saved.current === undefined) {
    const last = [...saved.completed]
      .reverse()
      .find((id) => story.sequences.find((item) => item.id === id)?.next);
    saved.current = last ? story.sequences.find((item) => item.id === last).next : story.start;
  }
  if (typeof saved.started !== 'boolean')
    saved.started = Boolean(
      saved.completed.length || saved.choices.length || Object.keys(saved.dialogues).length,
    );
  saved.choices = saved.choices.filter(
    (item) => record(item) && typeof item.key === 'string' && typeof item.choice === 'string',
  );
  const choiceKeys = new Set();
  saved.choices = saved.choices.filter((item) => {
    if (choiceKeys.has(item.key)) return false;
    choiceKeys.add(item.key);
    return true;
  });
  saved.flags = validPrimitiveRecord(saved.flags);
  for (const key of ['choiceOffers', 'files', 'anomalies', 'dialogueArchives', 'tutorials'])
    if (!record(saved[key])) saved[key] = {};
  for (const [key, offers] of Object.entries(saved.choiceOffers)) {
    if (!Array.isArray(offers)) {
      delete saved.choiceOffers[key];
      continue;
    }
    saved.choiceOffers[key] = offers.filter(
      (item) => record(item) && typeof item.id === 'string' && typeof item.text === 'string',
    );
  }
  for (const [key, file] of Object.entries(saved.files))
    if (
      !record(file) || typeof file.id !== 'string' || typeof file.name !== 'string' ||
      !['pending', 'declined', 'complete'].includes(file.status) ||
      (file.launch != null && (!record(file.launch) || typeof file.launch.game !== 'string'))
    ) delete saved.files[key];
    else if (file.extractable === 'bomb-arena') {
      file.transferState ??= ({ pending: 'proposed', declined: 'declined', complete: 'complete' })[file.status];
      if (!['proposed', 'accepted', 'declined', 'in-progress', 'complete'].includes(file.transferState))
        file.transferState = ({ pending: 'proposed', declined: 'declined', complete: 'complete' })[file.status];
      if (!Number.isFinite(file.transferStartedAt)) delete file.transferStartedAt;
    }
  if (record(saved.desktopIcons))
    for (const file of Object.values(saved.files)) {
      if (
        file.status !== 'complete' || file.direction !== 'receive' ||
        typeof file.name !== 'string' || /[\\/\u0000-\u001f]/.test(file.name)
      )
        continue;
      const oldKey = `file:${file.id}`;
      const newKey = `file:downloads/${file.name.toLowerCase()}`;
      if (Object.hasOwn(saved.desktopIcons, oldKey)) {
        if (!Object.hasOwn(saved.desktopIcons, newKey)) saved.desktopIcons[newKey] = saved.desktopIcons[oldKey];
        delete saved.desktopIcons[oldKey];
      }
    }
  if (!Array.isArray(saved.desktopIconsRemoved)) saved.desktopIconsRemoved = [];
  saved.desktopIconsRemoved = [...new Set(saved.desktopIconsRemoved.filter(
    (id) => typeof id === 'string' && /^(?:shortcut|file):[a-z0-9_./ -]{1,180}$/i.test(id),
  ))];
  if (!Array.isArray(saved.desktopShortcuts)) saved.desktopShortcuts = [];
  saved.desktopShortcuts = saved.desktopShortcuts.filter((shortcut) =>
    record(shortcut) &&
    typeof shortcut.id === 'string' && /^[a-z0-9-]{1,80}$/i.test(shortcut.id) &&
    typeof shortcut.targetFileId === 'string' && /^[a-z0-9-]{1,40}\/[^/\\]{1,160}$/i.test(shortcut.targetFileId) &&
    typeof shortcut.name === 'string' && shortcut.name.length > 0 && shortcut.name.length <= 160 &&
    typeof shortcut.icon === 'string' && /^[a-z0-9-]{1,40}$/i.test(shortcut.icon),
  ).map((shortcut) => ({
    id: shortcut.id.toLowerCase(),
    targetFileId: shortcut.targetFileId.toLowerCase(),
    name: shortcut.name,
    icon: shortcut.icon.toLowerCase(),
  }));
  saved.virtualFilesystem = normalizeVirtualFilesystemState(saved.virtualFilesystem, saved.files);
  const reminderSalvosWereSaved = record(saved.bombArena) &&
    Number.isSafeInteger(saved.bombArena.reminderSalvoCount) && saved.bombArena.reminderSalvoCount >= 0;
  if (!record(saved.bombArena)) saved.bombArena = freshBombArenaProgress();
  else saved.bombArena = { ...freshBombArenaProgress(), ...saved.bombArena };
  const bombArena = saved.bombArena;
  for (const key of ['expectedAt', 'returnedToMessengerAt', 'nextReminderAt', 'reminderBurstNextAt', 'downloadedAt', 'extractedAt', 'firstLaunchedAt', 'firstGameStartedAt', 'firstGameCompletedAt'])
    if (bombArena[key] !== null && !Number.isFinite(bombArena[key])) bombArena[key] = null;
  if (!['NOT_STARTED', 'IN_PROGRESS', 'RESULTS_READY', 'COMPLETED'].includes(bombArena.status))
    bombArena.status = 'NOT_STARTED';
  for (const key of ['completedRounds', 'reminderCount', 'interruptionCount', 'reminderBurstRemaining', 'reminderBurstSent', 'reminderBurstMessageCount'])
    if (!Number.isSafeInteger(bombArena[key]) || bombArena[key] < 0) bombArena[key] = 0;
  bombArena.reminderBurstRemaining = Math.min(bombArena.reminderBurstRemaining, 6);
  if (!reminderSalvosWereSaved || !Number.isSafeInteger(bombArena.reminderSalvoCount) || bombArena.reminderSalvoCount < 0)
    bombArena.reminderSalvoCount = bombArena.interruptionCount + bombArena.reminderCount;
  if (bombArena.reminderLastExtraVariant !== null &&
    (!Number.isSafeInteger(bombArena.reminderLastExtraVariant) || bombArena.reminderLastExtraVariant < 0 || bombArena.reminderLastExtraVariant > 5))
    bombArena.reminderLastExtraVariant = null;
  if (bombArena.reminderBurstSequence !== null &&
    (!Number.isSafeInteger(bombArena.reminderBurstSequence) || bombArena.reminderBurstSequence < -1 || bombArena.reminderBurstSequence > 11))
    bombArena.reminderBurstSequence = null;
  if (bombArena.reminderBurstSalvo !== null &&
    (!Number.isSafeInteger(bombArena.reminderBurstSalvo) || bombArena.reminderBurstSalvo < 1))
    bombArena.reminderBurstSalvo = null;
  if (bombArena.reminderBurstRemaining > 0 && bombArena.reminderBurstSequence === null) {
    // Resume a burst created by the previous one-message reminder implementation.
    bombArena.reminderBurstSequence = -1;
    bombArena.reminderBurstSalvo = Math.max(1, bombArena.interruptionCount);
    bombArena.reminderBurstMessageCount = bombArena.reminderBurstRemaining + bombArena.reminderBurstSent;
  }
  bombArena.completedRounds = Math.min(bombArena.completedRounds, 128);
  bombArena.nextRound = bombArena.completedRounds + 1;
  bombArena.nextDifficulty = bombArena.nextRound >= 5 ? 'PGM' : 'PRO';
  bombArena.overtimeRounds = Math.max(0, bombArena.completedRounds - 8);
  bombArena.roundScores = normalizeBombArenaScores(bombArena.roundScores) ?? freshBombArenaProgress().roundScores;
  bombArena.sessionScores = bombArena.sessionScores === null ? null : normalizeBombArenaScores(bombArena.sessionScores);
  if (bombArena.sessionWinner !== null && !BOMB_ARENA_WINNERS.has(bombArena.sessionWinner)) bombArena.sessionWinner = null;
  if (bombArena.sessionRoundsPlayed !== null && (!Number.isSafeInteger(bombArena.sessionRoundsPlayed) || bombArena.sessionRoundsPlayed < 8))
    bombArena.sessionRoundsPlayed = null;
  if (bombArena.status === 'RESULTS_READY' && (!bombArena.sessionWinner || !bombArena.sessionScores || !bombArena.sessionRoundsPlayed))
    bombArena.status = 'IN_PROGRESS';
  if (bombArena.status === 'COMPLETED') {
    bombArena.nextReminderAt = null;
    bombArena.reminderBurstNextAt = null;
    bombArena.reminderBurstRemaining = 0;
  }
  for (const key of ['firstGameDifficulty', 'lastDifficulty'])
    if (bombArena[key] !== null && !SAVED_BOMB_ARENA_DIFFICULTIES.has(bombArena[key])) bombArena[key] = null;
  for (const key of ['firstGameWinner', 'lastWinner'])
    if (bombArena[key] !== null && !BOMB_ARENA_WINNERS.has(bombArena[key])) bombArena[key] = null;
  for (const key of ['firstGameScores', 'lastScores'])
    if (bombArena[key] !== null) bombArena[key] = normalizeBombArenaScores(bombArena[key]);
  for (const key of ['firstGameRoundsPlayed', 'lastRoundsPlayed'])
    if (bombArena[key] !== null && (!Number.isSafeInteger(bombArena[key]) || bombArena[key] < 8)) bombArena[key] = null;
  for (const key of ['gamesPlayed', 'justMeWins', 'defeats'])
    if (!Number.isSafeInteger(bombArena[key]) || bombArena[key] < 0) bombArena[key] = 0;
  bombArena.completedMatchIds = Array.isArray(bombArena.completedMatchIds)
    ? [...new Set(bombArena.completedMatchIds.filter((id) => typeof id === 'string' && /^[a-z0-9-]{1,100}$/i.test(id)))].slice(-128)
    : [];
  if (!bombArena.downloadedAt && Object.values(saved.files).some((file) =>
    file?.extractable === 'bomb-arena' && file.status === 'complete' && file.direction === 'receive'))
    bombArena.downloadedAt = 0;
  if (!bombArena.extractedAt && Object.hasOwn(saved.virtualFilesystem.added ?? {}, 'bomb-arena-folder/bombarena.exe'))
    bombArena.extractedAt = 0;
  if (record(saved.textFiles)) {
    for (const key of Object.keys(saved.textFiles))
      if (key.replaceAll('\\', '/').toLowerCase().startsWith('user-desktop/'))
        delete saved.textFiles[key];
  }
  for (const [id, state] of Object.entries(saved.dialogues)) {
    if (
      !record(state) || typeof state.node !== 'string' || !Number.isInteger(state.cursor) ||
      state.cursor < 0 || typeof state.finished !== 'boolean' || !Array.isArray(state.transcript)
    ) {
      delete saved.dialogues[id];
      continue;
    }
    state.transcript = state.transcript.filter(
      (message) => record(message) && ['contact', 'player'].includes(message.speaker) &&
        typeof message.text === 'string' &&
        (message.author === undefined ||
          (message.speaker === 'contact' && typeof message.author === 'string')) &&
        (message.type !== 'file' || typeof message.fileKey === 'string'),
    );
    if (state.receiveDueAt !== undefined && !Number.isFinite(state.receiveDueAt))
      delete state.receiveDueAt;
  }
  if (
    saved.level1Launches !== undefined &&
    (!Number.isInteger(saved.level1Launches) || saved.level1Launches < 0)
  )
    delete saved.level1Launches;
  if (saved.replayReactions !== undefined) {
    if (!Array.isArray(saved.replayReactions)) saved.replayReactions = [];
    else saved.replayReactions = saved.replayReactions.filter(
      (event) => record(event) && Number.isInteger(event.attempt) && typeof event.id === 'string' &&
        typeof event.template === 'string' && Number.isFinite(event.dueAt) && typeof event.ready === 'boolean',
    );
  }
  const reaction = saved.pendingMiniGameReaction;
  if (
    reaction !== undefined &&
    reaction !== null &&
    (!record(reaction) || typeof reaction.runId !== 'string' ||
      typeof reaction.sequenceId !== 'string' || typeof reaction.dialogueId !== 'string' ||
      (reaction.storySequenceId !== undefined && typeof reaction.storySequenceId !== 'string') ||
      !Number.isFinite(reaction.dueAt))
  ) saved.pendingMiniGameReaction = null;
  if (!record(saved.pendingConnectionMessages)) saved.pendingConnectionMessages = {};
  for (const [eventId, message] of Object.entries(saved.pendingConnectionMessages))
    if (
      !record(message) || typeof message.runId !== 'string' ||
      typeof message.contactId !== 'string' || typeof message.dialogueId !== 'string' ||
      !Number.isFinite(message.dueAt) ||
      (message.connectedAt !== undefined && !Number.isFinite(message.connectedAt))
    ) delete saved.pendingConnectionMessages[eventId];
  return saved;
}

export function validateStory(story) {
  if (story.version !== 1 || !Array.isArray(story.sequences) || !story.sequences.length)
    throw new Error('La progression narrative est invalide.');
  const ids = new Set(story.sequences.map((item) => item.id));
  if (ids.size !== story.sequences.length || !ids.has(story.start))
    throw new Error('Identifiants de séquences invalides.');
  for (const item of story.sequences) {
    if (
      typeof item.id !== 'string' ||
      !TYPES.includes(item.type) ||
      (item.next !== null && !ids.has(item.next))
    )
      throw new Error(`Séquence invalide : ${item.id}`);
  }
}

export class Progression {
  constructor(story, storage) {
    validateStory(story);
    this.story = story;
    this.storage = storage;
    this.handlers = new Map();
    this.data = freshData(story);
    try {
      const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
      if (validSaved(saved)) this.data = normalizeSaved(saved, story);
      else if (saved !== null) this.corrupt = true;
    } catch {
      this.corrupt = true;
    }
    this.data.choiceOffers ??= {};
    if (!record(this.data.contactConnections)) this.data.contactConnections = {};
    for (const [id, connection] of Object.entries(this.data.contactConnections)) {
      if (
        !record(connection) ||
        !['pending', 'online'].includes(connection.status) ||
        (connection.status === 'pending' && !Number.isFinite(connection.dueAt))
      )
        delete this.data.contactConnections[id];
    }
    if (!record(this.data.tutorials)) this.data.tutorials = {};
    if (!record(this.data.pendingConnectionMessages)) this.data.pendingConnectionMessages = {};
    for (const [eventId, message] of Object.entries(this.data.pendingConnectionMessages))
      if (message.runId !== this.data.runId) delete this.data.pendingConnectionMessages[eventId];
    this.data.files ??= {};
    this.data.anomalies ??= {};
    this.data.dialogueArchives ??= {};
    this.data.runId ??= runId();
    const pendingReaction = this.data.pendingMiniGameReaction;
    if (pendingReaction) {
      const sourceSequence = story.sequences.find((item) => item.id === pendingReaction.sequenceId);
      const reactionSequence = story.sequences.find((item) => item.id === pendingReaction.storySequenceId);
      if (
        pendingReaction.runId !== this.data.runId ||
        (pendingReaction.storySequenceId !== undefined &&
          (!this.data.completed.includes(pendingReaction.sequenceId) ||
            sourceSequence?.next !== reactionSequence?.id ||
            reactionSequence?.type !== 'conversation' ||
            reactionSequence.dialogue !== pendingReaction.dialogueId ||
            this.data.current !== reactionSequence.id))
      ) this.data.pendingMiniGameReaction = null;
    }
    this.data.started ??= Boolean(
      this.data.completed.length ||
      this.data.choices.length ||
      Object.keys(this.data.dialogues).length,
    );
    // An appended chapter resumes old completed runs without replaying their games.
    const tail = story.sequences.find(
      (item) =>
        this.data.completed.includes(item.id) &&
        !this.data.completed.includes(item.next) &&
        story.sequences.some((next) => next.id === item.next && next.resumeAfterCompletion),
    );
    if (this.data.current === null && tail) this.data.current = tail.next;
    this.data.unlockedConversations = story.sequences
      .filter(
        (sequence) =>
          sequence.type === 'conversation' &&
          (this.data.completed.includes(sequence.id) || this.data.current === sequence.id),
      )
      .map((sequence) => sequence.dialogue);
    // A JSON revision must not unlock an already completed introduction again.
  }
  save() {
    try {
      this.data.chapter = this.current?.chapter ?? 1;
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.data));
      this.persistenceError = false;
      return true;
    } catch {
      this.persistenceError = true;
      return false;
    }
  }
  get hasSave() {
    return this.data.started || this.data.completed.length > 0;
  }
  begin() {
    this.data.started = true;
    this.data.startedAt ??= new Date().toISOString();
    this.save();
  }
  newGame() {
    const next = freshData(this.story);
    replaceGameStorage(this.storage, next);
    this.data = next;
    this.corrupt = false;
    this.persistenceError = false;
    this.onNewGame?.({ runId: next.runId });
  }
  get current() {
    return this.story.sequences.find((item) => item.id === this.data.current) ?? null;
  }
  register(type, handler) {
    if (!TYPES.includes(type) || typeof handler !== 'function')
      throw new Error('Gestionnaire de séquence invalide.');
    this.handlers.set(type, handler);
    return this;
  }
  async enterCurrent() {
    if (this.isBombArenaBlockingStory()) return null;
    const sequence = this.current;
    if (!sequence) return null;
    const handler = this.handlers.get(sequence.type);
    if (!handler) throw new Error(`Aucun gestionnaire pour la séquence ${sequence.type}.`);
    await handler(sequence, this);
    return sequence;
  }
  complete(id, result = {}, completedAt = Date.now()) {
    if (this.isBombArenaBlockingStory()) return false;
    if (this.data.completed.includes(id)) return false;
    if (this.data.current !== id) throw new Error('Cette séquence n’est pas la séquence active.');
    const completedSequence = this.current;
    this.data.completed.push(id);
    this.data.results[id] = result;
    this.data.current = this.current.next;
    const next = this.current;
    this.data.pendingMiniGameReaction = null;
    if (['arcade', 'minigame'].includes(completedSequence?.type) && next?.type === 'conversation')
      this.deferMiniGameReaction(id, next.dialogue, completedAt, next.id);
    if (next?.type === 'conversation' && !this.data.unlockedConversations.includes(next.dialogue))
      this.data.unlockedConversations.push(next.dialogue);
    this.data.started = true;
    this.save();
    return true;
  }
  consumeMiniGameReaction(dialogueId) {
    if (this.data.pendingMiniGameReaction?.dialogueId !== dialogueId) return false;
    this.data.pendingMiniGameReaction = null;
    return true;
  }
  consumeConnectionMessage(dialogueId) {
    let consumed = false;
    for (const [eventId, message] of Object.entries(this.data.pendingConnectionMessages ?? {}))
      if (message.dialogueId === dialogueId) {
        delete this.data.pendingConnectionMessages[eventId];
        consumed = true;
      }
    return consumed;
  }
  deferMiniGameReaction(sourceId, dialogueId, completedAt = Date.now(), storySequenceId) {
    if (typeof sourceId !== 'string' || typeof dialogueId !== 'string' || !Number.isFinite(completedAt))
      return false;
    this.data.pendingMiniGameReaction = {
      runId: this.data.runId,
      sequenceId: sourceId,
      ...(typeof storySequenceId === 'string' ? { storySequenceId } : {}),
      dialogueId,
      dueAt: completedAt + MINIGAME_REACTION_DELAY_MS,
    };
    this.save();
    return true;
  }
  offer(dialogue, node, choices) {
    const key = `${dialogue}:${node}`;
    if (!Object.hasOwn(this.data.choiceOffers, key)) {
      this.data.choiceOffers[key] = choices.map(({ id, text, next, set }) => ({
        id,
        text,
        next,
        set: { ...set },
      }));
      this.save();
    }
    return this.data.choiceOffers[key];
  }
  choose(dialogue, node, choice, offered = []) {
    const key = `${dialogue}:${node}`;
    if (this.data.choices.some((item) => item.key === key))
      throw new Error('Une réponse a déjà été choisie.');
    const proposals = this.offer(dialogue, node, offered);
    for (const [flag, value] of Object.entries(choice.set ?? {})) {
      if (
        ['__proto__', 'constructor', 'prototype'].includes(flag) ||
        !['string', 'number', 'boolean'].includes(typeof value)
      )
        throw new Error('Valeur narrative invalide.');
      this.data.flags[flag] = value;
    }
    this.data.choices.push({
      key,
      dialogue,
      node,
      choice: choice.id,
      text: choice.text,
      offered: structuredClone(proposals),
      unselected: structuredClone(proposals.filter((item) => item.id !== choice.id)),
    });
  }
  receiveFile(file, dialogue, node, direction = 'receive', offer = 0) {
    const key = `${dialogue}:${node}:${direction}:${file.id}:${offer}`;
    if (Object.hasOwn(this.data.files, key)) return this.data.files[key];
    const item = {
      ...structuredClone(file),
      key,
      dialogue,
      node,
      direction,
      status: 'pending',
      ...(file.extractable === 'bomb-arena' ? { transferState: 'proposed' } : {}),
    };
    this.data.files[key] = item;
    this.save();
    return item;
  }
  finishTransfer(key) {
    const file = this.data.files[key];
    if (!file) throw new Error('Transfert inconnu.');
    file.status = 'complete';
    if (file.extractable === 'bomb-arena') {
      file.transferState = 'complete';
      this.recordBombArenaEvent({ type: 'downloaded' });
    }
    this.save();
    return file;
  }
  recordBombArenaEvent(event, now = Date.now()) {
    if (!record(event) || !Number.isFinite(now)) return false;
    const state = this.data.bombArena ??= freshBombArenaProgress();
    const setFirstTime = (key) => {
      if (state[key] !== null) return false;
      state[key] = now;
      return true;
    };
    let changed = false;
    if (event.type === 'expected') {
      if (state.expectedAt === null) {
        state.expectedAt = now;
        state.status = 'NOT_STARTED';
        state.nextReminderAt = now + 45_000;
        changed = true;
      }
    } else if (event.type === 'downloaded') changed = setFirstTime('downloadedAt');
    else if (event.type === 'extracted') changed = setFirstTime('extractedAt');
    else if (event.type === 'launched') {
      changed = setFirstTime('firstLaunchedAt');
      if (state.expectedAt !== null && state.status !== 'RESULTS_READY' && state.status !== 'COMPLETED' &&
        (state.reminderBurstRemaining || state.reminderBurstNextAt !== null)) {
        state.reminderBurstRemaining = 0;
        state.reminderBurstNextAt = null;
        changed = true;
      }
    } else if (event.type === 'interrupted') {
      if (state.expectedAt === null || state.status === 'RESULTS_READY' || state.status === 'COMPLETED') return false;
      if (!Number.isSafeInteger(event.salvoNumber) || event.salvoNumber !== state.reminderSalvoCount + 1 ||
        !Number.isSafeInteger(event.sequenceIndex) || event.sequenceIndex < 0 || event.sequenceIndex > 11 ||
        !Number.isSafeInteger(event.messageCount) || event.messageCount < 4 || event.messageCount > 6 ||
        !Number.isFinite(event.firstDueAt) || !Number.isFinite(event.periodicDueAt)) return false;
      state.interruptionCount++;
      state.reminderSalvoCount = event.salvoNumber;
      state.reminderBurstSequence = event.sequenceIndex;
      state.reminderBurstSalvo = event.salvoNumber;
      state.reminderBurstMessageCount = event.messageCount;
      state.reminderBurstRemaining = event.messageCount;
      state.reminderBurstSent = 0;
      state.reminderBurstNextAt = event.firstDueAt;
      state.nextReminderAt = event.periodicDueAt;
      if (event.sequenceIndex >= 6) state.reminderLastExtraVariant = event.sequenceIndex - 6;
      changed = true;
    } else if (event.type === 'reminder-salvo-started') {
      if (state.expectedAt === null || state.status === 'RESULTS_READY' || state.status === 'COMPLETED' ||
        event.source !== 'periodic' || !Number.isSafeInteger(event.count) || event.count !== state.reminderCount + 1 ||
        !Number.isSafeInteger(event.salvoNumber) || event.salvoNumber !== state.reminderSalvoCount + 1 ||
        !Number.isSafeInteger(event.sequenceIndex) || event.sequenceIndex < 0 || event.sequenceIndex > 11 ||
        !Number.isSafeInteger(event.messageCount) || event.messageCount < 4 || event.messageCount > 6 ||
        !Number.isFinite(event.dueAt) || !Number.isFinite(event.periodicDueAt)) return false;
      state.reminderCount = event.count;
      state.reminderSalvoCount = event.salvoNumber;
      state.reminderBurstSequence = event.sequenceIndex;
      state.reminderBurstSalvo = event.salvoNumber;
      state.reminderBurstMessageCount = event.messageCount;
      state.reminderBurstRemaining = event.messageCount;
      state.reminderBurstSent = 0;
      state.reminderBurstNextAt = event.dueAt;
      state.nextReminderAt = event.periodicDueAt;
      if (event.sequenceIndex >= 6) state.reminderLastExtraVariant = event.sequenceIndex - 6;
      changed = true;
    } else if (event.type === 'reminder-message-scheduled') {
      if (state.expectedAt === null || state.status === 'RESULTS_READY' || state.status === 'COMPLETED' ||
        event.salvoNumber !== state.reminderBurstSalvo || event.sequenceIndex !== state.reminderBurstSequence ||
        state.reminderBurstRemaining < 1 ||
        state.reminderBurstRemaining + state.reminderBurstSent !== state.reminderBurstMessageCount ||
        (state.reminderBurstRemaining > 1 ? !Number.isFinite(event.nextAt) : event.nextAt !== null)) return false;
      state.reminderBurstRemaining--;
      state.reminderBurstSent++;
      state.reminderBurstNextAt = event.nextAt;
      changed = true;
    } else if (event.type === 'reminder-burst-scheduled') {
      if (state.expectedAt === null || state.status === 'RESULTS_READY' || state.status === 'COMPLETED' ||
        event.interruptionCount !== state.interruptionCount || state.reminderBurstSequence !== -1 ||
        state.reminderBurstRemaining < 1 ||
        state.reminderBurstRemaining + state.reminderBurstSent !== state.reminderBurstMessageCount ||
        (state.reminderBurstRemaining > 1 ? !Number.isFinite(event.nextAt) : event.nextAt !== null)) return false;
      state.reminderBurstRemaining--;
      state.reminderBurstSent++;
      state.reminderBurstNextAt = event.nextAt;
      changed = true;
    } else if (event.type === 'match-started') {
      if (!BOMB_ARENA_DIFFICULTIES.has(event.difficulty)) return false;
      if (state.firstGameStartedAt === null) {
        state.firstGameStartedAt = now;
        state.firstGameDifficulty = event.difficulty;
        changed = true;
      }
      if (state.expectedAt !== null && state.status === 'NOT_STARTED') {
        state.status = 'IN_PROGRESS';
        changed = true;
      }
    } else if (event.type === 'round-completed') {
      const round = event.round;
      const scores = normalizeBombArenaScores(event.scores);
      if (state.status === 'COMPLETED') return false;
      if (!Number.isSafeInteger(round) || round !== state.completedRounds + 1 || !scores ||
        (event.winnerId !== null && !BOMB_ARENA_WINNERS.has(event.winnerId))) return false;
      state.completedRounds = round;
      state.nextRound = round + 1;
      state.nextDifficulty = state.nextRound >= 5 ? 'PGM' : 'PRO';
      state.overtimeRounds = Math.max(0, round - 8);
      state.roundScores = scores;
      state.status = 'IN_PROGRESS';
      changed = true;
    } else if (event.type === 'match-completed') {
      if (typeof event.matchId !== 'string' || !/^[a-z0-9-]{1,100}$/i.test(event.matchId) ||
        !BOMB_ARENA_DIFFICULTIES.has(event.difficulty) || !BOMB_ARENA_WINNERS.has(event.winnerId) ||
        !Number.isSafeInteger(event.roundsPlayed) || event.roundsPlayed < 8) return false;
      const scores = normalizeBombArenaScores(event.scores);
      if (!scores || scores[event.winnerId] !== Math.max(...Object.values(scores)) ||
        Object.values(scores).filter((score) => score === scores[event.winnerId]).length !== 1) return false;
      if (state.completedMatchIds.includes(event.matchId)) return false;
      state.completedMatchIds.push(event.matchId);
      state.completedMatchIds = state.completedMatchIds.slice(-128);
      state.gamesPlayed++;
      if (event.winnerId === 'justme') state.justMeWins++;
      else state.defeats++;
      state.lastDifficulty = event.difficulty;
      state.lastWinner = event.winnerId;
      state.lastScores = scores;
      state.lastRoundsPlayed = event.roundsPlayed;
      state.completedRounds = Math.max(state.completedRounds, event.roundsPlayed);
      state.nextRound = state.completedRounds + 1;
      state.nextDifficulty = 'PGM';
      state.overtimeRounds = Math.max(0, state.completedRounds - 8);
      state.roundScores = scores;
      state.sessionWinner = event.winnerId;
      state.sessionScores = scores;
      state.sessionRoundsPlayed = event.roundsPlayed;
      if (state.expectedAt !== null && state.status !== 'COMPLETED') state.status = 'RESULTS_READY';
      if (state.status !== 'COMPLETED') {
        state.nextReminderAt = null;
        state.reminderBurstNextAt = null;
        state.reminderBurstRemaining = 0;
      }
      if (state.firstGameCompletedAt === null) {
        state.firstGameCompletedAt = now;
        state.firstGameDifficulty = state.firstGameDifficulty ?? event.difficulty;
        state.firstGameWinner = event.winnerId;
        state.firstGameScores = scores;
        state.firstGameRoundsPlayed = event.roundsPlayed;
      }
      changed = true;
    } else if (event.type === 'returned-to-messenger') {
      if (state.expectedAt === null || state.status !== 'RESULTS_READY') return false;
      state.status = 'COMPLETED';
      state.returnedToMessengerAt = now;
      state.nextReminderAt = null;
      state.reminderBurstNextAt = null;
      state.reminderBurstRemaining = 0;
      state.reminderBurstSequence = null;
      state.reminderBurstSalvo = null;
      state.reminderBurstMessageCount = 0;
      changed = true;
    } else if (event.type === 'reminder-sent') {
      if (state.expectedAt === null || state.status === 'COMPLETED' ||
        !Number.isSafeInteger(event.count) || event.count !== state.reminderCount + 1 ||
        !Number.isFinite(event.dueAt)) return false;
      state.reminderCount = event.count;
      state.nextReminderAt = event.dueAt;
      changed = true;
    } else if (event.type === 'reminder-scheduled') {
      if (state.expectedAt === null || state.status === 'COMPLETED' || !Number.isFinite(event.dueAt)) return false;
      if (state.nextReminderAt !== event.dueAt) {
        state.nextReminderAt = event.dueAt;
        changed = true;
      }
    } else return false;
    if (changed) this.save();
    return changed;
  }
  isBombArenaBlockingStory() {
    const state = this.data.bombArena;
    return Boolean(state?.expectedAt !== null && state?.expectedAt !== undefined && state.status !== 'COMPLETED');
  }
  acceptTransfer(key) {
    const file = this.data.files[key];
    if (!file || file.status !== 'pending' || (file.extractable === 'bomb-arena' && file.transferState !== 'proposed')) return false;
    if (file.extractable !== 'bomb-arena') return true;
    file.transferState = 'accepted';
    this.save();
    return true;
  }
  startTransfer(key, now = Date.now()) {
    const file = this.data.files[key];
    if (!file || file.status !== 'pending') return false;
    if (file.extractable !== 'bomb-arena') return true;
    if (!['accepted', 'in-progress'].includes(file.transferState)) return false;
    file.transferState = 'in-progress';
    file.transferStartedAt ??= now;
    this.save();
    return true;
  }
}
