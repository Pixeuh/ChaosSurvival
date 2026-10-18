import { DialogueSession, pendingChoices } from './dialogue.js';
import { bombArenaRedownloadDialogue } from './bomb-arena.js';

const SUPER_PLOMBIER_GROUP_REST_MS = 20_000;
const PIXELGIRL_REPLY_REMINDER_DELAYS_MS = [20_000, 15_000, 10_000];
const PIXELGIRL_HUMOR_WIZZ_DELAYS_MS = [20_000, 10_000, 8_000];
export const DEFERRED_CONNECTION_DIALOGUES = Object.freeze(['pixelgirl-smiley-victory']);

// Scene-specific rules sit here; dialogue timing and persistence remain owned
// by DialogueEvents, DialogueSession, and ConversationThread.
export class NarrativeOrchestrator {
  constructor({
    progression,
    definitions,
    dialogueEvents,
    getContact,
    prepareContact,
    ensureBackground = () => {},
    showConnectionNotification,
    sendWizz = () => false,
    getGroupThread = () => null,
    getTurboThread = () => null,
    onTurboMessage = () => {},
    showGroupNotification = () => false,
    onGroupMessage = () => {},
    virtualFilesystem = null,
    connectionMessages = null,
    now = () => Date.now(),
  }) {
    Object.assign(this, {
      progression,
      definitions,
      dialogueEvents,
      getContact,
      prepareContact,
      ensureBackground,
      showConnectionNotification,
      sendWizz,
      getGroupThread,
      getTurboThread,
      onTurboMessage,
      showGroupNotification,
      onGroupMessage,
      virtualFilesystem,
      connectionMessages,
      now,
    });
    if (Number.isFinite(this.flags.turboSmileyScene3MessageNotificationDueAt)) {
      delete this.flags.turboSmileyScene3MessageNotificationDueAt;
      this.progression.save();
    }
    this.migrateSuperPlombierDialogue();
    this.migratePixelGirlWizzDialogue();
    this.migrateTurboSmileyDialogue();
    this.migrateSuperPlombierGroupDialogue();
    this.restoreSuperPlombierFlashUnlock();
    if (
      this.flags.superPlombierPixelCase === 'A' &&
      this.flags.superPlombierWizzCount === 3 &&
      !this.flags.superPlombierHumorWizzesComplete
    ) {
      this.flags.superPlombierHumorWizzesComplete = true;
      this.progression.save();
    }
    this.restoreLegacyTurboArrival();
  }

  get flags() {
    return this.progression.data.flags;
  }

  bombArenaRedownloadEvents() {
    const group = this.definitions['pixelgirl-super-plombier-group'];
    if (!group) return [];
    return Object.keys(this.progression.data.dialogues)
      .map((id) => /^bomb-arena-redownload-(\d+)$/.exec(id))
      .filter(Boolean)
      .sort((a, b) => Number(a[1]) - Number(b[1]))
      .map(([id]) => bombArenaRedownloadDialogue(id, group));
  }

  scheduleBombArenaRedownload() {
    const group = this.definitions['pixelgirl-super-plombier-group'];
    const thread = group && this.getGroupThread();
    if (!thread) return null;
    const events = this.bombArenaRedownloadEvents();
    const nextIndex = events.reduce((max, event) => {
      const value = Number(event.id.slice('bomb-arena-redownload-'.length));
      return Math.max(max, value);
    }, 0) + 1;
    const definition = bombArenaRedownloadDialogue(`bomb-arena-redownload-${nextIndex}`, group);
    thread.sync();
    thread.schedule(definition, this.now());
    new DialogueSession(definition, this.progression).persist();
    return definition;
  }

  onBombArenaTransferDeclined(file, dialogueId) {
    const recognizedDialogue =
      dialogueId === 'pixelgirl-super-plombier-group' ||
      /^bomb-arena-redownload-\d+$/.test(dialogueId ?? '');
    if (
      file?.extractable !== 'bomb-arena' ||
      file.status !== 'declined' ||
      !recognizedDialogue
    ) return false;
    const scheduledKey = `bombArenaRefusalReoffer:${file.key}`;
    if (this.flags[scheduledKey]) return false;
    const definition = this.scheduleBombArenaRedownload();
    if (!definition) return false;
    this.flags[scheduledKey] = true;
    this.progression.save();
    return true;
  }

