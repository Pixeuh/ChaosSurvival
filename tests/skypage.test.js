import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { localPages } from '../src/browser/registry.js';
import {
  skyPageData,
  skyPages,
  SKY_URL,
  blogUrl,
  articleUrl,
  commentProfileUrl,
} from '../src/browser/sites/skypage/index.js';
import { BrowserSession } from '../src/browser/session.js';
import { Progression } from '../src/story/progression.js';
import { InternetAdventurer } from '../src/ui/browser.js';
import { renderError } from '../src/browser/pages/error.js';
import { renderSkyHome } from '../src/browser/sites/skypage/render.js';
const story = JSON.parse(readFileSync(new URL('../src/config/story.json', import.meta.url)));
const articleCounts = {
  pixelgirl: 6,
  luna: 5,
  sk8er_du_93: 4,
  'oo_bubble-princess_oo': 6,
  cartouchegrise: 5,
  grillepain_92: 4,
  disquette44: 6,
  padsansfil: 4,
  k7: 4,
  m0rbid: 5,
};
const walk = (node) => [node, ...(node.children ?? []).flatMap(walk)];
function dom(t) {
  const previous = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      return {
        tag,
        className: '',
        children: [],
        dataset: {},
        setAttribute() {},
        append(...nodes) {
          this.children.push(...nodes);
        },
      };
    },
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
}
test('SkyPage exposes home and ten available blog routes without narrative prerequisites', () => {
  assert.equal(skyPages.length, 11);
  for (const url of [
    'skypage.fr',
    'www.skypage.fr',
    'http://www.skypage.fr/pixelgirl',
    'skypage.fr/luna',
    'skypage.fr/sk8er_du_93',
    'skypage.fr/oo_bubble-princess_oo',
    'skypage.fr/k7',
    'skypage.fr/m0rbid',
  ])
    assert.ok(localPages.resolve(url, {}).page);
  assert.equal(localPages.resolve('skypage.fr/turbo', {}).error, 'not-found');
  assert.equal(localPages.resolve('skypage.fr/missing', {}).error, 'not-found');
  assert.deepEqual(
    skyPageData.blogs.slice(0, 4).map((blog) => blog.nickname),
    ['xX_PixelGirl_Xx', '°•.LuNa.°•', 'Sk8er_du_93', 'Oo_bubble-princess_oO'],
  );
});
test('all articles follow the requested distribution, with valid dates and MSN comment authors', () => {
  const contacts = JSON.parse(
    readFileSync(new URL('../src/config/contacts.json', import.meta.url)),
  );
  const allowedAuthors = new Set(
    contacts
      .map(
        (contact) =>
          contact.nickname ??
          JSON.parse(
            readFileSync(new URL(`../src/dialogues/${contact.dialogue}.json`, import.meta.url)),
          ).contact.nickname,
      ),
  );
  // K7's existing SkyPage comments keep the page nickname, while Messenger uses the new handle.
  allowedAuthors.add('K7');
  const images = new Set([
    './skypage/sparkle.svg',
    './skypage/heart.svg',
    './skypage/candy-sparkle.svg',
  ]);
  for (const blog of skyPageData.blogs) {
    assert.equal(blog.articles.length, articleCounts[blog.id]);
    const dates = blog.articles.map((article) => article.date);
    assert.deepEqual(dates, [...dates].sort());
    assert.equal(new Set(blog.articles.map((article) => article.id)).size, blog.articles.length);
    images.add(blog.avatar);
    for (const article of blog.articles) {
      assert.match(article.date, /^2009-\d{2}-\d{2}$/);
      assert.equal(new Date(article.date).toISOString().slice(0, 10), article.date);
      assert.ok(article.paragraphs.length > 0);
      if (article.image) images.add(article.image);
      for (const comment of article.comments) {
        assert.ok(comment.date >= article.date);
        assert.match(comment.date, /^2009-/);
        assert.ok(comment.author && comment.text);
        assert.ok(
          allowedAuthors.has(comment.author) ||
            (blog.id === 'm0rbid' &&
              article.id === 'fosse-desespoir' &&
              ['M0RBID', 'DarkAngel62', 'xxDeadDollxx'].includes(comment.author)),
          `Comment author must be an exact MSN nickname: ${comment.author}`,
        );
      }
    }
  }
  for (const path of images) {
    const file = new URL(`../public/${path.slice(2)}`, import.meta.url);
    assert.ok(existsSync(file));
    if (path.endsWith('.svg'))
      assert.doesNotMatch(readFileSync(file, 'utf8'), /<script|href=|<foreignObject/i);
    else assert.equal(readFileSync(file).subarray(0, 2).toString('hex'), 'ffd8');
  }
  assert.doesNotMatch(JSON.stringify(skyPageData), /ARCHIVE|Buddy|effacement|joueur/i);
  const pixel = skyPageData.blogs[0],
    luna = skyPageData.blogs[1];
  assert.ok(
    pixel.articles
      .flatMap((article) => article.paragraphs)
      .join(' ')
      .includes('Bring Me to Life'),
  );
  assert.ok(
    luna.articles.reduce((sum, article) => sum + article.comments.length, 0) <
      pixel.articles.reduce((sum, article) => sum + article.comments.length, 0),
  );
});
test('XD Search indexes implemented blogs with relevant results and no fabricated Turb0 blog', () => {
  for (const term of ['skypage', 'blog', 'pixelgirl', 'luna', 'dessins', 'evanescence'])
    assert.ok(localPages.search(term, {}).length > 0, term);
  assert.equal(localPages.search('PIXELGIRL', {})[0].url, `${SKY_URL}pixelgirl`);
  assert.equal(localPages.search('LUNA', {})[0].url, `${SKY_URL}luna`);
  assert.equal(localPages.search('evanescence', {})[0].url, `${SKY_URL}pixelgirl`);
  assert.equal(
    localPages
      .search('dessins', {})
      .filter((page) => page.url === `${SKY_URL}pixelgirl` || page.url === `${SKY_URL}luna`).length,
    2,
  );
  assert.ok(!localPages.search('Turb0', {}).some((page) => page.url === `${SKY_URL}turbo`));
});
test('rendered pages have only valid internal links and show articles, local graphics and comments without editing controls', (t) => {
  dom(t);
  for (const definition of skyPages) {
    const result = localPages.resolve(definition.url, {});
    const rendered = definition.render({
      url: result.url,
      data: {},
      registry: localPages,
      navigate() {},
    });
    const nodes = walk(rendered);
    const nav = nodes.find((node) => node.className === 'sky-nav');
    assert.equal(nav.children.length, 1);
    assert.equal(nav.children[0].textContent, 'Accueil');
    assert.equal(nav.children[0].dataset.browserLink, SKY_URL);
    assert.equal(
      nodes.filter((node) =>
        ['input', 'textarea', 'form', 'button', 'iframe', 'script'].includes(node.tag),
      ).length,
      0,
    );
    for (const link of nodes.filter((node) => node.tag === 'a')) {
      assert.equal(link.href, '#');
      const resolved = localPages.resolve(link.dataset.browserLink, {});
      assert.ok(resolved.page || resolved.error);
    }
    if (definition.url !== SKY_URL) {
      const blog = skyPageData.blogs.find((blog) => blogUrl(blog) === definition.url);
      assert.equal(
        nodes.filter((node) => node.className === 'sky-post').length,
        articleCounts[blog.id],
      );
      assert.ok(nodes.some((node) => node.className === 'sky-comments'));
    }
  }
  const blog = skyPageData.blogs[0],
    article = blog.articles.find((article) => article.id === 'paint');
  const route = localPages.resolve(articleUrl(blog, article), {});
  const nodes = walk(route.page.render({ url: route.url }));
  assert.equal(nodes.filter((node) => node.className === 'sky-post').length, 1);
  assert.ok(nodes.some((node) => node.src === article.image));
  assert.equal(
    nodes.filter((node) => node.className === 'sky-comment').length,
    article.comments.length,
  );
});

