// Optional conversations share a contact thread, but have independent narrative
// windows. Add authored dialogue IDs here; no catch-up queue is created.
export const OPTIONAL_CONVERSATIONS = Object.freeze([
  {
    id: 'k7-intro',
    contactId: 'k7',
    optional: true,
    deliveryPolicy: 'progressive',
    availableFrom: { flag: 'k7IntroductionStarted' },
    expiresAt: { sequence: 'act2-start' },
    activityGraceMs: 30_000,
  },
]);

const hasProgress = (state, choices, id) => Boolean(
  state?.transcript?.length || state?.finished || Number.isFinite(state?.receiveDueAt) ||
  choices.some((choice) => choice.dialogue === id),
);
const progressionEventReached = (progression, event) => Boolean(
  event?.sequence &&
  (progression.data.current === event.sequence || progression.data.completed.includes(event.sequence)),
);

export class OptionalConversations {
  constructor(progression, definitions, entries = OPTIONAL_CONVERSATIONS) {
    Object.assign(this, { progression, definitions, entries });
    if (!this.progression.data.optionalConversations ||
      typeof this.progression.data.optionalConversations !== 'object' ||
      Array.isArray(this.progression.data.optionalConversations)) {
      this.progression.data.optionalConversations = {};
    }
  }

  status(id) {
    return this.progression.data.optionalConversations[id]?.status ?? 'locked';
  }

  isAvailable(id) {
    const entry = this.entries.find((item) => item.id === id);
    if (!entry || this.status(id) === 'expired') return false;
    const saved = this.progression.data.dialogues[id];
    return this.status(id) !== 'locked' || hasProgress(saved, this.progression.data.choices, id);
  }

  eventsFor(contactId) {
    return this.entries
      .filter((entry) => entry.contactId === contactId && this.isAvailable(entry.id))
      .map((entry) => this.definitions[entry.id]
        ? { ...this.definitions[entry.id], deliveryPolicy: entry.deliveryPolicy }
        : null)
      .filter(Boolean);
  }

  relationship(contactId) {
    const ids = this.entries.filter((entry) => entry.contactId === contactId).map((entry) => entry.id);
    const responded = this.progression.data.choices.some((choice) => ids.includes(choice.dialogue));
    const finished = ids.some((id) => this.progression.data.dialogues[id]?.finished);
    const missed = ids.some((id) => this.status(id) === 'expired');
    return { hasReplied: responded, hasSpoken: responded, hasCompleted: finished, hasMissed: missed };
  }

  sync(now = Date.now()) {
    const states = this.progression.data.optionalConversations;
    let changed = false;
    for (const entry of this.entries) {
      const saved = this.progression.data.dialogues[entry.id];
      const state = states[entry.id] ??= { status: 'locked' };
      const previousStatus = state.status;
      const previousDueAt = state.expirationDueAt;
      if (saved?.expired) state.status = 'expired';
      if (state.status === 'expired') {
        if (previousStatus !== 'expired') changed = true;
        if (saved && !saved.expired) {
          saved.expired = true;
          delete saved.receiveDueAt;
          changed = true;
        }
        continue;
      }
      if (saved?.finished) {
        if (state.status !== 'completed') { state.status = 'completed'; changed = true; }
        continue;
      }
      if (hasProgress(saved, this.progression.data.choices, entry.id)) {
        if (state.status !== 'started') { state.status = 'started'; changed = true; }
      } else if (
        (entry.availableFrom?.flag && this.progression.data.flags[entry.availableFrom.flag] === true) ||
        progressionEventReached(this.progression, entry.availableFrom)
      ) {
        if (state.status !== 'available') { state.status = 'available'; changed = true; }
      }

      const expiredByProgress = progressionEventReached(this.progression, entry.expiresAt);
      if (!expiredByProgress) continue;
      if (state.status === 'locked') {
        state.status = 'expired';
      } else if (state.status === 'available') {
        state.status = 'expired';
      } else if (state.status === 'started') {
        const lastPlayerAt = saved?.transcript?.findLast((message) => message.speaker === 'player')?.receivedAt;
        const isRecentlyActive = Number.isFinite(lastPlayerAt) && now - lastPlayerAt <= (entry.activityGraceMs ?? 0);
        if (isRecentlyActive) {
          state.expirationDueAt = lastPlayerAt + (entry.activityGraceMs ?? 0);
          if (now >= state.expirationDueAt) state.status = 'expired';
        } else if (!Number.isFinite(state.expirationDueAt) || now >= state.expirationDueAt) {
          state.status = 'expired';
        }
      }
      if (state.status === 'expired') {
        state.expiredAt = now;
        if (saved) {
          saved.expired = true;
          delete saved.receiveDueAt;
        }
      }
      if (state.status !== previousStatus || state.expirationDueAt !== previousDueAt) changed = true;
    }
    if (changed) this.progression.save();
  }
}