  onVirtualFilesDeleted(change) {
    if (change?.origin !== 'manual' || !Array.isArray(change.removedFileIds)) return false;
    const bombArenaIds = new Set([
      'downloads/bombarena.zip',
      'downloads/bombarena',
      'bomb-arena-folder/bombarena.exe',
    ]);
    if (!change.removedFileIds.some((id) => bombArenaIds.has(id))) return false;
    if (
      this.virtualFilesystem?.exists('downloads/bombarena.zip') ||
      this.virtualFilesystem?.exists('bomb-arena-folder/bombarena.exe')
    ) return false;

    const group = this.definitions['pixelgirl-super-plombier-group'];
    const thread = group && this.getGroupThread();
    if (!thread) return false;
    const events = this.bombArenaRedownloadEvents();
    if (events.some((event) => {
      const state = this.progression.data.dialogues[event.id];
      return state && !state.finished;
    })) return false;
    return Boolean(this.scheduleBombArenaRedownload());
  }

  sendNarrativeWizz(contactId, eventId, speaker, now) {
    const key = `wizz:${eventId}`;
    if (this.progression.data.conversations?.[contactId]?.history?.some((entry) => entry.key === key))
      return true;
    return this.sendWizz(contactId, eventId, speaker, now);
  }

  migrateSuperPlombierDialogue() {
    const definition = this.definitions['turbo-super-plombier'];
    const saved = this.progression.data.dialogues[definition?.id];
    if (!definition || !saved || saved.revision === (definition.revision ?? 1)) return;
    const oldRevision = saved.revision ?? 1;
    this.progression.data.dialogueArchives[`${definition.id}:${oldRevision}`] ??=
      structuredClone(saved);
    if (saved.node === 'pixelgirl-wizz') {
      saved.node = 'common';
      saved.cursor = definition.nodes.common.messages.length;
      saved.finished = true;
      delete saved.receiveDueAt;
    }
    saved.revision = definition.revision ?? 1;

    const conversation = this.progression.data.conversations?.turbo;
    const history = conversation?.history;
    if (Array.isArray(history)) {
      const keyMap = new Map();
      for (let index = 0; index < saved.transcript.length; index++) {
        const oldKey = `${definition.id}:${oldRevision}:${index}`;
        const newKey = `${definition.id}:${saved.revision}:${index}`;
        keyMap.set(oldKey, newKey);
        const entry = history.find((message) => message.key === oldKey);
        if (entry) entry.key = newKey;
      }
      if (Array.isArray(conversation.unread))
        conversation.unread = conversation.unread.map((key) => keyMap.get(key) ?? key);
    }
    if (Object.hasOwn(this.flags, 'superPlombierTurboMigratedFinishAt'))
      delete this.flags.superPlombierTurboMigratedFinishAt;
    this.progression.save();
  }

  restoreSuperPlombierFlashUnlock() {
    if (this.flags.superPlombierFlashUnlocked) return;
    const transcript = this.progression.data.dialogues['turbo-flashzone-invitation']?.transcript;
    const linkSent = transcript?.some(
      (message) =>
        message.type === 'link' &&
        message.url === 'http://www.flashzone.fr/jeux/super-plombier-flash',
    );
    if (linkSent || this.flags.superPlombierFirstCompletion) {
      this.flags.superPlombierFlashUnlocked = true;
      this.progression.save();
    }
  }

  migratePixelGirlWizzDialogue() {
    const definition = this.definitions['pixelgirl-super-plombier-wizz'];
    const saved = this.progression.data.dialogues[definition?.id];
    if (!definition || !saved || saved.revision === (definition.revision ?? 1) || saved.finished) return;
    const oldRevision = saved.revision ?? 1;
    this.progression.data.dialogueArchives[`${definition.id}:${oldRevision}`] ??=
      structuredClone(saved);
    saved.revision = definition.revision ?? 1;

    const conversation = this.progression.data.conversations?.pixelgirl;
    if (Array.isArray(conversation?.history)) {
      const keyMap = new Map();
      for (let index = 0; index < (saved.transcript ?? []).length; index++) {
        const oldKey = `${definition.id}:${oldRevision}:${index}`;
        const newKey = `${definition.id}:${saved.revision}:${index}`;
        keyMap.set(oldKey, newKey);
        const entry = conversation.history.find((message) => message.key === oldKey);
        if (entry) entry.key = newKey;
      }
      if (Array.isArray(conversation.unread))
        conversation.unread = conversation.unread.map((key) => keyMap.get(key) ?? key);
    }
    this.progression.save();
  }

