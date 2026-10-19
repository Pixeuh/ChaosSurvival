// Results remain a durable transition intent until the existing group window
// has actually been activated. This also lets startup retry after a reload.
export function bombArenaHandoffPending(progression) {
  const state = progression?.data?.bombArena;
  if (state?.status === 'RESULTS_READY') return true;
  return state?.status === 'COMPLETED' && Number.isFinite(state.returnedToMessengerAt) &&
    !progression.data.dialogues?.['bomb-arena-postmatch']?.finished;
}

export function completeBombArenaHandoff({ progression, onBombArenaEvent, activateGroup }) {
  const state = progression?.data?.bombArena;
  if (!state || !['RESULTS_READY', 'COMPLETED'].includes(state.status)) return false;
  if (activateGroup?.() !== true) return false;
  if (state.status === 'COMPLETED') return true;
  const completed = onBombArenaEvent?.({ type: 'returned-to-messenger' });
  return completed === true || state.status === 'COMPLETED';
}