test('secondary blogs use exact identities, searchable themes and recent-visit/last-article integration', (t) => {
  dom(t);
  for (const [id, name, terms] of [
    ['sk8er_du_93', 'Sk8er_du_93', ['sk8er_du_93', 'skate', 'skateboard', 'kickflip', 'baskets']],
    [
      'oo_bubble-princess_oo',
      'Oo_bubble-princess_oO',
      ['oo_bubble-princess_oo', 'bonbons', 'princesse', 'mode', 'coque tÃ©lÃ©phone'],
    ],
  ]) {
    const address = `${SKY_URL}${id}`;
    const blog = skyPageData.blogs.find((blog) => blog.id === id);
    assert.equal(blog.nickname, name);
    assert.equal(localPages.resolve(address, {}).page.title, `${name} — SkyPage`);
    for (const term of terms)
      assert.ok(
        localPages.search(term, {}).some((page) => page.url === address),
        term,
      );
    for (const post of blog.articles) {
      if (post.image) assert.ok(post.image.endsWith('.jpg'));
      assert.doesNotMatch(JSON.stringify(post), /Sk8erboy|BubblePrincess|ARCHIVE|Buddy|Turb0/i);
    }
  }
  const home = localPages.resolve(SKY_URL, {}).page;
  const initial = walk(home.render({ data: {} }));
  assert.equal(initial.filter((n) => n.className === 'sky-discovery').length, 0);
  const latest = initial.filter((n) => n.className === 'sky-latest');
  assert.equal(latest.length, 4);
  const expectedLatest = skyPageData.blogs
    .filter((blog) => blog.contactId)
    .flatMap((blog) => blog.articles.map((article) => ({ blog, article })))
    .sort((a, b) => b.article.date.localeCompare(a.article.date))
    .slice(0, 4);
  assert.deepEqual(
    latest.map((n) => n.children[0].dataset.browserLink),
    expectedLatest.map(({ blog, article }) => articleUrl(blog, article)),
  );
  const visited = [blogUrl(skyPageData.blogs[3]), blogUrl(skyPageData.blogs[2])];
  const rendered = walk(home.render({ data: { browser: { recentPages: visited } } }));
  assert.deepEqual(
    rendered
      .filter((n) => n.className === 'sky-discovery')
      .map((n) => walk(n).find((n) => n.tag === 'a').dataset.browserLink),
    visited,
  );
});
test('normal browser history, tabs, restart and New Game keep static blogs available without narrative changes', () => {
  const values = new Map(),
    storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    };
  const progression = new Progression(story, storage);
  const before = JSON.stringify([
    progression.data.dialogues,
    progression.data.choices,
    progression.data.completed,
  ]);
  const browser = new BrowserSession(progression);
  browser.navigate(SKY_URL);
  browser.navigate(blogUrl(skyPageData.blogs[0]));
  browser.move(-1);
  assert.equal(browser.address, SKY_URL);
  browser.move(1);
  browser.add(blogUrl(skyPageData.blogs[1]));
  const restored = new BrowserSession(new Progression(story, storage));
  assert.deepEqual(restored.tabs, browser.tabs);
  assert.ok(localPages.resolve(restored.address, {}).page);
  assert.equal(
    JSON.stringify([
      progression.data.dialogues,
      progression.data.choices,
      progression.data.completed,
    ]),
    before,
  );
  progression.newGame();
  browser.restore();
  for (const page of skyPages) assert.ok(localPages.resolve(page.url, progression.data).page);
});