  migrateTurboSmileyDialogue() {
    const definition = this.definitions['turbo-smiley-catcher'];
    const saved = this.progression.data.dialogues[definition?.id];
    if (!definition || !saved || saved.revision === (definition.revision ?? 1) || saved.finished) return;
    const oldRevision = saved.revision ?? 1;
    this.progression.data.dialogueArchives[`${definition.id}:${oldRevision}`] ??=
      structuredClone(saved);
    saved.revision = definition.revision ?? 1;

    const conversation = this.progression.data.conversations?.turbo;
    if (Array.isArray(conversation?.history)) {
      const keyMap = new Map();
      for (let index = 0; index < saved.transcript.length; index++) {
        const oldKey = `${definition.id}:${oldRevision}:${index}`;
        const newKey = `${definition.id}:${saved.revision}:${index}`;
        keyMap.set(oldKey, newKey);
        const entry = conversation.history.find((message) => message.key === oldKey);
        if (entry) entry.key = newKey;
      }
      if (Array.isArray(conversation.unread))
        conversation.unread = conversation.unread.map((key) => keyMap.get(key) ?? key);
    }
    this.progression.save();
  }

  migrateSuperPlombierGroupDialogue() {
    const definition = this.definitions['pixelgirl-super-plombier-group'];
    const saved = this.progression.data.dialogues[definition?.id];
    if (!definition || !saved || saved.revision === (definition.revision ?? 1)) return;
    const oldRevision = saved.revision ?? 1;
    this.progression.data.dialogueArchives[`${definition.id}:${oldRevision}`] ??=
      structuredClone(saved);
    if (saved.node === 'opening' && saved.finished && definition.nodes.a) {
      saved.node = 'a';
      saved.cursor = 0;
      saved.finished = false;
      delete saved.receiveDueAt;
    }
    if (saved.node === 'h' && saved.finished && definition.nodes['bomb-arena-intro']) {
      saved.node = 'bomb-arena-intro';
      saved.cursor = 0;
      saved.finished = false;
      delete saved.receiveDueAt;
    }
    saved.revision = definition.revision ?? 1;

    const conversation = this.progression.data.conversations?.['plumber-group'];
    const history = conversation?.history;
    if (Array.isArray(history)) {
      const keyMap = new Map();
      for (let index = 0; index < (saved.transcript ?? []).length; index++) {
        const oldKey = `${definition.id}:${oldRevision}:${index}`;
        const newKey = `${definition.id}:${saved.revision}:${index}`;
        keyMap.set(oldKey, newKey);
        const entry = history.find((message) => message.key === oldKey);
        if (entry) entry.key = newKey;
      }
      if (Array.isArray(conversation.unread))
        conversation.unread = conversation.unread.map((key) => keyMap.get(key) ?? key);
    }
    this.progression.save();
  }

  restoreLegacyTurboArrival() {
    const flags = this.flags;
    if (
      !flags.turboSmileyScene3ArrivalTriggered &&
      (flags.turboSmileyScene3Opened ||
        flags.turboSmileyScene3Notified ||
        this.progression.data.contactConnections?.turbo?.status === 'online' ||
        (flags.turboSmileyScene3 &&
          this.progression.data.dialogues['pixelgirl-smiley-victory']?.finished))
    ) {
      flags.turboSmileyScene3ArrivalTriggered = true;
      this.progression.save();
    }
  }

  onContactOpened(contact) {
    if (contact.id === 'plumber-group') {
      this.flags.superPlombierGroupNotified = true;
      this.progression.save();
    }
    if (contact.id === 'turbo' && this.flags.superPlombierPostStarted) {
      this.flags.superPlombierTurboOpened = true;
      this.progression.save();
    }
    if (contact.id !== 'turbo' || !this.flags.turboSmileyScene3ArrivalTriggered) return;
    this.flags.turboSmileyScene3Opened = true;
    delete this.flags.turboSmileyScene3MessageNotificationDueAt;
    this.progression.save();
  }

