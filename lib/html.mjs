/**
 * Page shell: escaping, the document layout, SEO head tags and the ad slots.
 */

import config from '../site.config.mjs';

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Safe embedding of JSON inside a <script> element. */
export function jsonScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/-->/g, '--\\u003e');
}

/**
 * Where the site is mounted.
 *
 * Most hosts serve at the root of a domain, and then this is empty and every
 * address below is what it always was. But a GitHub Pages *project* site is
 * served from a sub-folder — `user.github.io/Repo/` — and a site that writes
 * `/assets/board.css` there loads its first page and 404s the stylesheet and
 * every link after it. Rather than forbid that host, take the mount point from
 * the configured URL and prefix every address the site generates.
 *
 * The one rule that keeps this honest: everything in `url` below returns a
 * path that already includes the base, so `absolute()` joins onto the origin
 * and never onto the configured URL, or the base would appear twice.
 */
const configured = new URL(config.url);
export const BASE = configured.pathname.replace(/\/+$/, '');
const at = (pathname) => `${BASE}${pathname}`;

export const url = {
  base: () => BASE,
  home: () => at('/'),
  countries: () => at('/countries/'),
  today: () => at('/today/'),
  about: () => at('/about/'),
  privacy: () => at('/privacy/'),
  compare: () => at('/compare/'),
  team: () => at('/team/'),
  country: (code) => at(`/${String(code).toLowerCase()}/`),
  year: (code, year) => at(`/${String(code).toLowerCase()}/${year}/`),
  calculator: (code) => at(`/${String(code).toLowerCase()}/business-days-calculator/`),
  leave: (code) => at(`/${String(code).toLowerCase()}/annual-leave-planner/`),
  events: () => at('/events/'),
  countryEvents: (code, category = 'all') =>
    at(
      `/${String(code).toLowerCase()}/${
        { all: 'events', concerts: 'concerts', comedy: 'comedy' }[category] || 'events'
      }/`,
    ),
  /** Static files under assets/, data/ and the like. */
  asset: (pathname) => at(pathname),
  /** A specific date on a country's year page. */
  holiday: (code, date) => at(`/${String(code).toLowerCase()}/${date.slice(0, 4)}/#${date}`),
  /** Pair URLs are alphabetical, so each pair has exactly one address. */
  pair: (a, b) => {
    const [first, second] = [String(a).toLowerCase(), String(b).toLowerCase()].sort();
    return at(`/compare/${first}-vs-${second}/`);
  },
  /** The interactive comparison, pre-filled. */
  compareQuery: (a, b, year) =>
    at(
      `/compare/?a=${String(a).toUpperCase()}&b=${String(b).toUpperCase()}${
        year ? `&year=${year}` : ''
      }`,
    ),
  /** Joins onto the origin: the pathname already carries the base. */
  absolute: (pathname) => `${configured.origin}${pathname}`,
};

/**
 * Some pages must carry no advertising at all. AdSense policy forbids ads on
 * error pages, and sample data should never be monetised, so those are
 * rendered inside this wrapper rather than relying on anyone remembering.
 */
let adsAllowed = true;

export function withoutAds(render) {
  adsAllowed = false;
  try {
    return render();
  } finally {
    adsAllowed = true;
  }
}

/**
 * One ad slot.
 * With no publisher ID configured this renders a dashed placeholder, so the
 * layout is visible without serving ad code from an unapproved site.
 */
export function adSlot(kind) {
  if (!adsAllowed) return '';
  const { publisherId, slots } = config.adsense;
  const slotId = slots[kind];
  const label = { leaderboard: 'Leaderboard', inArticle: 'In-article', footer: 'Footer' }[kind];

  if (!publisherId || !slotId) {
    return `<aside class="ad ad--${esc(kind)} ad--placeholder" aria-hidden="true">
      <span class="ad__label">Ad slot — ${esc(label)}</span>
      <span class="ad__hint">set adsense.publisherId and slots.${esc(kind)} in site.config.mjs</span>
    </aside>`;
  }

  const format =
    kind === 'inArticle'
      ? ' data-ad-format="fluid" data-ad-layout="in-article"'
      : ' data-ad-format="auto" data-full-width-responsive="true"';

  return `<aside class="ad ad--${esc(kind)}" aria-label="Advertisement">
    <ins class="adsbygoogle" style="display:block"
      data-ad-client="ca-${esc(publisherId)}"
      data-ad-slot="${esc(slotId)}"${format}></ins>
  </aside>`;
}