test('friends directory includes only MSN blogs and future contact blog additions without changing visits or navigation', (t) => {
  dom(t);
  const render = (data) => walk(renderSkyHome({ data: {} }, data));
  const nodes = render(skyPageData);
  const friends = nodes.find((node) => node.className === 'sky-box sky-friends');
  assert.equal(friends.children[0].textContent, 'Vos ami(e)s');
  const links = walk(friends).filter((node) => node.tag === 'a');
  assert.deepEqual(
    links.map((link) => link.textContent),
    skyPageData.blogs.filter((blog) => blog.contactId).map((blog) => blog.nickname),
  );
  assert.deepEqual(
    links.map((link) => link.dataset.browserLink),
    skyPageData.blogs.filter((blog) => blog.contactId).map(blogUrl),
  );
  assert.ok(
    links.every(
      (link) => link.href === '#' && localPages.resolve(link.dataset.browserLink, {}).page,
    ),
  );
  assert.ok(links.every((link) => !/turb0/i.test(link.textContent)));
  assert.equal(nodes.filter((node) => node.className === 'sky-discovery').length, 0);
  assert.equal(nodes.filter((node) => node.className === 'sky-latest').length, 4);
  assert.equal(nodes.find((node) => node.className === 'sky-nav').children.length, 1);
  const future = { ...skyPageData.blogs[0], id: 'future-blog', nickname: 'Future contact' };
  const expanded = render({ ...skyPageData, blogs: [...skyPageData.blogs, future] });
  const added = expanded.find((node) => node.className === 'sky-box sky-friends');
  assert.equal(walk(added).filter((node) => node.tag === 'a').length, 7);
  assert.ok(walk(added).some((node) => node.dataset?.browserLink === blogUrl(future)));
});

