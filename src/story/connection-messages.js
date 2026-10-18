function firstMessageDuration(definition) {
  const first = definition.nodes[definition.start]?.messages?.[0];
  return first
    ? first.delayMs + first.typingMs + (first.typingPauseMs ?? 0)
    : null;
}

export class ConnectionMessages {
  constructor(progression, definitions, config, getThread) {
    Object.assign(this, { progression, definitions, config, getThread });
    this.progression.data.pendingConnectionMessages ??= {};
  }

  delay(event) {
    const delay = event?.firstMessageDelayMs ?? this.config.defaultFirstMessageDelayMs ?? 3000;
    return Number.isFinite(delay) && delay >= 0 ? delay : 3000;
  }

  delayFor(eventId) {
    return this.delay(this.config.events?.[eventId]);
  }

  eventReady(event) {
    const data = this.progression.data;
    if (event.requiresFlag && data.flags[event.requiresFlag] !== true) return false;
    if (
      event.requiresFinishedDialogue &&
      data.dialogues[event.requiresFinishedDialogue]?.finished !== true
    ) return false;
    return true;
  }

  schedule(eventId, connectedAt, minimumDueAt) {
    const event = this.config.events?.[eventId];
    const definition = event && this.definitions[event.dialogueId];
    const thread = event && this.getThread(event.threadId);
    const duration = definition && firstMessageDuration(definition);
    if (
      !event || !definition || !thread || duration === null ||
      !this.eventReady(event) ||
      (event.requiresUnlockedDialogue &&
        !this.progression.data.unlockedConversations.includes(definition.id))
    ) return false;

    const saved = this.progression.data.dialogues[definition.id];
    if (saved?.finished || saved?.transcript?.length) {
      this.progression.consumeConnectionMessage(definition.id);
      return false;
    }

    const pending = this.progression.data.pendingConnectionMessages;
    const existing = pending[eventId];
    const connection = this.progression.data.contactConnections?.[event.contactId];
    const savedConnectionAt = connection?.connectedAt ?? connection?.dueAt;
    const startAt = Number.isFinite(connectedAt)
      ? connectedAt
      : Number.isFinite(savedConnectionAt)
        ? savedConnectionAt
        : null;
    const calculatedDueAt = Math.max(
      Number.isFinite(startAt) ? startAt + this.delay(event) : -Infinity,
      Number.isFinite(minimumDueAt) ? minimumDueAt : -Infinity,
      Number.isFinite(saved?.receiveDueAt) ? saved.receiveDueAt : -Infinity,
    );
    const dueAt = existing?.runId === this.progression.data.runId &&
      existing.dialogueId === definition.id
      ? Math.max(existing.dueAt, minimumDueAt ?? -Infinity, saved?.receiveDueAt ?? -Infinity)
      : Number.isFinite(calculatedDueAt)
        ? calculatedDueAt
        : Date.now() + this.delay(event);
    const connectedAtForSave = existing?.runId === this.progression.data.runId &&
      existing.dialogueId === definition.id
      ? existing.connectedAt ?? startAt ?? (Number.isFinite(minimumDueAt) ? minimumDueAt - this.delay(event) : undefined)
      : startAt;
    const next = {
      runId: this.progression.data.runId,
      contactId: event.contactId,
      dialogueId: definition.id,
      dueAt,
      ...(Number.isFinite(connectedAtForSave) ? { connectedAt: connectedAtForSave } : {}),
    };
    if (JSON.stringify(pending[eventId]) !== JSON.stringify(next)) {
      pending[eventId] = next;
      this.progression.save();
      if (import.meta.env?.DEV)
        console.debug('[DEV][MSN connection] scheduled', {
          eventId,
          contactId: event.contactId,
          connectedAt: startAt,
          dueAt,
        });
    }
    thread.schedule(definition, dueAt - duration);
    return true;
  }

  connect(contactId, connectedAt) {
    let scheduled = false;
    for (const [eventId, event] of Object.entries(this.config.events ?? {}))
      if (event.contactId === contactId)
        scheduled = this.schedule(eventId, connectedAt) || scheduled;
    return scheduled;
  }

  restorePending() {
    for (const [eventId, pending] of Object.entries(
      this.progression.data.pendingConnectionMessages ?? {},
    )) {
      if (pending.runId !== this.progression.data.runId) {
        delete this.progression.data.pendingConnectionMessages[eventId];
        this.progression.save();
        continue;
      }
      this.schedule(eventId, undefined, pending.dueAt);
    }
  }

  restoreOnline(now = Date.now()) {
    for (const [eventId, event] of Object.entries(this.config.events ?? {})) {
      const connection = this.progression.data.contactConnections?.[event.contactId];
      if (connection?.status !== 'online') continue;
      if (this.progression.data.pendingConnectionMessages?.[eventId]) continue;
      this.schedule(eventId, connection.connectedAt ?? connection.dueAt ?? now);
    }
  }
}
