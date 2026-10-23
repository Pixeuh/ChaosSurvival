import { PLAYER_COLORS } from './player-colors.js';
export { PLAYER_COLORS };

export const QUICK_MESSAGES = Object.freeze([
  { id: 'gg', text: 'gg' },
  { id: 'laugh', text: 'mdrrrr' },
  { id: 'well-played', text: 'bien joué' },
  { id: 'unexpected', text: "c'était pas prévu ça" },
  { id: 'nice', text: 'joli !' },
  { id: 'good-luck', text: 'bonne chance' },
]);

export const REACTIONS = Object.freeze({
  roundStart: {
    turbo: ['bon allez jvous démonte', 'cette fois c’est la bonne'],
    pixelgirl: ['gooooo :DDD', 'bonne chanceee'],
    luna: ['allez', 'c’est parti'],
  },
  eliminatedSelf: {
    turbo: ['MAIS PTDR', 'c’était pas prévu ça'],
    pixelgirl: ['OUPS MDRRR', 'bon bah rip moi'],
    luna: ['j’ai été stupide.', 'ah.'],
  },
  eliminatedOther: {
    turbo: ['MDRRRR NOOB', 'TROP FACILE'],
    pixelgirl: ['AHAHAHA', 'pardon mdrrrr'],
    luna: ['bien joué quand même', 'désolée'],
  },
  eliminatedByPlayer: {
    turbo: ['ça compte pas', 'bien joué…'],
    pixelgirl: ['NOOOON', 'PTDRRR'],
    luna: ['ah mince', 'j’aurais dû faire attention'],
  },
  eliminatedNeutral: {
    turbo: ['bon…', 'j’ai rien pu faire mdrr'],
    pixelgirl: ['bon bah rip moi', 'ah mince'],
    luna: ['ah.', 'bon.'],
  },
  humanEliminated: {
    turbo: ['ouh joli', 'rip {player.nickname}'],
    pixelgirl: ['NOOOON :(', 'ça va {player.nickname} ?'],
    luna: ['ah.', 'bien joué quand même'],
  },
  chainReaction: {
    turbo: ['OHHHH'], pixelgirl: ['PTDRRR LE BORDEL'], luna: ['ah oui quand même'],
  },
  roundWon: {
    turbo: ['EASY', 'gg quand même'], pixelgirl: ['bien jouééé', 'YESSS'], luna: ['joli', 'bien joué'],
  },
  matchWon: {
    turbo: ['CHAMPION', 'bon ok bien joué'], pixelgirl: ['GG LE CHAMPION :DDD', 'quelle partie !!'], luna: ['mérité', 'gg'],
  },
  playerReply: {
    turbo: ['merci merci', 'normal'], pixelgirl: ['PTDRRR', 'hehe :3'], luna: [':) ', 'merci'],
  },
  humanRoundWon: {
    turbo: ['gg {player.nickname}', 'ok joli'], pixelgirl: ['GGGG :DDD', 'bien jouééé'], luna: ['joli', 'gg'],
  },
  humanMatchWon: {
    turbo: ['bon ok bien joué', 'j’étais pas prêt'], pixelgirl: ['GG {player.nickname} :DDD', 'quelle partie !!'], luna: ['mérité', 'gg'],
  },
  roundDraw: {
    pixelgirl: ['match nul mdrr', 'on recommence ?'], turbo: ['personne gagne ?', 'ça compte pas'], luna: ['égalité', 'hm'],
  },
  matchLost: {
    turbo: ['ouais bon ça va'], pixelgirl: ['bien jouééé'], luna: ['mérité'],
  },
});
