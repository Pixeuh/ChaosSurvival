import { textElement as node, internalLink as link } from '../../dom.js';
import catalog from './catalog.json' with { type: 'json' };
import { renderBubblePop } from './bubble-pop.js';
import { renderAvoidSquares } from './avoid-the-squares.js';
import { renderPixelRunner } from './pixel-runner.js';
import { renderSuperPlombierFlash } from './super-plombier-flash.js';
export const FLASH_URL = 'http://www.flashzone.fr/';
export const flashCatalog = catalog;
export const isSuperPlombierFlashUnlocked = (data) =>
  data?.flags?.superPlombierFlashUnlocked === true;
const components = {
  'bubble-pop': renderBubblePop,
  'avoid-the-squares': renderAvoidSquares,
  'pixel-runner': renderPixelRunner,
  'super-plombier-flash': renderSuperPlombierFlash,
};
function shell() {
  const root = node('section', undefined, 'flashzone');
  const header = node('header', undefined, 'flashzone-header');
  header.append(
    link(catalog.name, FLASH_URL),
    node('span', 'La pause qui dure une partie de plus !'),
  );
  root.append(header);
  return root;
}
function gameCard(game) {
  const card = node('article', undefined, 'flashzone-card'),
    image = node('img');
  if (!/^\.\/flashzone\/[a-z0-9-]+\.svg$/.test(game.thumbnail))
    throw new Error('Invalid local thumbnail');
  image.src = game.thumbnail;
  image.alt = game.title;
  const thumbnail = link(undefined, game.route);
  thumbnail.append(image);
  card.append(thumbnail, link(game.title, game.route));
  return card;
}
export function renderFlashHome({ data } = {}) {
  const root = shell();
  root.append(node('p', catalog.description));
  const grid = node('div', undefined, 'flashzone-grid');
  for (const game of catalog.games) {
    if (game.id === 'super-plombier-flash' && !isSuperPlombierFlashUnlocked(data)) continue;
    grid.append(gameCard(game));
  }
  root.append(grid);
  return root;
}
export const flashPages = [
  {
    url: FLASH_URL,
    title: catalog.name,
    description: catalog.description,
    keywords: ['flashzone', 'jeux flash', 'jeux gratuits', '2009'],
    render: renderFlashHome,
  },
  ...catalog.games.map((game) => {
    if (!components[game.component]) throw new Error('Unknown local game component');
    return {
      url: game.route,
      title: `${game.title} — ${catalog.name}`,
      description: game.description,
      keywords: ['flashzone', 'jeux flash', 'jeux gratuits', ...game.keywords],
      ...(game.id === 'super-plombier-flash'
        ? { available: isSuperPlombierFlashUnlocked }
        : {}),
      preserveOnTabSwitch: ['pixel-runner', 'super-plombier-flash'].includes(game.component),
      render(context) {
        const root = shell();
        const gameContext = game.component === 'super-plombier-flash'
          ? {
              ...context,
              onStart: () => context.onSuperPlombierStart?.(),
              onVictory: () => context.onSuperPlombierVictory?.(),
            }
          : context;
        const gameView = components[game.component](gameContext, game);
        root.append(link('Accueil FlashZone', FLASH_URL), gameView);
        if (game.component === 'super-plombier-flash') {
          root.finish = gameView.finish;
          Object.defineProperty(root, 'finished', { get: () => gameView.finished });
          Object.defineProperty(root, 'running', { get: () => gameView.running });
        }
        if (import.meta.env?.DEV) {
          const finishForDevelopment = gameView.finishForDevelopment ?? gameView.finish;
          if (typeof finishForDevelopment === 'function')
            root.finishForDevelopment = () => finishForDevelopment.call(gameView);
        }
        return root;
      },
    };
  }),
];
