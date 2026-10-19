const validDelay = (value) => Number.isFinite(value) && value >= 0 && value <= 30000;
const validCondition = (when) =>
  !when ||
  (typeof when.flag === 'string' && ['string', 'boolean', 'number'].includes(typeof when.equals)) ||
  (when.choice &&
    ['dialogue', 'node', 'id'].every((key) => typeof when.choice[key] === 'string') &&
    typeof when.choice.selected === 'boolean');
const validSet = (set) =>
  !set ||
  (typeof set === 'object' &&
    !Array.isArray(set) &&
    Object.entries(set).every(
      ([key, value]) =>
        !['__proto__', 'constructor', 'prototype'].includes(key) &&
        ['string', 'boolean', 'number'].includes(typeof value),
    ));
export function validateFile(file) {
  if (
    !file ||
    !/^[a-z0-9-]+$/i.test(file.id) ||
    typeof file.name !== 'string' ||
    !file.name.length ||
    typeof file.sizeLabel !== 'string' ||
    (file.launch &&
      (typeof file.launch.game !== 'string' ||
        (file.launch.sequence !== undefined && typeof file.launch.sequence !== 'string')))
  )
    throw new Error('Fichier fictif invalide.');
}
export function matches(condition, flags, choices = []) {
  if (!condition) return true;
  if (condition.choice) {
    const query = condition.choice;
    const record = choices.find(
      (item) => item.dialogue === query.dialogue && item.node === query.node,
    );
    if (!record) return false;
    return query.selected
      ? record.choice === query.id
      : Array.isArray(record.unselected) && record.unselected.some((item) => item?.id === query.id);
  }
  return flags[condition.flag] === condition.equals;
}
export function validateDialogue(dialogue) {
  if (
    dialogue.completion &&
    (typeof dialogue.completion.stayOnline !== 'boolean' ||
      (dialogue.completion.connection &&
        (typeof dialogue.completion.connection.contactId !== 'string' ||
          !validDelay(dialogue.completion.connection.delayMs))))
  )
    throw new Error('Fin de dialogue invalide.');
  if (
    dialogue.version !== 1 ||
    typeof dialogue.id !== 'string' ||
    !dialogue.contact?.nickname ||
    typeof dialogue.contact.name !== 'string' ||
    !dialogue.player?.nickname ||
    !dialogue.nodes ||
    !Object.hasOwn(dialogue.nodes, dialogue.start)
  )
    throw new Error('Dialogue invalide.');
  const choiceIds = new Set();
  for (const [id, node] of Object.entries(dialogue.nodes)) {
    for (const message of node.messages ?? [])
      if (message.type === 'file') validateFile(message.file);
    if (
      node.anomaly &&
      (node.anomaly.type !== 'unselectedEcho' ||
        !validDelay(node.anomaly.durationMs) ||
        node.anomaly.durationMs < 100 ||
        node.anomaly.durationMs > 1500)
    )
      throw new Error(`Anomalie invalide : ${id}`);
    if (
      node.transfer &&
      (typeof node.transfer.fileId !== 'string' ||
        !Object.hasOwn(dialogue.nodes, node.transfer.accept) ||
        !Object.hasOwn(dialogue.nodes, node.transfer.refuse))
    )
      throw new Error(`Transition de transfert invalide : ${id}`);
    if (
      !Array.isArray(node.messages) ||
      node.messages.some(
        (message) =>
          !['contact', 'player'].includes(message.speaker) ||
          (message.author !== undefined &&
            (message.speaker !== 'contact' || typeof message.author !== 'string' || !message.author)) ||
          (typeof message.text !== 'string' && message.type !== 'file') ||
          (message.type !== undefined && !['text', 'file', 'link'].includes(message.type)) ||
          (message.type === 'link' &&
            (typeof message.url !== 'string' ||
              !/^https?:\/\//i.test(message.url) ||
              !/^http:\/\/www\.flashzone\.fr\/jeux\/[a-z0-9-]+$/i.test(message.url))) ||
          !validDelay(message.delayMs) ||
          !validDelay(message.typingMs) ||
          (message.typingPauseMs !== undefined && !validDelay(message.typingPauseMs)) ||
          !validCondition(message.when),
      )
    )
      throw new Error(`Messages invalides : ${id}`);
    if (node.choices) {
      for (const choice of node.choices) {
        if (choiceIds.has(choice.id)) throw new Error(`Réponse dupliquée : ${choice.id}`);
        choiceIds.add(choice.id);
      }
      const ids = new Set(node.choices.map((choice) => choice.id));
      if (
        !node.choices.length ||
        ids.size !== node.choices.length ||
        node.choices.some(
          (choice) =>
            typeof choice.id !== 'string' ||
            typeof choice.text !== 'string' ||
            !Object.hasOwn(dialogue.nodes, choice.next) ||
            !validCondition(choice.when) ||
            !validSet(choice.set),
        )
      )
        throw new Error(`Réponses invalides : ${id}`);
    }
    const exits =
      Number(Boolean(node.end)) +
      Number(Boolean(node.next)) +
      Number(Boolean(node.choices)) +
      Number(Boolean(node.transfer));
    if (exits !== 1 || (node.next && !Object.hasOwn(dialogue.nodes, node.next)))
      throw new Error(`Transition invalide : ${id}`);
  }
  // Auto-transitions cannot run forever. Choice loops are also rejected to keep
  // single-use choices and saved checkpoints unambiguous for this first engine.
  const visiting = new Set(),
    visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error('Le dialogue contient une boucle.');
    if (visited.has(id)) return;
    visiting.add(id);
    const node = dialogue.nodes[id];
    // Interactive refusal loops are valid. Only automatic transitions may not loop.
    if (node.next) visit(node.next);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of Object.keys(dialogue.nodes)) visit(id);
}