  onChoiceValidated(definition, { nodeId }) {
    if (
      definition.id === 'pixelgirl-smiley-victory' &&
      this.flags.superPlombierPixelCase === 'B' &&
      this.flags.pixelGirlReplyReminderStarted &&
      !this.flags.pixelGirlReplyReminderStopped
    ) {
      this.flags.pixelGirlReplyReminderStopped = true;
      delete this.flags.pixelGirlReplyReminderDueAt;
      this.progression.save();
    }
    if (
      definition.id === 'pixelgirl-smiley-victory' &&
      nodeId === definition.start &&
      !this.flags.turboSmileyScene3ArrivalTriggered
    ) {
      this.flags.turboSmileyScene3ArrivalTriggered = true;
      this.progression.save();
      this.dialogueEvents.triggerConnection('turbo', this.now());
    }
    if (
      definition.id === 'pixelgirl-super-plombier-wizz' &&
      nodeId === definition.start &&
      ['A', 'B'].includes(this.flags.superPlombierPixelCase) &&
      this.progression.data.choices.some(
        (choice) => choice.key === `${definition.id}:${nodeId}` && choice.choice === 'wizz',
      ) &&
      !this.flags.pixelGirlSuperPlombierPlayerWizzSent
    ) {
      this.flags.pixelGirlSuperPlombierPlayerWizzSent = Boolean(
        this.sendNarrativeWizz(
          'pixelgirl',
          'pixelgirl-super-plombier-player-wizz',
          'player',
          this.now(),
        ),
      );
      this.progression.save();
    }
  }

  onSuperPlombierStart() {
    this.flags.superPlombierStartedAt ??= this.now();
    this.progression.save();
  }

  onSuperPlombierVictory() {
    if (this.flags.superPlombierPostStarted) return false;
    this.onSuperPlombierStart();
    this.flags.superPlombierPixelCase = this.isDialogueFinished(
      'pixelgirl-smiley-victory',
      'bon jreviens :3',
    )
      ? 'A'
      : 'B';
    this.flags.superPlombierPostStarted = true;
    this.flags.superPlombierWizzCount = 0;
    delete this.flags.superPlombierHumorWizzesComplete;
    delete this.flags.superPlombierHumorWizzesStarted;
    delete this.flags.superPlombierNextWizzAt;
    this.progression.deferMiniGameReaction(
      'flashzone:super-plombier-flash',
      'turbo-super-plombier',
      this.now(),
    );
    return true;
  }

  prepareSuperPlombierTurbo() {
    if (!this.flags.superPlombierPostStarted) return;
    const definition = this.definitions['turbo-super-plombier'];
    if (!definition) return;
    const saved = this.progression.data.dialogues[definition.id];
    if (saved?.finished || saved?.transcript?.length || Number.isFinite(saved?.receiveDueAt)) return;
    const contact = this.getContact('turbo');
    if (!contact?.available) return;
    this.prepareContact(contact)?.thread.schedule(definition, this.now());
  }

  isDialogueFinished(dialogueId, finalMessage) {
    const state = this.progression.data.dialogues[dialogueId];
    const node = state && this.definitions[dialogueId]?.nodes[state.node];
    return (
      state?.finished === true &&
      node?.end === true &&
      state.cursor >= node.messages.length &&
      state.transcript?.at(-1)?.text === finalMessage
    );
  }