test('existing ForumJeu blog authors remain independent of MSN contacts', () => {
  const forum = JSON.parse(
    readFileSync(new URL('../src/browser/sites/forumjeu/data.json', import.meta.url)),
  );
  const contacts = JSON.parse(
    readFileSync(new URL('../src/config/contacts.json', import.meta.url)),
  );
  const blogs = skyPageData.blogs.filter((blog) =>
    ['cartouchegrise', 'grillepain_92', 'disquette44', 'padsansfil'].includes(blog.id),
  );
  assert.equal(blogs.length, 4);
  for (const blog of blogs) {
    const threads = forum.categories
      .flatMap((category) => category.topics)
      .filter((topic) => topic.posts.some((post) => post.author === blog.nickname));
    assert.ok(threads.length >= 2, blog.nickname);
    assert.ok(!contacts.some((contact) => contact.nickname === blog.nickname));
    const route = localPages.resolve(blogUrl(blog), {});
    assert.ok(route.page);
    assert.equal(route.page.rememberVisit, true);
    assert.ok(localPages.search(blog.nickname, {}).some((page) => page.url === blogUrl(blog)));
    assert.ok(blog.articles.length >= 4 && blog.articles.length <= 6);
    assert.doesNotMatch(JSON.stringify(blog), /\b(?:ARCHIVE|Buddy|Raph|TikTok|Discord|Turb0)\b/i);
  }
});

test('all SkyPage comment authors are links: published pages stay mapped and others resolve to local timeout pages', (t) => {
  dom(t);
  const links = new Map();
  for (const blog of skyPageData.blogs) {
    for (const article of blog.articles) {
      const route = new URL(articleUrl(blog, article));
      const root = skyPages.find((page) => page.url === blogUrl(blog)).render({ url: route });
      for (const comment of walk(root).filter((node) => node.className === 'sky-comment')) {
        const author = comment.children[0];
        assert.equal(author.tag, 'a');
        links.set(author.textContent, author.dataset.browserLink);
      }
    }
  }
  for (const [author, page] of [
    ['xX_PixelGirl_Xx', 'pixelgirl'],
    ['°•.LuNa.°•', 'luna'],
    ['Sk8er_du_93', 'sk8er_du_93'],
    ['Oo_bubble-princess_oO', 'oo_bubble-princess_oo'],
    ['K7', 'k7'],
    ['x_M0RBID_x', 'm0rbid'],
  ])
    assert.equal(links.get(author), `${SKY_URL}${page}`);
  for (const author of ['Turb0', 'LeModemEnPLS', 'M0RBID', 'DarkAngel62', 'xxDeadDollxx']) {
    const url = commentProfileUrl(author);
    assert.equal(links.get(author), url);
    assert.equal(localPages.resolve(url, {}).error, 'skypage-timeout');
    assert.equal(localPages.resolve(url, {}).page, undefined);
  }
});

test('unknown commenter URLs remain local and survive browser history and reload resolution', () => {
  const url = commentProfileUrl('xxDeadDollxx');
  const session = new BrowserSession(new Progression(story, { getItem: () => null, setItem() {} }));
  session.navigate(SKY_URL);
  session.navigate(url);
  assert.equal(localPages.resolve(session.address, {}).error, 'skypage-timeout');
  session.move(-1);
  assert.equal(session.address, SKY_URL);
  session.move(1);
  assert.equal(session.address, url);
  assert.equal(localPages.resolve(session.address, {}).error, 'skypage-timeout');
  assert.equal(localPages.resolve(session.address, {}).error, 'skypage-timeout');
  assert.ok(url.startsWith(SKY_URL));
});

