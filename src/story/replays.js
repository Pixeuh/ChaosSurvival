import { ConversationThread } from './conversation-thread.js';
export class ReplayReactions {
  constructor(progression, definitions, config) {
    Object.assign(this, { progression, definitions, config });
    progression.data.level1Launches ??= progression.data.completed.includes('arcade-1') ? 1 : 0;
    progression.data.replayReactions ??= [];
    let migrated = false;
    for (const event of progression.data.replayReactions) {
      if (event.ready || Number.isFinite(event.launchedAt)) continue;
      // Saves from the previous scheduler used a five-second deadline.
      event.launchedAt = event.dueAt - 5000;
      event.dueAt = event.launchedAt + config.delayMs;
      migrated = true;
    }
    // Retire legacy reply nodes without resetting their transcript or choice records.
    const templates = new Set([config.first, ...config.variants]);
    const savedEvents = new Map(
      progression.data.replayReactions.map((event) => [event.id, event.template]),
    );
    for (const [id, saved] of Object.entries(progression.data.dialogues)) {
      const templateId = savedEvents.get(id) ?? (templates.has(id) ? id : null);
      const template = templates.has(templateId) && definitions[templateId];
      if (!template) continue;
      const length = template.nodes[template.start].messages.length;
      if (saved.node === template.start && saved.cursor < length && !saved.finished) continue;
      if (
        saved.node !== template.start ||
        saved.cursor !== length ||
        !saved.finished ||
        saved.receiveDueAt !== undefined
      ) {
        saved.node = template.start;
        saved.cursor = length;
        saved.finished = true;
        delete saved.receiveDueAt;
        migrated = true;
      }
    }
    if (migrated) progression.save();
    this.thread = new ConversationThread('pixelgirl', progression, () => [
      ...(progression.data.unlockedConversations.includes('pixelgirl-intro') ||
      progression.data.dialogues['pixelgirl-intro']?.transcript?.length
        ? [{
            ...definitions['pixelgirl-intro'],
            incomingAt: Number.isFinite(
              progression.data.dialogues['pixelgirl-intro']?.receiveDueAt,
            )
              ? progression.data.dialogues['pixelgirl-intro'].receiveDueAt
              : Infinity,
          }]
        : []),
      ...progression.data.unlockedConversations
        .filter((id) => id !== 'pixelgirl-intro' && definitions[id]?.contact.name === 'PixelGirl')
        .map((id) => definitions[id]),
      ...(progression.data.flags.superPlombierHumorWizzesComplete === true &&
      definitions['pixelgirl-super-plombier-wizz']
        ? [definitions['pixelgirl-super-plombier-wizz']]
        : []),
      ...this.dialogues,
    ]);
  }
  get metPixelGirl() {
    return (
      this.progression.data.dialogues['pixelgirl-intro']?.transcript.some(
        (entry) => entry.speaker === 'contact',
      ) ?? false
    );
  }
  launch(now = Date.now()) {
    const data = this.progression.data;
    data.level1Launches++;
    if (this.metPixelGirl) {
      const number = data.replayReactions.length;
      const template =
        number === 0
          ? this.config.first
          : this.config.variants[(number - 1) % this.config.variants.length];
      data.replayReactions.push({
        attempt: data.level1Launches,
        template,
        id: `pixelgirl-level1-attempt-${data.level1Launches}`,
        launchedAt: now,
        dueAt: now + this.config.delayMs,
        ready: false,
      });
    }
    this.progression.save();
    return data.level1Launches;
  }
  definition(event) {
    const template = this.definitions[event.template];
    if (!template) throw new Error('Réaction de replay inconnue.');
    return { ...template, id: event.id, incomingAt: event.dueAt };
  }
  flush(now = Date.now(), { canReceive = true } = {}) {
    for (const event of this.progression.data.replayReactions) {
      if (event.ready || event.dueAt > now) continue;
      if (!this.definitions[event.template]) continue;
      event.ready = true;
      this.progression.save();
    }
    return canReceive ? this.thread.receive(now) : [];
  }
  get dialogues() {
    const registered = this.progression.data.replayReactions
      .filter((event) => event.ready && this.definitions[event.template])
      .map((event) => this.definition(event));
    // Older selectable scripts may have been saved under their template ID,
    // without a launch record. Keep their messages in the same contact history.
    const ids = new Set(this.progression.data.replayReactions.map((event) => event.id));
    const legacy = [this.config.first, ...this.config.variants]
      .filter((id) => this.progression.data.dialogues[id] && !ids.has(id) && this.definitions[id])
      .map((id) => this.definitions[id]);
    return [...legacy, ...registered];
  }
}