  updateSuperPlombierWizzes(now) {
    if (!this.flags.superPlombierPostStarted) return;
    const pixelState = this.progression.data.dialogues['pixelgirl-smiley-victory'];
    if (!this.isDialogueFinished('pixelgirl-smiley-victory', 'bon jreviens :3')) {
      if (this.flags.superPlombierPixelCase === 'B' && Number.isFinite(this.flags.superPlombierNextWizzAt)) {
        delete this.flags.superPlombierNextWizzAt;
        this.progression.save();
      }
      return;
    }
    let count = this.flags.superPlombierWizzCount ?? 0;
    if (!Number.isInteger(count) || count < 0 || count > PIXELGIRL_HUMOR_WIZZ_DELAYS_MS.length) count = 0;
    if (count === PIXELGIRL_HUMOR_WIZZ_DELAYS_MS.length) {
      const changed =
        this.flags.superPlombierHumorWizzesComplete !== true ||
        Number.isFinite(this.flags.superPlombierNextWizzAt);
      this.flags.superPlombierHumorWizzesComplete = true;
      delete this.flags.superPlombierNextWizzAt;
      if (changed) this.progression.save();
      return;
    }
    let dueAt = this.flags.superPlombierNextWizzAt;
    if (!this.flags.superPlombierHumorWizzesStarted) {
      if (count === 0) {
        dueAt = (pixelState.transcript.at(-1)?.receivedAt ?? now) + PIXELGIRL_HUMOR_WIZZ_DELAYS_MS[0];
      } else {
        const lastWizz = this.progression.data.conversations?.pixelgirl?.history?.findLast((entry) =>
          entry.key === 'wizz:pixelgirl-super-plombier-wizz-' + count,
        );
        dueAt = (lastWizz?.receivedAt ?? pixelState.transcript.at(-1)?.receivedAt ?? now) +
          (PIXELGIRL_HUMOR_WIZZ_DELAYS_MS[count] ?? 0);
      }
      this.flags.superPlombierHumorWizzesStarted = true;
      this.flags.superPlombierNextWizzAt = dueAt;
      this.progression.save();
    } else if (!Number.isFinite(dueAt)) {
      dueAt = (pixelState.transcript.at(-1)?.receivedAt ?? now) + PIXELGIRL_HUMOR_WIZZ_DELAYS_MS[0];
      this.flags.superPlombierNextWizzAt = dueAt;
      this.progression.save();
    }
    while (count < PIXELGIRL_HUMOR_WIZZ_DELAYS_MS.length && now >= dueAt) {
      const sent = this.sendNarrativeWizz(
        'pixelgirl',
        'pixelgirl-super-plombier-wizz-' + (count + 1),
        'contact',
        dueAt,
      );
      if (!sent) return;
      count++;
      this.flags.superPlombierWizzCount = count;
      if (count < PIXELGIRL_HUMOR_WIZZ_DELAYS_MS.length) {
        dueAt += PIXELGIRL_HUMOR_WIZZ_DELAYS_MS[count];
        this.flags.superPlombierNextWizzAt = dueAt;
      } else {
        delete this.flags.superPlombierNextWizzAt;
        this.flags.superPlombierHumorWizzesComplete = true;
      }
      this.progression.save();
    }
  }

  updatePixelGirlReplyReminders(now) {
    if (
      !this.flags.superPlombierPostStarted ||
      this.flags.superPlombierPixelCase !== 'B' ||
      this.flags.pixelGirlReplyReminderStopped
    )
      return;
    const definition = this.definitions['pixelgirl-smiley-victory'];
    const state = this.progression.data.dialogues[definition?.id];
    if (!definition || !state) return;
    if (state.finished) {
      if (Number.isFinite(this.flags.pixelGirlReplyReminderDueAt)) {
        delete this.flags.pixelGirlReplyReminderDueAt;
        this.flags.pixelGirlReplyReminderStopped = true;
        this.progression.save();
      }
      return;
    }
    const choices = pendingChoices(definition, state, this.progression);
    if (!choices.length) return;

    if (
      !this.flags.pixelGirlReplyReminderStarted &&
      this.progression.data.choices.some((choice) => choice.key?.startsWith(definition.id + ':'))
    ) {
      this.flags.pixelGirlReplyReminderStopped = true;
      this.progression.save();
      return;
    }

    let count = this.flags.pixelGirlReplyReminderCount ?? 0;
    if (!Number.isInteger(count) || count < 0 || count > 3) count = 0;
    let dueAt = this.flags.pixelGirlReplyReminderDueAt;
    if (!this.flags.pixelGirlReplyReminderStarted) {
      const lastMessageAt = state.transcript.at(-1)?.receivedAt ?? now;
      this.flags.pixelGirlReplyReminderStarted = true;
      dueAt = lastMessageAt + PIXELGIRL_REPLY_REMINDER_DELAYS_MS[0];
      this.flags.pixelGirlReplyReminderDueAt = dueAt;
      this.progression.save();
    }
    while (count < 3 && Number.isFinite(dueAt) && now >= dueAt) {
      if (
        !this.sendNarrativeWizz(
          'pixelgirl',
          'pixelgirl-super-plombier-reminder-' + (count + 1),
          'contact',
          dueAt,
        )
      )
        return;
      count++;
      this.flags.pixelGirlReplyReminderCount = count;
      if (count < 3) {
        dueAt += PIXELGIRL_REPLY_REMINDER_DELAYS_MS[count];
        this.flags.pixelGirlReplyReminderDueAt = dueAt;
      } else {
        delete this.flags.pixelGirlReplyReminderDueAt;
        this.flags.pixelGirlReplyReminderStopped = true;
      }
      this.progression.save();
    }
  }

