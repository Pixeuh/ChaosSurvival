import { PLAYER_COLORS, QUICK_MESSAGES, REACTIONS } from './chat-lines.js';
import { resolvePlayerText } from '../../story/player-identity.js';

const NPC_IDS = Object.freeze(['pixelgirl', 'turbo', 'luna']);
const randomIndex = (length, rng) => Math.min(length - 1, Math.floor(Math.max(0, Math.min(0.999999, rng())) * length));

export function createBombArenaChat({ rng = Math.random, maxMessages = 120, playerNickname = 'JustMe', grammaticalGender = 'male' } = {}) {
  const player = { nickname: playerNickname, grammaticalGender };
  const byId = { justme: playerNickname, pixelgirl: 'PixelGirl', turbo: 'Turbo', luna: 'Luna' };
  const messages = [];
  const pending = [];
  const seenEvents = new Set();
  const perRound = new Map();
  let clock = 0;
  let lastDelivery = -Infinity;
  let lastScheduled = -Infinity;
  let lastHumanReply = -Infinity;
  let latestRound = 0;
  let sequence = 0;
  let disposed = false;

  function deliver(authorId, text) {
    if (disposed) return null;
    const message = { id: ++sequence, authorId, author: byId[authorId], color: PLAYER_COLORS[authorId], text, time: clock };
    messages.push(message);
    if (messages.length > maxMessages) messages.splice(0, messages.length - maxMessages);
    lastDelivery = clock;
    return message;
  }

  function enqueue(authorId, text, round, delay = 350 + rng() * 750) {
    if (disposed || !byId[authorId] || !text || !round) return false;
    text = resolvePlayerText(text, player);
    const count = perRound.get(round) ?? 0;
    if (count >= 5) return false;
    const duplicate = pending.some((item) => item.round === round && item.authorId === authorId && item.text === text) ||
      messages.slice(-8).some((item) => item.authorId === authorId && item.text === text && latestRound === round);
    if (duplicate) return false;
    perRound.set(round, count + 1);
    const dueAt = Math.max(clock + delay, lastScheduled + 1150, lastDelivery + 1150);
    lastScheduled = dueAt;
    pending.push({ authorId, text, round, dueAt });
    pending.sort((a, b) => a.dueAt - b.dueAt);
    return true;
  }

  function chooseAndQueue(authorId, pool, round, probability = 1) {
    const lines = pool?.[authorId];
    if (!lines?.length || rng() >= probability) return false;
    return enqueue(authorId, lines[randomIndex(lines.length, rng)], round);
  }

  function onGameEvent(event) {
    if (disposed || !event || !Number.isInteger(event.id) || seenEvents.has(event.id)) return;
    seenEvents.add(event.id);
    if (event.type === 'round_started') {
      latestRound = event.round;
      perRound.set(latestRound, 0);
      for (let i = pending.length - 1; i >= 0; i--) if (pending[i].round !== latestRound) pending.splice(i, 1);
      lastScheduled = Math.max(clock, lastDelivery);
      if (rng() < 0.56) chooseAndQueue(NPC_IDS[randomIndex(NPC_IDS.length, rng)], REACTIONS.roundStart, latestRound);
      return;
    }
    const round = event.round || latestRound;
    if (round !== latestRound) return;
    if (event.type === 'player_eliminated') {
      if (event.cause === 'self' && NPC_IDS.includes(event.playerId)) {
        chooseAndQueue(event.playerId, REACTIONS.eliminatedSelf, round, 0.72);
      } else if (event.eliminatedBy && event.eliminatedBy !== event.playerId) {
        if (NPC_IDS.includes(event.eliminatedBy)) {
          chooseAndQueue(event.eliminatedBy, REACTIONS.eliminatedOther, round, 0.62);
        }
        if (NPC_IDS.includes(event.playerId)) {
          chooseAndQueue(event.playerId, REACTIONS.eliminatedByPlayer, round, 0.38);
        } else if (event.playerId === 'justme') {
          chooseAndQueue(NPC_IDS[randomIndex(NPC_IDS.length, rng)], REACTIONS.humanEliminated, round, 0.57);
        }
      } else if (NPC_IDS.includes(event.playerId)) {
        const pool = event.cause === 'unknown' || event.cause === 'sudden-death'
          ? REACTIONS.eliminatedNeutral : REACTIONS.eliminatedSelf;
        chooseAndQueue(event.playerId, pool, round, event.cause === 'unknown' ? 0.35 : 0.6);
      } else if (event.playerId === 'justme') {
        chooseAndQueue(NPC_IDS[randomIndex(NPC_IDS.length, rng)], REACTIONS.humanEliminated, round, 0.48);
      }
      return;
    }
    if (event.type === 'chain_reaction') {
      if (event.bombCount >= 3) chooseAndQueue(NPC_IDS[randomIndex(NPC_IDS.length, rng)], REACTIONS.chainReaction, round, 0.48);
      return;
    }
    if (event.type === 'round_won') {
      if (!event.draw && event.playerId === 'justme') {
        chooseAndQueue(NPC_IDS[randomIndex(NPC_IDS.length, rng)], REACTIONS.humanRoundWon, round, 0.86);
      } else if (!event.draw && NPC_IDS.includes(event.playerId)) {
        chooseAndQueue(event.playerId, REACTIONS.roundWon, round, 0.82);
      } else if (event.draw) {
        chooseAndQueue(NPC_IDS[randomIndex(NPC_IDS.length, rng)], REACTIONS.roundDraw, round, 0.48);
      }
      return;
    }
    if (event.type === 'match_won') {
      if (event.playerId === 'justme') {
        for (const id of NPC_IDS) chooseAndQueue(id, REACTIONS.humanMatchWon, round, id === 'turbo' ? 0.55 : 0.4);
      } else if (NPC_IDS.includes(event.playerId)) {
        chooseAndQueue(event.playerId, REACTIONS.matchWon, round, 0.8);
        const loser = NPC_IDS.filter((id) => id !== event.playerId)[randomIndex(2, rng)];
        chooseAndQueue(loser, REACTIONS.matchLost, round, 0.35);
      }
      return;
    }
  }

  function sendPlayerMessage(messageId) {
    const option = QUICK_MESSAGES.find((item) => item.id === messageId);
    if (!option || disposed) return false;
    deliver('justme', option.text);
    if (clock - lastHumanReply >= 4500) {
      lastHumanReply = clock;
      if (rng() < 0.28) {
        const pool = REACTIONS.playerReply;
        const authorId = NPC_IDS[randomIndex(NPC_IDS.length, rng)];
        enqueue(authorId, pool[authorId][randomIndex(pool[authorId].length, rng)], latestRound);
      }
    }
    return true;
  }

  return {
    messages,
    quickMessages: QUICK_MESSAGES,
    onGameEvent,
    sendPlayerMessage,
    advance(dt) {
      if (disposed) return;
      clock += Math.max(0, Math.min(100, dt || 0));
      const item = pending[0];
      if (!item || item.dueAt > clock || item.round !== latestRound || clock - lastDelivery < 1000) return;
      pending.shift();
      deliver(item.authorId, item.text);
    },
    dispose() { disposed = true; pending.length = 0; seenEvents.clear(); },
    get pendingCount() { return pending.length; },
  };
}
