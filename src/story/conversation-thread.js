import { DialogueSession, pendingChoices, hasPendingMessages } from './dialogue.js';

// JSON dialogues are event scripts. A contact owns one durable discussion.
export class ConversationThread {
  constructor(contactId, progression, getEvents) {
    Object.assign(this, { contactId, progression, getEvents });
    this.repaired = false;
    this.sync();
  }
  get state() {
    const data = this.progression.data;
    if (
      !data.conversations ||
      typeof data.conversations !== 'object' ||
      Array.isArray(data.conversations)
    )
      data.conversations = {};
    const saved = data.conversations[this.contactId];
    const replaced = !saved || saved.version !== 1 || !Array.isArray(saved.history);
    if (replaced)
      data.conversations[this.contactId] = {
        version: 1,
        history: [],
        unread: [],
        activeEvent: null,
        pendingEvents: [],
      };
    const state = data.conversations[this.contactId];
    const originalState = JSON.stringify(state);
    const history = state.history.filter(
      (entry) =>
        typeof entry?.key === 'string' &&
        typeof entry.text === 'string' &&
        ['contact', 'player'].includes(entry.speaker),
    );
    const seen = new Set();
    state.history = history.filter((entry) => {
      if (seen.has(entry.key)) return false;
      seen.add(entry.key);
      return true;
    });
    const keys = new Set(state.history.map((entry) => entry.key));
    const unread = Array.isArray(state.unread)
      ? [...new Set(state.unread.filter((key) => typeof key === 'string' && keys.has(key)))]
      : [];
    state.unread = unread;
    if (state.activeEvent !== null && typeof state.activeEvent !== 'string') state.activeEvent = null;
    state.pendingEvents = Array.isArray(state.pendingEvents)
      ? [...new Set(state.pendingEvents.filter((id) => typeof id === 'string' && this.getEvents().some((event) => event.id === id)))]
      : [];
    if (state.activeEvent && !this.getEvents().some((event) => event.id === state.activeEvent))
      state.activeEvent = null;
    this.repaired ||= replaced || JSON.stringify(state) !== originalState;
    return data.conversations[this.contactId];
  }
  hasPendingFile(id) {
    return (this.progression.data.dialogues[id]?.transcript ?? []).some(
      (entry) =>
        entry.type === 'file' && this.progression.data.files[entry.fileKey]?.status === 'pending',
    );
  }
  get activeDefinition() {
    const events = this.getEvents();
    const pending = events.filter(
      (event) =>
        !this.progression.data.dialogues[event.id]?.finished || this.hasPendingFile(event.id),
    );
    return (
      pending.find((event) => {
        const saved = this.progression.data.dialogues[event.id];
        return !saved || saved.cursor < event.nodes[saved.node]?.messages.length;
      }) ??
      pending[0] ??
      events.findLast((event) => event.completion?.stayOnline) ??
      events.at(-1)
    );
  }
  get pendingResponses() {
    return this.getEvents()
      .map((definition) => ({
        definition,
        choices: pendingChoices(
          definition,
          this.progression.data.dialogues[definition.id],
          this.progression,
        ),
        position: this.state.history.findLastIndex((entry) => entry.eventId === definition.id),
      }))
      .filter((group) => group.choices.length)
      .sort((a, b) => a.position - b.position);
  }
  get hasPendingMessages() {
    return this.getEvents().some((definition) =>
      hasPendingMessages(
        definition,
        this.progression.data.dialogues[definition.id],
        this.progression,
      ),
    );
  }
  get availableResponses() {
    return this.hasPendingMessages ? [] : this.pendingResponses;
  }
  sync() {
    const state = this.state;
    const keys = new Set(state.history.map((entry) => entry.key));
    const added = [];
    for (const event of this.getEvents()) {
      const saved = this.progression.data.dialogues[event.id];
      for (const [index, message] of (saved?.transcript ?? []).entries()) {
        const key = `${event.id}:${saved.revision ?? 1}:${index}`;
        if (keys.has(key)) continue;
        keys.add(key);
        added.push({ ...message, key, eventId: event.id });
      }
    }
    added.sort((a, b) => (a.receivedAt ?? 0) - (b.receivedAt ?? 0));
    state.history.push(...added);
    state.unread.push(
      ...added.filter((entry) => entry.speaker === 'contact').map((entry) => entry.key),
    );
    const active = this.activeDefinition?.id ?? null;
    const pending = this.getEvents()
      .filter(
        (event) => event.id !== active && !this.progression.data.dialogues[event.id]?.finished,
      )
      .map((event) => event.id);
    const changed =
      this.repaired ||
      added.length ||
      state.activeEvent !== active ||
      JSON.stringify(state.pendingEvents) !== JSON.stringify(pending);
    state.activeEvent = active;
    state.pendingEvents = pending;
    if (changed && this.progression.hasSave && this.progression.save()) this.repaired = false;
    return state.history;
  }
  schedule(definition, now = Date.now()) {
    const session = new DialogueSession(definition, this.progression);
    const message = session.nextMessage();
    if (!message) return;
    const reactionDueAt = this.miniGameReactionDueAt(definition);
    const dueAt = Number.isFinite(session.state.receiveDueAt)
      ? Math.max(session.state.receiveDueAt, reactionDueAt ?? -Infinity)
      : Math.max(
          now + message.delayMs + message.typingMs + (message.typingPauseMs ?? 0),
          reactionDueAt ?? -Infinity,
        );
    if (session.state.receiveDueAt !== dueAt) {
      session.state.receiveDueAt = dueAt;
      session.persist();
    }
  }
  miniGameReactionDueAt(definition) {
    const reaction = this.progression.data.pendingMiniGameReaction;
    if (reaction?.dialogueId === definition.id) {
      const saved = this.progression.data.dialogues[definition.id];
      const source = this.progression.story.sequences.find(
        (sequence) => sequence.id === reaction.sequenceId,
      );
      const target = reaction.storySequenceId
        ? this.progression.story.sequences.find(
            (sequence) => sequence.id === reaction.storySequenceId,
          )
        : null;
      if (
        reaction.runId === this.progression.data.runId &&
        (!reaction.storySequenceId ||
          (this.progression.data.completed.includes(reaction.sequenceId) &&
            source?.next === target?.id &&
            target?.type === 'conversation' &&
            target.dialogue === definition.id &&
            this.progression.data.current === target.id)) &&
        !saved?.transcript?.length &&
        !(Number.isInteger(saved?.cursor) && saved.cursor > 0)
      )
        return reaction.dueAt;
      this.progression.consumeMiniGameReaction(definition.id);
      this.progression.save();
    }
    return null;
  }
  typingContacts(now = Date.now()) {
    const active = new Map();
    for (const event of this.getEvents()) {
      const state = this.progression.data.dialogues[event.id];
      const message = state && !state.finished && event.nodes[state.node]?.messages[state.cursor];
      if (!message || message.speaker !== 'contact' || !Number.isFinite(state.receiveDueAt))
        continue;
      const total = message.delayMs + message.typingMs;
      // A connection can reserve a first-message deadline outside the dialogue's
      // own delay/typing fields (for example, a 3-second post-connection wait).
      // Reuse that existing wait for a brief typing cue when the first message
      // itself has zero duration; do not move its receive deadline.
      const connectionWait = Object.values(
        this.progression.data.pendingConnectionMessages ?? {},
      ).find(
        (pending) =>
          pending.runId === this.progression.data.runId &&
          pending.dialogueId === event.id,
      );
      const receiveDueAt = Math.max(state.receiveDueAt, connectionWait?.dueAt ?? -Infinity);
      const typingEndsAt = receiveDueAt - (message.typingPauseMs ?? 0);
      const firstContactMessage =
        state.cursor === 0 && !(state.transcript ?? []).some((entry) => entry.speaker === 'contact');
      const connectionBudget =
        firstContactMessage && Number.isFinite(connectionWait?.connectedAt)
          ? Math.max(0, receiveDueAt - connectionWait.connectedAt)
          : 0;
      const fallbackTyping = Math.max(180, Math.min(900, (message.text?.length ?? 20) * 18));
      const typing = message.typingMs || Math.min(total || connectionBudget, fallbackTyping);
      if (
        now >= typingEndsAt - typing &&
        now < typingEndsAt &&
        event.contact.status !== 'Hors ligne' &&
        event.contact.online !== false
      ) {
        const author = message.author;
        if (this.contactId === 'plumber-group' && author) {
          const nickname = {
            xX_PixelGirl_Xx: 'PixelGirl',
            Turb0: 'Turb0',
            '°•.LuNa.°•': 'Luna',
          }[author];
          if (nickname) active.set(author, { id: author, nickname });
        } else {
          active.set(event.contact.id ?? event.id, event.contact);
        }
      }
    }
    if (this.contactId === 'plumber-group') {
      const order = ['xX_PixelGirl_Xx', 'Turb0', '°•.LuNa.°•'];
      return order.map((author) => active.get(author)).filter(Boolean);
    }
    return [...active.values()];
  }
  typingContact(now = Date.now()) {
    return this.typingContacts(now)[0] ?? null;
  }
  receiveScheduled(definition, now) {
    const state = this.progression.data.dialogues[definition.id];
    if (!Number.isFinite(state?.receiveDueAt)) return false;
    const session = new DialogueSession(definition, this.progression);
    let dueAt = Math.max(state.receiveDueAt, this.miniGameReactionDueAt(definition) ?? -Infinity);
    if (dueAt !== state.receiveDueAt) {
      state.receiveDueAt = dueAt;
      session.persist();
    }
    let delivered = false;
    while (session.nextMessage() && dueAt <= now) {
      if (session.state.cursor === 0)
        this.progression.consumeMiniGameReaction(definition.id);
      if (!session.deliver(now)) break;
      delivered = true;
      let transitions = 0;
      while (!session.nextMessage() && session.advance()) {
        if (++transitions >= 100) throw new Error('Automatic dialogue loop.');
      }
      const next = session.nextMessage();
      if (!next) {
        delete state.receiveDueAt;
        if (session.choices.length) session.offerChoices();
        session.persist();
        break;
      }
      dueAt += next.delayMs + next.typingMs + (next.typingPauseMs ?? 0);
      state.receiveDueAt = dueAt;
      session.persist();
    }
    return delivered;
  }
  isReceiving(id) {
    const scheduled = this.progression.data.dialogues[id];
    if (Number.isFinite(scheduled?.receiveDueAt) && !scheduled.finished) return true;
    const first = this.getEvents()[0];
    if (first?.id === id)
      return Boolean(Number.isFinite(scheduled?.receiveDueAt) && !scheduled.finished);

    const event = this.getEvents()
      .slice(1)
      .find((event) => event.id === id);
    const state = this.progression.data.dialogues[id];
    return Boolean(
      event &&
      state &&
      !state.finished &&
      state.node === event.start &&
      state.cursor < event.nodes[event.start].messages.length,
    );
  }
  receive(now = Date.now()) {
    const previousKeys = new Set(this.state.history.map((entry) => entry.key));
    const incoming = [];
    for (const event of this.getEvents()) {
      if (this.progression.data.dialogues[event.id]?.finished && !this.hasPendingFile(event.id))
        continue;
      // Receive independently of other pending choices; only replies need the UI.
      const saved = this.progression.data.dialogues[event.id];
      if (Number.isFinite(saved?.receiveDueAt)) {
        if (this.receiveScheduled(event, now)) incoming.push(event);
        continue;
      }
      if (!saved && event.incomingAt === undefined) {
        this.schedule(event, now);
        if (this.receiveScheduled(event, now)) incoming.push(event);
        continue;
      }
      if (saved) {
        const node = event.nodes[saved.node];
        if (node?.end && saved.cursor >= node.messages.length && !this.hasPendingFile(event.id)) {
          new DialogueSession(event, this.progression).advance();
        }
        if (saved.node !== event.start || saved.cursor >= event.nodes[event.start].messages.length)
          continue;
      }
      const session = new DialogueSession(event, this.progression);
      // Arrival starts at the game's deadline. Subsequent messages retain the
      // JSON's delays, even with Messenger closed or after a restart.
      let dueAt = Number.isFinite(session.state.receiveDueAt)
        ? session.state.receiveDueAt
        : (event.incomingAt ?? now) +
          event.nodes[event.start].messages
            .slice(1, session.state.cursor + 1)
            .reduce(
              (total, message) =>
                total + message.delayMs + message.typingMs + (message.typingPauseMs ?? 0),
              0,
            );
      dueAt = Math.max(dueAt, this.miniGameReactionDueAt(event) ?? -Infinity);
      let delivered = false;
      while (session.nextMessage() && dueAt <= now) {
        if (session.state.cursor === 0)
          this.progression.consumeMiniGameReaction(event.id);
        if (!session.deliver(now)) break;
        delivered = true;
        const next = session.nextMessage();
        if (next) {
          dueAt += next.delayMs + next.typingMs + (next.typingPauseMs ?? 0);
          session.state.receiveDueAt = dueAt;
          session.persist();
        }
      }
      if (!session.nextMessage()) {
        delete session.state.receiveDueAt;
        if (session.choices.length) session.offerChoices();
        session.advance();
      }
      if (delivered) incoming.push(event);
    }
    this.sync();
    this.lastIncomingMessages = this.state.history.filter((entry) => !previousKeys.has(entry.key));
    return incoming;
  }
  markRead() {
    if (!this.state.unread.length) return;
    this.state.unread = [];
    this.progression.save();
  }
  appendWizz(speaker, nickname, eventId = crypto.randomUUID(), now = Date.now()) {
    if (!['player', 'contact'].includes(speaker)) throw new Error('Expéditeur de Wizz invalide.');
    this.sync();
    const key = `wizz:${eventId}`;
    if (this.state.history.some((entry) => entry.key === key)) return null;
    const message = {
      key,
      type: 'wizz',
      speaker,
      receivedAt: now,
      text: `${nickname} vous a envoyé un wizz !`,
    };
    this.state.history.push(message);
    if (speaker === 'contact') this.state.unread.push(key);
    this.progression.save();
    return message;
  }
}