test('unknown commenter error uses the requested local Internet Adventurer timeout copy', (t) => {
  dom(t);
  const root = renderError('skypage-timeout');
  const nodes = walk(root);
  assert.equal(root.className, 'browser-error browser-error-ie');
  assert.ok(nodes.some((node) => node.textContent === 'Internet Adventurer ne peut pas afficher cette page Web'));
  assert.ok(nodes.some((node) => node.textContent === 'La connexion au serveur a expiré.'));
  assert.ok(nodes.some((node) => node.textContent === 'Vérifier votre connexion Internet.'));
  assert.ok(nodes.some((node) => node.textContent === 'Actualiser cette page.'));
  assert.ok(nodes.some((node) => node.textContent === 'Réessayer ultérieurement.'));
});

test('K7 and M0RBID have searchable contact-linked SkyPages', () => {
  for (const [id, nickname] of [['k7', 'K7'], ['m0rbid', 'x_M0RBID_x']]) {
    const blog = skyPageData.blogs.find((entry) => entry.id === id);
    assert.ok(blog);
    assert.equal(blog.contactId, id);
    assert.equal(blog.nickname, nickname);
    assert.equal(blog.articles.length, id === 'm0rbid' ? 5 : 4);
    assert.ok(blog.articles.every((article) => article.date.startsWith('2009-01-')));
    assert.ok(localPages.resolve(blogUrl(blog), {}).page);
    assert.ok(localPages.search(nickname, {}).some((page) => page.url === blogUrl(blog)));
  }
  assert.ok(
    skyPageData.blogs.find((blog) => blog.id === 'k7').articles[0].comments.some((comment) =>
      comment.author === 'Turb0',
    ),
  );
});

test('M0RBID’s Harlow article is complete, chronological, and has all eight timed comments', (t) => {
  dom(t);
  const blog = skyPageData.blogs.find((entry) => entry.id === 'm0rbid');
  const article = blog.articles.find((entry) => entry.id === 'fosse-desespoir');
  assert.ok(article);
  assert.equal(article.title, 'la fosse du désespoir.');
  assert.equal(article.date, '2009-01-18');
  assert.equal(article.time, '02:43');
  assert.ok(article.paragraphs.length > 100);
  assert.equal(article.paragraphs[0], 'bon.');
  assert.equal(article.paragraphs.at(-1), 'm0rbid');
  assert.equal(article.comments.length, 8);
  assert.deepEqual(
    article.comments.map(({ author, time }) => [author, time]),
    [
      ['Turb0', '11:26'],
      ['M0RBID', '12:04'],
      ['DarkAngel62', '14:17'],
      ['M0RBID', '14:39'],
      ['K7', '19:52'],
      ['M0RBID', '20:11'],
      ['xxDeadDollxx', '00:38'],
      ['M0RBID', '01:02'],
    ],
  );
  const route = localPages.resolve(blogUrl(blog), {});
  const nodes = walk(route.page.render({ url: route.url }));
  const articleNode = nodes.find((node) => node.dataset.articleId === article.id);
  assert.ok(articleNode);
  assert.equal(
    walk(articleNode).filter((node) => node.className === 'sky-comment').length,
    8,
  );
  assert.ok(walk(articleNode).some((node) => node.textContent === '18/01/2009 à 02:43'));
  assert.ok(walk(articleNode).some((node) => node.textContent === '18/01/2009 à 11:26'));
});

test('public blogs stay searchable/directly accessible and enter recents without entering friends or latest posts', (t) => {
  dom(t);
  const publicBlogs = skyPageData.blogs.filter((blog) => !blog.contactId);
  const home = localPages.resolve(SKY_URL, {}).page;
  const nodes = walk(home.render({ data: { browser: { recentPages: publicBlogs.map(blogUrl) } } }));
  const friends = nodes.find((node) => node.className === 'sky-box sky-friends');
  const latest = nodes.filter((node) => node.className === 'sky-latest');
  const recent = nodes.filter((node) => node.className === 'sky-discovery');
  assert.equal(walk(friends).filter((node) => node.tag === 'a').length, 6);
  assert.deepEqual(
    recent.map((row) => walk(row).find((node) => node.tag === 'a').dataset.browserLink),
    publicBlogs.map(blogUrl),
  );
  for (const blog of publicBlogs) {
    assert.ok(localPages.resolve(blogUrl(blog), {}).page);
    assert.ok(localPages.search(blog.nickname, {}).some((page) => page.url === blogUrl(blog)));
    assert.ok(!walk(friends).some((node) => node.dataset?.browserLink === blogUrl(blog)));
    assert.ok(
      !latest.some((row) => row.children[0].dataset.browserLink.startsWith(`${blogUrl(blog)}?`)),
    );
  }
  const extra = { ...publicBlogs[0], id: 'not-a-contact', contactId: 'unknown' };
  const turbo = { ...publicBlogs[0], id: 'turbo', contactId: 'turbo' };
  const filtered = walk(
    renderSkyHome({ data: {} }, { ...skyPageData, blogs: [...skyPageData.blogs, extra, turbo] }),
  );
  assert.equal(
    walk(filtered.find((node) => node.className === 'sky-box sky-friends')).filter(
      (node) => node.tag === 'a',
    ).length,
    6,
  );
});