function adsenseHead() {
  const { publisherId } = config.adsense;
  if (!publisherId) return '';
  return `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-${esc(
    publisherId,
  )}" crossorigin="anonymous"></script>`;
}

/**
 * Optional sections, switched on by the build when their data exists. Event
 * listings need an API key, so the nav must not advertise pages that were
 * never generated.
 */
const sections = { events: false };

export function enableSection(name, enabled = true) {
  sections[name] = Boolean(enabled);
}

function nav(pathname) {
  const items = [
    [url.countries(), 'Countries'],
    [url.compare(), 'Compare'],
    [url.team(), 'Team'],
    ...(sections.events ? [[url.events(), "What's on"]] : []),
    [url.today(), 'Today'],
    [url.about(), 'About'],
  ];
  return items
    .map(([href, label]) => {
      const current = pathname === href ? ' aria-current="page"' : '';
      return `<a href="${href}"${current}>${label}</a>`;
    })
    .join('');
}

/** The board mark: five day cells, one of them a holiday. */
const MARK = `<span class="mark" aria-hidden="true"><i></i><i></i><i class="on"></i><i></i><i></i></span>`;

/**
 * @param {{
 *   title: string, description: string, path: string, body: string,
 *   jsonLd?: object|object[], breadcrumbs?: Array<{name: string, path: string}>,
 *   bodyClass?: string, scripts?: string[], head?: string
 * }} page
 */
export function layout(page) {
  const canonical = url.absolute(page.path);
  const structured = [];
  if (page.jsonLd) structured.push(...(Array.isArray(page.jsonLd) ? page.jsonLd : [page.jsonLd]));
  if (page.breadcrumbs?.length) {
    structured.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: page.breadcrumbs.map((crumb, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: crumb.name,
        item: url.absolute(crumb.path),
      })),
    });
  }

  const scripts = (page.scripts || [])
    .map((src) => `<script src="${esc(url.asset(src))}" defer></script>`)
    .join('');

  // Native ES modules, imported straight from the browser. The comparison page
  // runs the same modules the generator does — no bundler, no second copy of
  // the logic to drift out of sync.
  const modules = (page.modules || [])
    .map((src) => `<script type="module" src="${esc(url.asset(src))}"></script>`)
    .join('');

  const year = new Date().getUTCFullYear();

  return `<!doctype html>
<html lang="en" data-base="${esc(BASE)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(config.name)}">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(page.description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#f2efe4">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="${esc(url.asset('/assets/board.css'))}">
<link rel="icon" href="${esc(url.asset('/assets/mark.svg'))}" type="image/svg+xml">
${adsenseHead()}
${page.head || ''}
${
  structured.length
    ? `<script type="application/ld+json">${jsonScript(
        structured.length === 1 ? structured[0] : structured,
      )}</script>`
    : ''
}
</head>
<body class="${esc(page.bodyClass || '')}">
<a class="skip" href="#main">Skip to content</a>
<header class="masthead">
  <div class="wrap masthead__inner">
    <a class="brand" href="${esc(url.home())}">${MARK}<span>${esc(config.name)}</span></a>
    <nav class="nav" aria-label="Main">${nav(page.path)}</nav>
  </div>
</header>
<main id="main">
${page.body}
</main>
<footer class="footer">
  <div class="wrap">
    ${adSlot('footer')}
    <div class="footer__grid">
      <div>
        <p class="footer__brand">${MARK} ${esc(config.name)}</p>
        <p class="footer__note">${esc(config.tagline)}</p>
      </div>
      <nav class="footer__links" aria-label="Footer">
        <a href="${esc(url.countries())}">All countries</a>
        <a href="${esc(url.today())}">Holidays today</a>
        <a href="${esc(url.about())}">About &amp; sources</a>
        <a href="${esc(url.privacy())}">Privacy</a>
      </nav>
    </div>
    <p class="footer__legal">
      Data from the Nager.Date public API, with dates computed from statutory rules where the API has no entry.
      Figures are informational and not legal or payroll advice.
      &copy; ${year} ${esc(config.name)}.
    </p>
  </div>
</footer>
<script src="${esc(url.asset('/assets/consent.js'))}" defer></script>
${scripts}${modules}
</body>
</html>
`;
}
