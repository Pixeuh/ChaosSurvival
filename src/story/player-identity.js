export const PLAYER_NICKNAME_MIN_LENGTH = 3;
export const PLAYER_NICKNAME_MAX_LENGTH = 16;
export const PLAYER_NICKNAME_PATTERN = /^[A-Za-z0-9]{3,16}$/;
export const DEFAULT_PLAYER_NICKNAME = 'Moi';
export const LEGACY_PLAYER_IDENTITY = Object.freeze({
  nickname: 'JustMe',
  identityGender: 'boy',
  grammaticalGender: 'male',
  completed: true,
});

export function normalizePlayerNickname(value) {
  return typeof value === 'string' && PLAYER_NICKNAME_PATTERN.test(value) ? value : '';
}

export function validatePlayerNickname(value) {
  return Boolean(normalizePlayerNickname(value));
}

export function normalizePlayerIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const nickname = normalizePlayerNickname(value.nickname) ||
    (typeof value.nickname === 'string' && value.nickname.length <= 32 &&
      value.nickname.trim() && !/[\u0000-\u001f\u007f-\u009f]/.test(value.nickname)
      ? value.nickname.trim()
      : '');
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
