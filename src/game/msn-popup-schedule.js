export const ORIGINAL_MSN_POPUP_COUNT = 18;
export const CERISE_POPUP_INDEX = 18;
export const JUST_A_BOY_POPUP_INDEX = 19;
export const MELODY_POPUP_INDEX = 20;

export function selectMsnPopupIndex(elapsed, duration, quarterCounts, random = Math.random) {
  const quarter = Math.min(3, Math.max(0, Math.floor((elapsed / duration) * 4)));
  const count = quarterCounts[quarter] ?? 0;
  quarterCounts[quarter] = count + 1;
  if (quarter === 1 && count === 0) return CERISE_POPUP_INDEX;
  if (quarter === 1 && count === 1) return MELODY_POPUP_INDEX;
  if (quarter === 2 && count === 0) return JUST_A_BOY_POPUP_INDEX;
  return Math.floor(random() * ORIGINAL_MSN_POPUP_COUNT);
}