  updatePixelGirlWizzBrawl(now) {
    if (
      !['A', 'B'].includes(this.flags.superPlombierPixelCase) ||
      this.flags.pixelGirlSuperPlombierPlayerWizzSent !== true
    )
      return;
    const state = this.progression.data.dialogues['pixelgirl-super-plombier-wizz'];
    const wizzReply = state?.transcript?.findLast((message) =>
      ['BATAILLE DE WIZZ !!!', 'bataille de wizz !!!!'].includes(message.text),
    );
    if (!wizzReply) return;
    let count = this.flags.pixelGirlSuperPlombierReplyWizzCount ?? 0;
    if (!Number.isInteger(count) || count < 0 || count > 2) count = 0;
    let dueAt = this.flags.pixelGirlSuperPlombierReplyWizzDueAt;
    if (!Number.isFinite(dueAt)) {
      dueAt = (wizzReply.receivedAt ?? now) + 600;
      this.flags.pixelGirlSuperPlombierReplyWizzDueAt = dueAt;
      this.progression.save();
    }
    while (count < 2 && now >= dueAt) {
      if (
        !this.sendNarrativeWizz(
          'pixelgirl',
          `pixelgirl-super-plombier-battle-${count + 1}`,
          'contact',
          dueAt,
        )
      )
        return;
      count++;
      this.flags.pixelGirlSuperPlombierReplyWizzCount = count;
      if (count < 2) {
        dueAt += 900;
        this.flags.pixelGirlSuperPlombierReplyWizzDueAt = dueAt;
      } else delete this.flags.pixelGirlSuperPlombierReplyWizzDueAt;
      this.progression.save();
    }
  }

  pixelGirlPostDialogueFinished() {
    return (
      this.isDialogueFinished('pixelgirl-smiley-victory', 'bon jreviens :3') &&
      this.isDialogueFinished('pixelgirl-super-plombier-wizz', 'allez bisousss :3')
    );
  }

  updateGroup(now) {
    if (!this.flags.superPlombierPostStarted) return;
    const turboFinished = this.isDialogueFinished('turbo-super-plombier', 'allez a+');
    const pixelFinished = this.pixelGirlPostDialogueFinished();
    if (!this.flags.superPlombierGroupCreated) {
      if (
        (!turboFinished || !pixelFinished) &&
        Number.isFinite(this.flags.superPlombierGroupRestDueAt)
      ) {
        delete this.flags.superPlombierGroupRestDueAt;
        this.progression.save();
      }
      if (turboFinished && pixelFinished) {
        let changed = false;
        let turboEndedAt = this.progression.data.dialogues['turbo-super-plombier']?.transcript?.at(-1)?.receivedAt;
        if (!Number.isFinite(turboEndedAt)) {
          turboEndedAt = this.flags.superPlombierTurboFinishedAt ?? now;
          this.flags.superPlombierTurboFinishedAt = turboEndedAt;
          changed = true;
        }
        const pixelId = 'pixelgirl-super-plombier-wizz';
        let pixelEndedAt = this.progression.data.dialogues[pixelId]?.transcript?.at(-1)?.receivedAt;
        if (!Number.isFinite(pixelEndedAt)) {
          pixelEndedAt = this.flags.superPlombierPixelGirlFinishedAt ?? now;
          this.flags.superPlombierPixelGirlFinishedAt = pixelEndedAt;
          changed = true;
        }
        const expectedDueAt =
          Math.max(turboEndedAt, pixelEndedAt) + SUPER_PLOMBIER_GROUP_REST_MS;
        if (this.flags.superPlombierGroupRestDueAt !== expectedDueAt) {
          this.flags.superPlombierGroupRestDueAt = expectedDueAt;
          changed = true;
        }
        if (changed) this.progression.save();
      }
      if (
        Number.isFinite(this.flags.superPlombierGroupRestDueAt) &&
        turboFinished &&
        pixelFinished &&
        now >= this.flags.superPlombierGroupRestDueAt
      ) {
        this.flags.superPlombierGroupCreated = true;
        this.flags.superPlombierGroupCreatedAt = now;
        this.progression.save();
      }
    }
    if (!this.flags.superPlombierGroupCreated) return;
    const definition = this.definitions['pixelgirl-super-plombier-group'];
    const thread = definition && this.getGroupThread();
    if (!thread) return;
    const state = this.progression.data.dialogues[definition.id];
    if (!state?.transcript?.length && !Number.isFinite(state?.receiveDueAt) && typeof thread.schedule === 'function')
      thread.schedule(definition, this.flags.superPlombierGroupCreatedAt ?? now);
    else if (typeof thread.schedule === 'function' && state && !state.finished && !Number.isFinite(state.receiveDueAt)) {
      const session = new DialogueSession(definition, this.progression);
      if (!session.node.transfer && session.nextMessage()) thread.schedule(definition, now);
    }
    const incoming = thread.receive(now) ?? [];
    if (incoming.length)
      this.onGroupMessage(this.getContact('plumber-group'), incoming, thread.lastIncomingMessages ?? []);
    if (!this.flags.superPlombierGroupNotified) {
      const accepted = this.showGroupNotification(this.getContact('plumber-group'));
      if (accepted) {
        this.flags.superPlombierGroupNotified = true;
        this.progression.save();
      }
    }
  }