test('recent blogs are unique, newest first, persistent and reset by New Game without changing latest articles', (t) => {
  dom(t);
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const progression = new Progression(story, storage);
  const session = new BrowserSession(progression);
  const home = () => localPages.resolve(SKY_URL, {}).page.render({ data: progression.data });
  const rows = (tree) => walk(tree).filter((n) => n.className === 'sky-discovery');
  const latest = (tree) => walk(tree).filter((n) => n.className === 'sky-latest');
  const empty = home();
  assert.equal(rows(empty).length, 0);
  assert.ok(walk(empty).some((n) => n.textContent === 'Aucun blog visité récemment.'));
  const pixel = blogUrl(skyPageData.blogs[0]),
    luna = blogUrl(skyPageData.blogs[1]);
  session.recordVisit(pixel);
  assert.equal(rows(home()).length, 1);
  session.recordVisit(luna);
  session.recordVisit(pixel);
  session.recordVisit(pixel);
  assert.deepEqual(session.recentPages, [pixel, luna]);
  const populated = home();
  assert.deepEqual(
    rows(populated).map((row) => walk(row).find((n) => n.tag === 'a').dataset.browserLink),
    [pixel, luna],
  );
  assert.equal(JSON.stringify(latest(populated)), JSON.stringify(latest(empty)));
  const reopened = new BrowserSession(new Progression(story, storage));
  assert.deepEqual(reopened.recentPages, [pixel, luna]);
  reopened.close(reopened.active);
  assert.deepEqual(new BrowserSession(new Progression(story, storage)).recentPages, [pixel, luna]);
  progression.newGame();
  session.restore();
  assert.deepEqual(session.recentPages, []);
  assert.equal(rows(home()).length, 0);
  progression.data.browser = { recentPages: [null, 'javascript:alert(1)', pixel, pixel] };
  session.restore();
  assert.deepEqual(session.recentPages, [pixel]);
});

test('only successfully displayed blogs enter recents, including article visits; cancelled loads do not', async (t) => {
  dom(t);
  const progression = new Progression(story, { getItem: () => null, setItem() {} });
  const browser = new InternetAdventurer({}, {}, progression);
  browser.tabs = () => {};
  const controls = new Map();
  browser.instance = {
    element: {
      isConnected: true,
      querySelector(selector) {
        if (!controls.has(selector))
          controls.set(selector, { setAttribute() {}, replaceChildren() {} });
        return controls.get(selector);
      },
    },
  };
  t.after(() => clearTimeout(browser.timer));
  const waitForLoad = () => new Promise((resolve) => setTimeout(resolve, 250));
  browser.navigate(blogUrl(skyPageData.blogs[0]));
  browser.navigate(SKY_URL);
  await waitForLoad();
  assert.deepEqual(browser.session.recentPages, []);
  browser.navigate('skypage.fr/missing');
  await waitForLoad();
  assert.deepEqual(browser.session.recentPages, []);
  browser.navigate(blogUrl(skyPageData.blogs[1]));
  await waitForLoad();
  browser.navigate(articleUrl(skyPageData.blogs[0], skyPageData.blogs[0].articles[1]));
  await waitForLoad();
  assert.deepEqual(browser.session.recentPages, skyPageData.blogs.slice(0, 2).map(blogUrl));
  assert.deepEqual(progression.data.browser.recentPages, browser.session.recentPages);
});
