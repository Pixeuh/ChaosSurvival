// Completion effects use saved deadlines, so closing MSN or the app cannot lose them.
export class DialogueEvents {
  constructor(
    progression,
    definitions,
    onConnection = () => {},
    { deferredConnectionDialogues = [] } = {},
  ) {
    Object.assign(this, { progression, definitions, onConnection });
    this.deferredConnectionDialogues = new Set(deferredConnectionDialogues);
  }
  update(now = Date.now(), notify = true) {
    const data = this.progression.data;
    for (const sequence of this.progression.story.sequences) {
      const definition = this.definitions[sequence.dialogue];
      if (!definition?.completion || !data.dialogues[definition.id]?.finished) continue;
      if (data.current === sequence.id)
        this.progression.complete(sequence.id, { dialogue: definition.id });
      if (!data.completed.includes(sequence.id)) continue;
      const connection = definition.completion.connection;
      if (!connection || this.deferredConnectionDialogues.has(definition.id)) continue;
      data.contactConnections ??= {};
      if (!data.contactConnections[connection.contactId]) {
        data.contactConnections[connection.contactId] = {
          status: 'pending',
          dueAt: now + connection.delayMs,
        };
        this.progression.save();
      }
    }
    const sequencedDialogues = new Set(
      this.progression.story.sequences.map((sequence) => sequence.dialogue),
    );
    for (const definition of Object.values(this.definitions)) {
      if (
        sequencedDialogues.has(definition.id) ||
        !definition.completion?.connection ||
        this.deferredConnectionDialogues.has(definition.id) ||
        !data.dialogues[definition.id]?.finished
      )
        continue;
      const connection = definition.completion.connection;
      data.contactConnections ??= {};
      if (!data.contactConnections[connection.contactId]) {
        data.contactConnections[connection.contactId] = {
          status: 'pending',
          dueAt: now + connection.delayMs,
        };
        this.progression.save();
      }
    }
    for (const [id, connection] of Object.entries(data.contactConnections ?? {})) {
      if (
        !notify ||
        connection?.status !== 'pending' ||
        !Number.isFinite(connection.dueAt) ||
        connection.dueAt > now
      )
        continue;
      connection.status = 'online';
      connection.connectedAt = now;
      this.progression.save();
      this.onConnection(id, now);
    }
  }
  triggerConnection(contactId, now = Date.now(), notify = true) {
    const deferred = [...this.deferredConnectionDialogues]
      .map((id) => this.definitions[id]?.completion?.connection)
      .find((connection) => connection?.contactId === contactId);
    if (!deferred) return false;
    const data = this.progression.data;
    data.contactConnections ??= {};
    if (['online', 'pending'].includes(data.contactConnections[contactId]?.status)) return false;
    data.contactConnections[contactId] = {
      status: 'pending',
      dueAt: now + deferred.delayMs,
    };
    this.progression.save();
    this.update(now, notify);
    return true;
  }
}