  onContactConnected(contactId, connectedAt, { notify = true, notificationOptions } = {}) {
    const contact = this.getContact(contactId);
    if (!contact) return;
    if (notify) this.showConnectionNotification(contactId, notificationOptions);
    if (!this.connectionMessages?.connect(contactId, connectedAt)) return;

    // First-message typing is scheduled before a conversation window necessarily
    // exists. Attach the owning thread's normal minimized view so the shared
    // typing indicator can render during its existing deadline.
    const events = this.connectionMessages.config?.events ?? {};
    const pending = this.progression.data.pendingConnectionMessages ?? {};
    const threadIds = new Set(
      Object.entries(events)
        .filter(([eventId, event]) =>
          event.contactId === contactId &&
          pending[eventId]?.runId === this.progression.data.runId,
        )
        .map(([, event]) => event.threadId),
    );
    for (const threadId of threadIds) {
      const threadContact = this.getContact(threadId);
      if (threadContact) this.ensureBackground(threadContact);
    }
  }

  prepareSuperPlombierInvitation() {
    const flags = this.flags;
    const eventId = 'luna-invitation-after-connection';
    const saved = this.progression.data.dialogues['turbo-flashzone-invitation'];
    if (!Number.isFinite(flags.superPlombierInvitationDueAt) || saved?.transcript?.length || saved?.finished)
      return;
    const delay = this.connectionMessages?.delayFor(eventId) ?? 3000;
    if (flags.superPlombierInvitationDelayVersion !== 3) {
      const previousDelay = flags.superPlombierInvitationDelayVersion === 2 ? 10_000 : 5000;
      flags.superPlombierInvitationDueAt += delay - previousDelay;
      flags.superPlombierInvitationDelayVersion = 3;
    }
    this.connectionMessages?.schedule(
      eventId,
      flags.superPlombierInvitationDueAt - delay,
      flags.superPlombierInvitationDueAt,
    );
    delete flags.superPlombierInvitationDueAt;
    if (Number.isFinite(this.progression.data.dialogues['turbo-flashzone-invitation']?.receiveDueAt)) {
      flags.superPlombierInvitationScheduled = true;
      this.progression.save();
    }
  }

