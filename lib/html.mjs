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

export const url = {
  home: () => '/',
  countries: () => '/countries/',
  today: () => '/today/',
  about: () => '/about/',
  privacy: () => '/privacy/',
  compare: () => '/compare/',
  country: (code) => `/${String(code).toLowerCase()}/`,
  year: (code, year) => `/${String(code).toLowerCase()}/${year}/`,
  calculator: (code) => `/${String(code).toLowerCase()}/business-days-calculator/`,
  events: () => '/events/',
  countryEvents: (code, category = 'all') =>
    `/${String(code).toLowerCase()}/${
      { all: 'events', concerts: 'concerts', comedy: 'comedy' }[category] || 'events'
    }/`,
  /** A specific date on a country's year page. */
  holiday: (code, date) => `/${String(code).toLowerCase()}/${date.slice(0, 4)}/#${date}`,
  /** Pair URLs are alphabetical, so each pair has exactly one address. */
  pair: (a, b) => {
    const [first, second] = [String(a).toLowerCase(), String(b).toLowerCase()].sort();
    return `/compare/${first}-vs-${second}/`;
  },
  /** The interactive comparison, pre-filled. */
  compareQuery: (a, b, year) =>
    `/compare/?a=${String(a).toUpperCase()}&b=${String(b).toUpperCase()}${
      year ? `&year=${year}` : ''
    }`,
  absolute: (pathname) => `${config.url.replace(/\/$/, '')}${pathname}`,
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
    ['/countries/', 'Countries'],
    ['/compare/', 'Compare'],
    ...(sections.events ? [['/events/', "What's on"]] : []),
    ['/today/', 'Today'],
    ['/about/', 'About'],
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
    .map((src) => `<script src="${esc(src)}" defer></script>`)
    .join('');

  // Native ES modules, imported straight from the browser. The comparison page
  // runs the same modules the generator does — no bundler, no second copy of
  // the logic to drift out of sync.
  const modules = (page.modules || [])
    .map((src) => `<script type="module" src="${esc(src)}"></script>`)
    .join('');

  const year = new Date().getUTCFullYear();

  return `<!doctype html>
<html lang="en">
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
<link rel="stylesheet" href="/assets/board.css">
<link rel="icon" href="/assets/mark.svg" type="image/svg+xml">
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
    <a class="brand" href="/">${MARK}<span>${esc(config.name)}</span></a>
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
        <a href="/countries/">All countries</a>
        <a href="/today/">Holidays today</a>
        <a href="/about/">About &amp; sources</a>
        <a href="/privacy/">Privacy</a>
      </nav>
    </div>
    <p class="footer__legal">
      Data from the Nager.Date public API, with dates computed from statutory rules where the API has no entry.
      Figures are informational and not legal or payroll advice.
      &copy; ${year} ${esc(config.name)}.
    </p>
  </div>
</footer>
<script src="/assets/consent.js" defer></script>
${scripts}${modules}
</body>
</html>
`;
}