export function pendingChoices(dialogue, state, progression) {
  if (state?.expired) return [];
  const node = state && dialogue.nodes[state.node];
  if (!node || state.finished || state.cursor < node.messages.length) return [];
  return (node.choices ?? []).filter((choice) =>
    matches(choice.when, progression.data.flags, progression.data.choices),
  );
}

// Empty nodes and automatic joins do not end a contact's message sequence.
export function hasPendingMessages(dialogue, state, progression) {
  if (!state || state.finished || state.expired) return false;
  const visited = new Set();
  let id = state.node;
  let cursor = state.cursor;
  while (dialogue.nodes[id] && !visited.has(id)) {
    visited.add(id);
    const node = dialogue.nodes[id];
    if (
      node.messages
        .slice(cursor)
        .some((message) => matches(message.when, progression.data.flags, progression.data.choices))
    )
      return true;
    if (
      node.end ||
      node.transfer ||
      node.choices?.some((choice) =>
        matches(choice.when, progression.data.flags, progression.data.choices),
      ) ||
      !node.next
    )
      return false;
    id = node.next;
    cursor = 0;
  }
  return false;
}

export class DialogueSession {
  constructor(dialogue, progression) {
    validateDialogue(dialogue);
    this.dialogue = dialogue;
    this.progression = progression;
    const saved = progression.data.dialogues[dialogue.id];
    if (saved && saved.revision !== (dialogue.revision ?? 1))
      progression.data.dialogueArchives[`${dialogue.id}:${saved.revision ?? 1}`] =
        structuredClone(saved);
    this.state =
      saved &&
      dialogue.nodes[saved.node] &&
      Array.isArray(saved.transcript) &&
      saved.transcript.every(
        (message) =>
          ['contact', 'player'].includes(message.speaker) &&
          typeof message.text === 'string' &&
          (message.author === undefined ||
            (message.speaker === 'contact' && typeof message.author === 'string')) &&
          (message.type !== 'file' || typeof message.fileKey === 'string'),
      ) &&
      saved.revision === (dialogue.revision ?? 1) &&
      Number.isInteger(saved.cursor) &&
      saved.cursor >= 0 &&
      saved.cursor <= dialogue.nodes[saved.node].messages.length &&
      typeof saved.finished === 'boolean'
        ? saved
        : {
            node: dialogue.start,
            cursor: 0,
            transcript: [],
            finished: false,
            revision: dialogue.revision ?? 1,
          };
    if (
      saved?.finished === true &&
      Array.isArray(saved.transcript) &&
      saved.transcript.every(
        (message) =>
          ['contact', 'player'].includes(message.speaker) &&
          typeof message.text === 'string' &&
          (message.author === undefined ||
            (message.speaker === 'contact' && typeof message.author === 'string')) &&
          (message.type !== 'file' || typeof message.fileKey === 'string'),
      )
    )
      this.state = saved;
    this.persist();
  }
  persist() {
    this.progression.data.dialogues[this.dialogue.id] = this.state;
    this.progression.save();
  }
  get node() {
    return this.dialogue.nodes[this.state.node];
  }
  nextMessage() {
    if (this.state.finished) return null;
    while (this.state.cursor < this.node.messages.length) {
      const message = this.node.messages[this.state.cursor];
      if (matches(message.when, this.progression.data.flags, this.progression.data.choices))
        return message;
      this.state.cursor++;
      this.persist();
    }
    return null;
  }
  deliver(now = Date.now()) {
    const message = this.nextMessage();
    if (!message) return null;
    const isFirstContactMessage =
      message.speaker === 'contact' &&
      !this.state.transcript.some((entry) => entry.speaker === 'contact');
    if (isFirstContactMessage) {
      const contactId = this.dialogue.contact?.id;
      const connection = this.progression.data.contactConnections?.[contactId];
      if (connection?.status === 'pending') {
        this.traceConnectionMessage('held-before-connection', {
          contactId,
          connectionDueAt: connection.dueAt,
          availableAt: now,
        });
        return null;
      }
      const pending = Object.entries(this.progression.data.pendingConnectionMessages ?? {})
        .filter(([, item]) =>
          item?.runId === this.progression.data.runId && item.dialogueId === this.dialogue.id,
        )
        .sort((a, b) => b[1].dueAt - a[1].dueAt)[0];
      if (pending) {
        const [eventId, deadline] = pending;
        if (now < deadline.dueAt) {
          this.traceConnectionMessage('held', {
            eventId,
            contactId: deadline.contactId,
            connectedAt: deadline.connectedAt ?? this.progression.data.contactConnections?.[deadline.contactId]?.connectedAt,
            dueAt: deadline.dueAt,
            availableAt: now,
          });
          return null;
        }
        this.progression.consumeConnectionMessage(this.dialogue.id);
        this.traceConnectionMessage('received', {
          eventId,
          contactId: deadline.contactId,
          connectedAt: deadline.connectedAt ?? this.progression.data.contactConnections?.[deadline.contactId]?.connectedAt,
          dueAt: deadline.dueAt,
          availableAt: deadline.dueAt,
          receivedAt: now,
          caller: new Error().stack?.split('\n')[2]?.trim(),
        });
      }
    }
    const entry = {
      speaker: message.speaker,
      text: message.text ?? message.file.name,
      receivedAt: now,
    };
    if (message.author !== undefined) entry.author = message.author;
    if (message.type === 'file') {
      const file = this.progression.receiveFile(
        message.file,
        this.dialogue.id,
        this.state.node,
        message.speaker === 'player' ? 'send' : 'receive',
        this.state.transcript.length,
      );
      entry.type = 'file';
      entry.fileKey = file.key;
    } else if (message.type === 'link') {
      entry.type = 'link';
      entry.url = message.url;
    }
    this.state.transcript.push(entry);
    this.state.cursor++;
    this.persist();
    return message;
  }
  traceConnectionMessage(action, details) {
    if (import.meta.env?.DEV)
      console.debug(`[DEV][MSN connection] ${action}`, {
        dialogueId: this.dialogue.id,
        ...details,
      });
  }
  get choices() {
    return pendingChoices(this.dialogue, this.state, this.progression);
  }
  offerChoices() {
    return this.progression.offer(this.dialogue.id, this.state.node, this.choices);
  }
  advance() {
    if (this.nextMessage() || this.state.finished) return false;
    if (this.node.end) {
      this.state.finished = true;
      this.persist();
      return false;
    }
    if (this.node.transfer) {
      const file = this.activeTransfer;
      if (!file || !['complete', 'declined'].includes(file.status)) return false;
      this.state.node =
        file.status === 'complete' ? this.node.transfer.accept : this.node.transfer.refuse;
      this.state.cursor = 0;
      this.persist();
      return true;
    }
    if (!this.node.next) return false;
    this.state.node = this.node.next;
    this.state.cursor = 0;
    this.persist();
    return true;
  }
  choose(id) {
    const offered = this.choices;
    const choice = offered.find((item) => item.id === id);
    if (!choice) throw new Error('Cette réponse n’est pas disponible.');
    this.progression.choose(this.dialogue.id, this.state.node, choice, offered);
    const key = `${this.dialogue.id}:${this.state.node}`;
    const alternative = offered.find((item) => item.id !== choice.id);
    if (this.node.anomaly && alternative && !Object.hasOwn(this.progression.data.anomalies, key)) {
      this.echo = { text: alternative.text, durationMs: this.node.anomaly.durationMs };
      this.progression.data.anomalies[key] = {
        type: 'unselectedEcho',
        choice: alternative.id,
        text: alternative.text,
      };
    }
    this.state.transcript.push({ speaker: 'player', text: choice.text, receivedAt: Date.now() });
    this.state.node = choice.next;
    this.state.cursor = 0;
    this.persist();
    return choice;
  }
  takeEcho() {
    const echo = this.echo;
    this.echo = null;
    return echo;
  }
  get activeTransfer() {
    return [...this.state.transcript]
      .reverse()
      .map((entry) => this.progression.data.files[entry.fileKey])
      .find((file) => file?.node === this.state.node && file.id === this.node.transfer?.fileId);
  }
  declineTransfer(key) {
    if (this.activeTransfer?.key !== key || this.activeTransfer.status !== 'pending') return false;
    this.activeTransfer.status = 'declined';
    if (this.activeTransfer.extractable === 'bomb-arena') this.activeTransfer.transferState = 'declined';
    this.persist();
    return true;
  }
}