  onMessage(contact, incoming = []) {
    if (contact.id === 'turbo') {
      if (
        incoming.some((event) => event.id === 'turbo-smiley-catcher') &&
        this.flags.turboSmileyScene3ArrivalTriggered &&
        !this.flags.turboSmileyScene3Opened &&
        !this.flags.turboSmileyScene3Notified
      ) {
        this.flags.turboSmileyScene3Notified = true;
        this.progression.save();
        return 'turbo-smiley-scene3';
      }
      if (
        this.flags.superPlombierPostStarted &&
        this.progression.data.dialogues['turbo-super-plombier']?.transcript?.length &&
        !this.flags.superPlombierTurboOpened &&
        !this.flags.superPlombierTurboNotified
      ) {
        this.flags.superPlombierTurboNotified = true;
        this.progression.save();
        return 'super-plombier';
      }
      if (this.progression.data.dialogues['turbo-flashzone-invitation']?.transcript?.length) {
        if (!this.flags.superPlombierInvitationNotificationShown) {
          this.flags.superPlombierInvitationNotificationShown = true;
          this.progression.save();
          return 'notify';
        }
        return 'handled';
      }
      if (this.flags.turboSmileyScene3ArrivalTriggered) return 'handled';
    }
    return false;
  }

  isConversationUnlocked(dialogueId) {
    return (
      this.progression.data.unlockedConversations.includes(dialogueId) ||
      (dialogueId === 'turbo-smiley-catcher' && this.flags.turboSmileyScene3ArrivalTriggered) ||
      (dialogueId === 'pixelgirl-super-plombier-wizz' &&
        ['A', 'B'].includes(this.flags.superPlombierPixelCase) &&
        this.flags.superPlombierHumorWizzesComplete === true) ||
      (dialogueId === 'pixelgirl-super-plombier-group' &&
        this.flags.superPlombierGroupCreated === true)
    );
  }

  onLink(url) {
    if (url !== 'http://www.flashzone.fr/jeux/super-plombier-flash') return;
    this.flags.superPlombierOpenedFromInvite = true;
    this.progression.save();
  }

  isEventAvailable(event) {
    if (event.id === 'turbo-flashzone-invitation') {
      const saved = this.progression.data.dialogues[event.id];
      return (
        this.progression.data.contactConnections?.luna?.status === 'online' &&
        (this.flags.superPlombierInvitationScheduled === true ||
          this.flags.superPlombierInvitationReceived === true ||
          Number.isFinite(saved?.receiveDueAt) ||
          Boolean(saved?.transcript?.length) ||
          saved?.finished === true)
      );
    }
    if (event.id === 'turbo-super-plombier') return this.flags.superPlombierPostStarted === true;
    if (event.id === 'pixelgirl-super-plombier-wizz')
      return ['A', 'B'].includes(this.flags.superPlombierPixelCase) && this.flags.superPlombierHumorWizzesComplete === true;
    return event.id !== 'pixelgirl-super-plombier-group' || this.flags.superPlombierGroupCreated === true;
  }

  compareEvents(a, b) {
    const order = {
      'turbo-smiley-catcher': 0,
      'turbo-flashzone-invitation': 1,
      'turbo-super-plombier': 2,
    };
    return (order[a.id] ?? 10) - (order[b.id] ?? 10);
  }

  afterMessengerUpdate(now = this.now()) {
    this.restoreSuperPlombierFlashUnlock();
    if (
      !this.flags.superPlombierInvitationReceived &&
      this.progression.data.dialogues['turbo-flashzone-invitation']?.transcript?.length
    ) {
      this.flags.superPlombierInvitationReceived = true;
      this.progression.save();
    }
  }

  update(now = this.now(), notify = true) {
    this.prepareSuperPlombierInvitation();
    this.connectionMessages?.restorePending();
    this.dialogueEvents.update(now, notify);
    this.connectionMessages?.restoreOnline(now);
    const turboDefinition = this.definitions['turbo-smiley-catcher'];
    const turboState = turboDefinition && this.progression.data.dialogues[turboDefinition.id];
    const turboThread = turboState && this.getTurboThread();
    if (turboThread && Number.isFinite(turboState.receiveDueAt) && !turboState.finished) {
      const previousKeys = new Set(turboThread.state.history.map((message) => message.key));
      const received = turboThread.receiveScheduled(turboDefinition, now);
      if (received) {
        const history = turboThread.sync();
        const messages = history.filter((message) => !previousKeys.has(message.key));
        this.onTurboMessage(this.getContact('turbo'), [turboDefinition], messages);
      }
    }
    this.prepareSuperPlombierTurbo();
    this.updateSuperPlombierWizzes(now);
    this.updatePixelGirlReplyReminders(now);
    this.updatePixelGirlWizzBrawl(now);
    this.updateGroup(now);
  }

}
