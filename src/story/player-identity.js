export const PLAYER_NICKNAME_MIN_LENGTH = 3;
export const PLAYER_NICKNAME_MAX_LENGTH = 16;
export const PLAYER_NICKNAME_PATTERN = /^[^\p{Cc}\p{Cs}\u200B\u00AD\u061C\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]+$/u;
export const DEFAULT_PLAYER_NICKNAME = 'Moi';
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const LEGACY_PLAYER_IDENTITY = Object.freeze({
  nickname: 'JustMe',
  identityGender: 'boy',
  grammaticalGender: 'male',
  completed: true,
});

export function normalizePlayerNickname(value) {
  if (typeof value !== 'string') return '';
  const nickname = value.normalize('NFC').trim();
  if (!nickname || !PLAYER_NICKNAME_PATTERN.test(nickname)) return '';
  let length = 0;
  for (const _segment of graphemes.segment(nickname)) {
    if (++length > PLAYER_NICKNAME_MAX_LENGTH) return '';
  }
  return length >= PLAYER_NICKNAME_MIN_LENGTH ? nickname : '';
}

export function validatePlayerNickname(value) {
  return Boolean(normalizePlayerNickname(value));
}

export function normalizePlayerIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const nickname = normalizePlayerNickname(value.nickname);
  if (!nickname) return null;
  // Older versions stored only `gender`; retain their visible name and masculine agreement.
  const grammaticalGender = value.grammaticalGender ?? value.gender ?? 'male';
  if (!['male', 'female'].includes(grammaticalGender)) return null;
  const legacyGender = value.identityGender ?? (value.gender === 'female' ? 'girl' : value.gender === 'male' ? 'boy' : null);
  if (legacyGender !== null && !['boy', 'girl', 'neither'].includes(legacyGender)) return null;
  return {
    nickname,
    identityGender: legacyGender,
    grammaticalGender,
    completed: typeof value.completed === 'boolean' ? value.completed : legacyGender !== null,
  };
}

export function normalizePlayerIdentityPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const patch = {};
  if (Object.hasOwn(value, 'nickname')) {
    const nickname = normalizePlayerNickname(value.nickname);
    if (!nickname) return null;
    patch.nickname = nickname;
  }
  if (Object.hasOwn(value, 'identityGender')) {
    if (value.identityGender !== null && !['boy', 'girl', 'neither'].includes(value.identityGender)) return null;
    patch.identityGender = value.identityGender;
  }
  if (Object.hasOwn(value, 'grammaticalGender')) {
    if (!['male', 'female'].includes(value.grammaticalGender)) return null;
    patch.grammaticalGender = value.grammaticalGender;
  }
  if (Object.hasOwn(value, 'completed')) {
    if (typeof value.completed !== 'boolean') return null;
    patch.completed = value.completed;
  }
  return Object.keys(patch).length ? patch : null;
}

const playerTextToken = /\{player\.nickname\}|\{player\.(?:gender|grammaticalGender):([^{}|]*)\|([^{}|]*)\}/g;

// Variants are authored explicitly. This only validates template syntax; it
// never inflects words or guesses the person a sentence refers to.
export function isValidPlayerText(value) {
  if (typeof value !== 'string') return false;
  let valid = true;
  const remaining = value.replace(playerTextToken, (token, male, female) => {
    if (token !== '{player.nickname}' && (!male.trim() || !female.trim())) valid = false;
    return '';
  });
  return valid && !/\{player|player\.[\w.]+\}/i.test(remaining);
}

export function resolvePlayerText(value, identity) {
  if (!isValidPlayerText(value)) throw new Error('Texte du joueur ou variante grammaticale invalide.');
  const profile = normalizePlayerIdentity(identity) ?? {
    nickname: DEFAULT_PLAYER_NICKNAME,
    identityGender: null,
    grammaticalGender: 'male',
    completed: false,
  };
  return value.replace(
    playerTextToken,
    (token, male, female) => {
      if (token === '{player.nickname}') return profile.nickname;
      return profile.grammaticalGender === 'female' ? female : male;
    },
  );
}
