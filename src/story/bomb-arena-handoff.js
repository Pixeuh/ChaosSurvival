// Results remain a durable transition intent until the existing group window
// has actually been activated. This also lets startup retry after a reload.
export function bombArenaHandoffPending(progression) {
  const state = progression?.data?.bombArena;
  if (state?.status === 'RESULTS_READY') return Number.isFinite(state.resultsClosedAt);
  return state?.status === 'COMPLETED' && Number.isFinite(state.returnedToMessengerAt) &&
    !progression.data.dialogues?.['bomb-arena-postmatch']?.finished;
}

export function completeBombArenaHandoff({ progression, onBombArenaEvent, activateGroup }) {
  const state = progression?.data?.bombArena;
  if (!state || !['RESULTS_READY', 'COMPLETED'].includes(state.status)) return false;
  if (state.status === 'RESULTS_READY' && !Number.isFinite(state.resultsClosedAt)) return false;
  if (activateGroup?.() !== true) return false;
  if (state.status === 'COMPLETED') return true;
  const completed = onBombArenaEvent?.({ type: 'returned-to-messenger' });
  return completed === true || state.status === 'COMPLETED';
}

export function createBombArenaHandoffRetrier({
  progression,
  onBombArenaEvent,
  activateGroup,
  setTimeoutFn = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeoutFn = (id) => globalThis.clearTimeout(id),
  retryDelayMs = 1_000,
} = {}) {
  let timer = null;
  let attempting = false;
  const cancel = () => {
    if (timer === null) return false;
    clearTimeoutFn(timer);
    timer = null;
    return true;
  };
  const schedule = () => {
    if (timer !== null || !bombArenaHandoffPending(progression)) return false;
    timer = setTimeoutFn(() => {
      timer = null;
      attempt();
    }, retryDelayMs);
    return true;
  };
  const attempt = () => {
    if (attempting) return false;
    if (!bombArenaHandoffPending(progression)) {
      cancel();
      return true;
    }
    attempting = true;
    let completed = false;
    try {
      completed = completeBombArenaHandoff({ progression, onBombArenaEvent, activateGroup });
    } catch (error) {
      console.error('[BombArena] Messenger handoff failed; retrying from the saved result.', error);
    } finally {
      attempting = false;
    }
    if (!completed) schedule();
    else cancel();
    return completed;
  };
  return { attempt, schedule, cancel, get scheduled() { return timer !== null; } };
}
