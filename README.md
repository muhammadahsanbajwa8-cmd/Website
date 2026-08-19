# Holiday Board

A static site that publishes public holiday calendars and working-day counts for
every country with open data, and rebuilds itself every night.

No accounts, no database, no server, no CMS, and no hand-written country content
— a build script turns open data into a few thousand HTML pages. It earns
through Google AdSense.

```
node build.mjs             # fetch, cache, generate
node build.mjs --offline   # generate with no network at all
```

- **Runtime dependencies: none.** Plain ESM on Node 20+. `npm install` installs
  nothing, because there is nothing to install.
- **Output: a `dist/` folder** of HTML, CSS and JS. Deploy it to Cloudflare
  Pages, Netlify, GitHub Pages, or any static host.

---

## Run it

```bash
npm test              # the date, fallback, data-source and rendering suites
npm run build         # live build: Nager.Date API, cached to .cache/
npm run build:offline # no network: cache first, then computed rules
npm run serve         # serve dist/ on http://localhost:8080
npm run preview       # bundle dist/ into a single shareable dist/preview.html
npm run events:check  # confirm real event listings are reachable with your key
npm run adsense:check # scan the build for what gets AdSense applications rejected
```

`npm run preview` folds the whole build — every page, all 1,595 of them — into
one self-contained HTML file you can open, mail, or drop into a message, with no
server and no network. The pages are stored gzipped and unpacked in the browser
with DecompressionStream, which takes 47 MB of markup down to under 3 MB. Each page
keeps its own markup; the stylesheet, webfonts, scripts, ES modules and country
data are stored once and composed into an iframe as you navigate, so the real
CSS and media queries apply. Links, the calculator, the finder and the
comparison all work, and the frame adds a page picker plus light/dark and
desktop/mobile switches. Fonts are embedded on the first run and cached in
`.cache/`; with no network it falls back to linking them.

The build prints what it used:

```
Holiday Board — building 2025–2030
  countries listed: 110
  data resolved: 110 countries · live 660 · cache 0 · computed 0
  total pages:   890
```

`live` came from the API, `cache` from `.cache/`, `computed` from the statutory
rules in `lib/fallback.mjs`. A build that shows `computed` where you expected
`live` means the network or the upstream API was unavailable — the site still
generated, which is the point.

## Configure it

Everything a deployer changes is in **`site.config.mjs`**. Nothing else in the
codebase should need editing to deploy.

| Setting | What it does |
| --- | --- |
| `name`, `tagline` | Site identity, used in the masthead, titles and footer |
| `url` | Canonical origin, no trailing slash. Wrong value = wrong canonical tags, wrong sitemap, wrong Open Graph URLs |
| `contactEmail` | Shown on `/about/` and `/privacy/` |
| `featured` | Country codes on the home page |
| `years.back` / `years.ahead` | The published year range, relative to the current year |
| `events.apiKeyEnv` | Environment variable holding the Ticketmaster key. No key, no event pages |
| `events.countries` | Limit event lookups to these codes; empty means every published country |
| `events.windowDays` / `perCategory` | How far ahead to look, and how many to keep per stream |
| `adsense.publisherId` | `pub-…` (the `ca-` prefix is added for you). Empty = placeholder boxes, no ad code |
| `adsense.slots` | Slot IDs for the leaderboard, in-article and footer positions |
| `apiBase`, `cacheDir`, `outDir` | Data source, cache location, output folder |

## Deploy it

**New to this? Read [DEPLOY.md](DEPLOY.md)** — it walks from an unmerged branch
to a live site on your own domain, step by step.

One constraint to know up front: every link and asset is written from the domain
root, so the site must be served at the root of a domain or subdomain —
`example.com` or `site.pages.dev`, **not** `example.com/site`. A GitHub Pages
*project* site is a sub-folder, so it loads the first page and then 404s the
stylesheet and every link; it needs a custom domain. Cloudflare Pages and
Netlify give you a root URL for free. The build prints a warning if `url` has a
path in it.

The generator writes a plain directory of files. Build command `npm run build`,
publish directory `dist`, Node 20.

| Host | Settings |
| --- | --- |
| **Cloudflare Pages** | Build command `npm run build`, output directory `dist`, environment variable `NODE_VERSION=20` |
| **Netlify** | Build command `npm run build`, publish directory `dist`, `NODE_VERSION=20` |
| **GitHub Pages** | Use the included workflow — it uploads `dist/` as a Pages artifact |

Two workflows ship in `.github/workflows/`:

- **`ci.yml`** — runs the tests and an offline build on every push and pull
  request. The offline build is the one that must never break.
- **`nightly.yml`** — a daily cron (03:17 UTC) that rebuilds and deploys. This
  is what keeps `/today/` correct and publishes next year's pages by itself.
  It deploys to GitHub Pages out of the box; Cloudflare and Netlify replacements
  for the deploy job are commented at the bottom of the file.

The nightly job caches `.cache/` between runs, so an upstream outage degrades to
yesterday's data rather than to an empty site.

### Trailing slashes

Every page is written as `index.html` inside a directory (`/de/2026/index.html`),
so the URLs work identically on all three hosts with no redirect rules.

## Getting AdSense approved

Order matters. Applying with placeholder boxes and thin pages is the usual way
to get rejected.

1. **Deploy to a real domain first.** A custom domain you own, on HTTPS, with
   content already live. Not a preview URL.
2. **Set `url` in `site.config.mjs`** to that domain and rebuild, so canonicals,
   Open Graph tags and the sitemap all point at the live site.
3. **Leave `adsense.publisherId` empty** for now. The layout renders dashed
   placeholder boxes, so you can see the ad geometry without serving ad code
   from an unapproved property.
4. **Submit the sitemap** (`/sitemap.xml`) in Google Search Console and let the
   site get indexed. Review is much smoother once pages are in the index.
5. **Check `/about/` and `/privacy/` read correctly** for your deployment —
   AdSense reviewers look for both, and the privacy page must accurately
   describe the ad cookies, the Google Fonts request, and what the calculator
   does with your input. Update `contactEmail` so the contact route is real.
6. **Apply to AdSense**, then add the site and verify ownership.
7. **On approval**, set `adsense.publisherId` (and the three slot IDs from your
   AdSense account) in `site.config.mjs` and rebuild. `ads.txt` is generated
   from the publisher ID automatically — no manual file to maintain.
8. **Confirm `https://yourdomain/ads.txt`** returns
   `google.com, pub-…, DIRECT, f08c47fec0942fa0`. AdSense warns about a missing
   ads.txt within a day or two of activation.

Run `npm run adsense:check` before you apply, and again after approval. It
reads the built site and reports the mechanical things a reviewer sees first:

- placeholder `url` or `contactEmail` still in `site.config.mjs` — these would
  fail a review on their own, because canonical tags and the sitemap would
  point at a domain you do not own;
- ads on the 404 page, which is against policy: an error page has no content of
  its own to justify them;
- ads on any `noindex` page — a page not fit to index is not fit to monetise;
- sample event listings left in the build by `--events-demo`, which must never
  reach a site carrying ads;
- pages that carry ads but little text;
- `ads.txt` disagreeing with the publisher ID, a blocking `robots.txt`, a
  missing sitemap, `noindex` pages leaking into the sitemap, and a privacy page
  that fails to mention AdSense, cookies or the opt-out route.

It sorts what it finds into three kinds, and the distinction is what lets it
gate a deploy without also preventing one:

- **FIX** — a policy violation in the build itself: ads on the 404 page, sample
  listings, a blocking `robots.txt`, `ads.txt` disagreeing with the publisher
  ID. These exit non-zero, so the nightly build refuses to publish them.
- **TODO** — not configured yet, like the placeholder `url`. It has to be done
  before you apply, but a site that has not launched is *supposed* to be in
  this state, so it exits zero. The exception is once `adsense.publisherId` is
  set: real ad code serving from a domain the config does not name is a
  violation, and every TODO is promoted to a FIX.
- **warn** — worth a look, nothing more.

What it cannot judge is whether Google finds the content itself useful — that
is the part of the decision no script can measure.

### Consent, and the part you cannot skip

The site ships a lightweight consent banner. It stores one value
(`hb-consent`) in the visitor's browser and switches ads to **non-personalised**
mode when the visitor declines; until anyone accepts, ads are already requested
non-personalised.

**That banner is not a certified CMP.** If you serve EEA, UK or Swiss traffic,
Google requires a certified consent management platform. The simplest route is
Google's own **Privacy & Messaging** ("Funding Choices"), configured in the
AdSense UI: it is free, certified, and needs no code change here beyond letting
its script load. Swap or supplement `assets/consent.js` accordingly.

## How the data works

```
availableCountries()          fresh cache → live API → stale cache → computed list
holidays(year, countryCode)   fresh cache → live API → stale cache → computed rules
```

- **Live source:** the [Nager.Date](https://date.nager.at) public API
  (`/AvailableCountries`, `/PublicHolidays/{year}/{code}`). No key, no
  registration, roughly 110 countries.
- **Cache:** every response is written to `.cache/`. Past years are treated as
  fresh for 30 days, the current and future years for 12 hours. A repeat build
  makes no network calls at all.
- **Fallback:** two tiers of computed rules, so a build with no network still
  publishes most of the world.
  - `lib/fallback.mjs` — **full** rule sets for the United States, United
    Kingdom, Australia, Canada, Germany, France, Ireland and India: complete
    national lists including each country's own weekend-observance law.
  - `lib/world.mjs` — **core** rule sets for 187 further countries: the
    principal national holidays, one line of notation each.
  Between them the rules cover fixed dates, nth-weekday-of-month rules,
  Gregorian Easter (Meeus/Jones/Butcher), Orthodox Easter (Julian computus) and
  the Islamic calendar. **No per-year date lists exist anywhere**, so computed
  dates stay correct for any year you ask for.
- **Normalised shape:** `{ date, name, type, national }`.
- **Time zones:** every date is handled as UTC, so a build produces identical
  output wherever it runs.

The first network failure marks the source as down for the rest of the build
rather than retrying a dead network a few thousand times.

### Adding a data source

`lib/source.mjs` is the only module that knows where holidays come from. A new
source is another step in the resolution chain in `createSource()`:

1. Write a loader that returns raw rows for `(year, countryCode)`.
2. Map them to `{ date, name, type, national }` — `normalise()` is the example
   to copy, and `date` must be `YYYY-MM-DD`.
3. Insert it in `holidays()` before the fallback: cache, then live, then your
   source, then computed rules. Bump the `stats` counter you want reported.

To add a country to the computed rules instead, add an entry to `RULES` in
`lib/fallback.mjs`. Rules are data — `{ month, day }`, `{ month, weekday, nth }`
(negative `nth` counts from the end of the month), `{ easter: offset }`, or
`{ on: (year) => Date }` for anything stranger — plus an `observe` strategy of
`'us'`, `'substitute'` or `null`. Add the expected dates for two future years to
`test/fallback.test.mjs` in the same commit.

## What is in the box

```
build.mjs               orchestrator: data → pages → sitemap/robots/ads.txt
site.config.mjs         everything a deployer changes
lib/dates.mjs           Easter, nth-weekday, business days, UTC helpers
lib/fallback.mjs        full statutory rule sets for eight countries
lib/world.mjs           core national holidays for 187 more, one line each
lib/islamic.mjs         tabular Hijri calendar, for estimated Eid dates
lib/glossary.mjs        what each holiday is for, written once and reused
lib/source.mjs          Nager.Date + cache + fallback resolution
lib/countries.mjs       ISO 3166-1 names, regions, flags
lib/stats.mjs           the computed facts on every year page
lib/compare.mjs         shared days off, long weekends, bridges, highlights
lib/assistant.mjs       reads a plain-English question and answers it
lib/events.mjs          concerts, comedy and events, cross-checked with holidays
lib/events-demo.mjs     clearly labelled sample listings for --events-demo
lib/ribbon.mjs          the year ribbon, single and twin
lib/html.mjs            layout, SEO head, ad slots
lib/browser-modules.mjs which modules ship to the browser
lib/pages/              page renderers
assets/                 CSS and the browser scripts
test/                   203 tests: dates, rules, world table, calendars,
                        glossary, source, stats, comparison, events,
                        the assistant, rendering, and the browser-module
                        contract
tools/serve.mjs         local server for dist/
tools/preview.mjs       bundles dist/ into one shareable file
tools/preview-shell.html  the frame that file is built into
```

### Pages generated

| URL | What it is |
| --- | --- |
| `/` | Hero, country finder, a heat-mapped year ribbon, featured countries |
| `/ask/` | A plain-English question about holidays, working days or leave |
| `/countries/` | Every country, grouped by region |
| `/compare/` | Pick any two countries and compare them |
| `/compare/{a}-vs-{b}/` | Pre-rendered comparison for a featured pairing |
| `/team/` | Up to six countries on one planner — when everyone is actually available |
| `/events/` | Countries with live listings *(only with an API key)* |
| `/{iso2}/events/`, `/{iso2}/concerts/`, `/{iso2}/comedy/` | What's on *(only with an API key)* |
| `/today/` | Which countries have a public holiday today, and what is coming up |
| `/{iso2}/` | Country hub: pick a year, see the next holiday |
| `/{iso2}/{year}/` | The full holiday table plus computed statistics |
| `/{iso2}/business-days-calculator/` | Working days between two dates, or a date N business days away |
| `/{iso2}/annual-leave-planner/` | Where to spend a leave allowance for the most time off |
| `/about/`, `/privacy/` | Method, sources and privacy |

Plus `sitemap.xml` (current year highest priority, past years lowest),
`robots.txt`, `ads.txt`, `countries.json` for the finder, `data/{ISO2}.json` for
the comparison and the assistant, and a `404.html`.

## Ask — `/ask/`

A plain-English question, a worked answer, instantly:

> *How many working days until 24 December in the United States?*
> **88 working days from 19 Aug 2026 to 24 Dec 2026 in United States.**
> 128 calendar days · 36 weekend days · 4 public holidays.

It handles eleven kinds of question — the next day off, whether a given date is
a working day, working days between two dates, a deadline N business days out,
where to spend a leave allowance, when a spread-out team is all present, two
countries side by side, long weekends, what falls in a month, how many holidays
a year has, and what a named holiday is for.

### There is no language model in it

That is the design, not a gap. "What date is twenty working days from Tuesday"
has exactly one correct answer, and this repository already holds every public
holiday for 195 countries. Computing it is instant, costs nothing, runs with no
network, and cannot invent a date. A model would add latency, a bill, an API key
a static site has nowhere to keep — and the possibility of a confidently wrong
answer to a question about somebody's deadline.

So the work is in *reading* the question, not producing the answer:

```
interpret(text, index)   what is being asked, about where, about when
answer(request, data)    the arithmetic, from the real holiday tables
```

The split is what makes it work in a browser. `interpret` runs first and names
the countries it needs; the caller fetches only those (a few kilobytes each);
`answer` then runs on the data. Nothing is sent anywhere, because there is
nowhere to send it — the site is a folder of static files.

`lib/assistant.mjs` holds both, plus the parsing they need:

- **Countries** — formal names, the names people actually type (`UK`, `USA`,
  `Holland`, `South Korea`), and bare ISO codes. Codes that are also English
  words (`IN`, `IT`, `IS`, `AT`, `US`) match only when capitalised, so "how many
  days are in it" names no country at all.
- **Dates** — `2026-03-15`, `15 March`, `15th of March 2027`, `March 15`,
  `Mar 15th, 2027`, `today`, `tomorrow`, `next Friday`, `in 10 days`, `end of
  the year`. An impossible date such as `31 February` is refused rather than
  rolled into March.
- **Intent** — matched top-down from the most unmistakable shape to the
  vaguest, so "is 25 December a working day" is read as a yes/no about one date
  and "how many working days until 25 December" as a span to count, even though
  both contain the words *working day*.

When it cannot tell what you meant it says so and asks for the missing piece.
It never guesses a country, and never answers a question it did not understand.

### The contract

`CAPABILITIES` in `lib/assistant.mjs` lists what the page advertises, and every
entry carries the example shown on the page. Two tests enforce that the list
stays honest: every advertised example must interpret to its stated intent and
produce an answer, and every follow-up an answer suggests must itself be
answerable. A capability that stops working fails the build rather than
disappointing a visitor.

### How it stays in one implementation

Exactly as the other tools do. The generator answers one question at build time
and puts the result in the HTML — so the page is useful before any JavaScript
runs and reads properly to a crawler — then the browser answers every question
after that using the same two functions and the same renderer, imported as
native ES modules from `/assets/mjs/`. There is no second copy of the logic to
drift, and no bundler.

## The three planners

Holiday tables are the data. These are the reason to come back, and like the
assistant above, all three run entirely in the browser — the generator renders a default so the page works
without JavaScript and reads properly to a crawler, then the same modules
re-render it when the visitor changes anything.

### Annual leave planner — `/{iso2}/annual-leave-planner/`

Answers "I get N days of leave, which days do I book?"

A day off is worth more next to other days off, because what a person values is
the length of the unbroken run rather than the count of days. So the planner
lays the year out as a strip, marks every weekend and public holiday, enumerates
**every** unbroken run that could be bought, prices each in leave days, and
solves a knapsack for the set that buys the most time. It is exact, not greedy —
365 days by 40 leave days is a small enough problem to solve properly.

Three strategies, because the arithmetic cannot tell you which person you are:

| Strategy | What it does |
| --- | --- |
| Long weekends | Only bridges one or two days. Buys the most total time off |
| Proper holidays | Nothing shorter than a week |
| Balanced | Reserves 60% of the budget for one real trip, then spends the rest |

Balanced needs two passes, and that is not incidental. Left to itself the
optimiser *always* buys long weekends, because bridging a single Friday is the
best trade on the board and stays the best trade until the budget runs out —
which made the first two strategies return identical plans. Reserving part of
the budget first is what makes the choice mean something.

Among runs of equal length the planner prefers the one built on a public
holiday. Every spare Monday in the year buys the same three days, and without
that tie-break the tool hands back "book a Monday in November" as though it were
a finding.

### Team holiday overlap — `/team/`

Up to six countries on one planner, because the question distributed teams
actually have is about the intersection. It separates three things people
conflate: days everyone is working (the number to plan around), days somebody is
away, and days everyone is off at once — rarer than expected, and worth knowing.
It also finds the longest runs of working days with nobody away, for whatever
needs the whole team in one place.

The line-up lives in the query string, so a link carries the team.

### Business-day deadline calculator

The existing calculator gained a second mode: not how many working days lie
between two dates, but what date you land on after a given number of them.
"30 business days from today" is how notice periods, payment terms and statutory
response windows are written. It counts from the next working day, the usual
convention, and shows every weekend and holiday it skipped so the answer can be
checked rather than trusted.

It is a second tab on the existing page rather than 195 new pages. Page volume
is this site's risk with reviewers, not its strength.

## Concerts, comedy and live events

Event pages are the one **optional** part of the site, because they are the one
part that needs a key.

```bash
export TICKETMASTER_API_KEY=your-key   # free, from developer.ticketmaster.com
npm run events:check                  # proves real listings are reachable
npm run build                         # publishes them
```

`npm run events:check` is the quickest way to answer "are these listings
real?". It uses the same source module the build uses, and prints the actual
counts and a real event name per country, so a pass means the build will
publish real data. A 401 tells you the key is wrong or not yet active; an empty
result tells you the country has no upstream coverage.

With a key, each covered country gets three pages — `/{iso2}/events/`,
`/{iso2}/concerts/` and `/{iso2}/comedy/` — plus a `/events/` hub and a
"What's on" nav item. **Without a key the site builds exactly as it did
before**: no event pages, no nav item, nothing invented to fill the gap. A
country the source has no listings for gets no page rather than an empty one.

What makes these pages belong here rather than being a bolt-on: every listing is
matched against that country's public holiday calendar, and a show landing on a
public holiday is flagged with a tag linking straight to that date in the
calendar. That is the thing that actually changes your evening — transport on a
Sunday timetable, different opening hours, different prices.

### Seeing it without a key

```bash
npm run build:offline -- --events-demo
```

Sample listings, with invented acts and venues. Every such page carries a
banner saying so, is marked `noindex`, is kept out of the sitemap, carries no
ticket links, and gets no `Event` structured data — invented listings must never
be marked up as though they were real. It exists to review the layout, never to
stand in for real data.

### Notes on the source

- Three requests per country per build (music, comedy, everything else),
  throttled below Ticketmaster's five-per-second limit, cached under a
  date-stamped key so a rebuild the same day makes no calls and a listing can
  never go stale by more than a day.
- A rate limit or outage stops the build asking for more and simply yields no
  event pages — it never fails the build and never serves a half-empty page.
- Ticket links are `rel="noopener nofollow"`, and a listing with no valid https
  link renders as plain text rather than inventing one.
- Swapping provider means writing one `forCountry(code)` that returns the same
  three buckets; the pages and the holiday cross-referencing are provider-blind.

## Comparing two countries

`/compare/` answers the trip-planning question: *given these two countries, when
should I go?* Everything on it is computed from the two holiday calendars:

- **Highlights** — a row of one-line verdicts with the numbers in them: who has
  more public holidays, who works fewer days, how many days off you have in
  common, who gets more long weekends, the best day to book, and the quietest
  month. Facts only; the site never claims one country is nicer than another.
- **Head to head** — holidays, working days, weekend-absorbed holidays, long
  weekends and the longest dry spell, side by side.
- **Both calendars on one planner** — the year ribbon with two rows per month
  sharing the same weekday columns. The upper country is solid, the lower one
  hatched, and a day both are off is ruled through both rows so it reads as a
  single block.
- **When you are both off** — every date that is a public holiday in both, and
  what each country calls it.
- **Windows worth planning around** — each side's long weekends, the windows
  where both are on a break at once, and the "book one day, get four" bridges.
- **Month by month** and **what only one side observes**.

Every date, country and year on the page is a link into the corresponding
calendar page, so a comparison is the start of the research rather than the end
of it.

### How it stays in one implementation

The pairs of the featured countries are pre-rendered at build time, so they are
crawlable and work with scripting off. Any *other* pairing is built in the
browser — and it is built by importing the generator's own modules as native ES
modules:

```
dist/assets/mjs/          lib/compare.mjs, lib/pages/compare.mjs, lib/ribbon.mjs …
assets/compare.js         imports them, fetches /data/{ISO2}.json, renders
```

There is no bundler and no second copy of the comparison logic, so a pairing
rendered in the browser is identical to one rendered at build time. The list of
shipped modules lives in `lib/browser-modules.mjs`;
`test/browser-modules.test.mjs` fails if one of them starts importing something
the browser cannot load, or something that is not shipped alongside it.

Adding a pairing to the pre-rendered set is a matter of adding the country to
`featured` in `site.config.mjs` — every pair of featured countries gets a page.

### The numbers on a year page

Every year page carries facts computed from that country's own data, so no two
pages are near-duplicates:

- how many public holidays, split national and regional;
- working days in the year (weekdays minus national holidays that fall on a
  weekday — a holiday on a Saturday is not subtracted twice);
- how many holidays fall on a weekend, and which ones;
- the longest run of consecutive days with no public holiday;
- the next upcoming holiday, and the busiest month.

## Design

The visual direction is the office year wall planner: a pale board colour, ink
type, hairline rules, and one signal yellow that only ever means "public
holiday" — never decoration.

The signature element is the **year ribbon**: twelve rows of day cells with
columns aligned by weekday, so every Monday sits in the same column and weekends
form vertical stripes, exactly like a wall chart. Holidays are punched out in
yellow. On the home page the same ribbon is shaded by how many countries are on
holiday each day of the year.

Type pairs a characterful display face (Bricolage Grotesque) with a clean body
face (Inter) and a mono face (IBM Plex Mono) for dates and data, loaded from
Google Fonts with system fallbacks. Layout is responsive, focus is visible,
`prefers-reduced-motion` is respected, and wide tables and the ribbon scroll
inside their own containers instead of squashing.

## Limits of the data

Read this before trusting a number.

- **Regional holidays are incomplete.** A holiday observed in one state,
  province or nation of a country may be missing, or marked national when it is
  not. German state holidays, US state holidays, and the differences between
  England, Scotland and Northern Ireland are the obvious cases. The computed
  fallback is national-level only — its `GB` rules are England and Wales.
- **Lunar and observational dates in future years are estimates.** Eid al-Fitr,
  Eid al-Adha, Diwali, Chinese New Year and similar holidays depend on lunar
  calendars or on a sighting, and official dates are often confirmed only weeks
  ahead. Where the API supplies them they are published as given; the computed
  rule sets do not attempt them at all, which is why the computed Indian
  calendar is short.
- **One-off holidays are missing until upstream adds them.** Royal, national and
  emergency holidays declared for a single year cannot be derived from a rule.
- **Substitute days follow the general rule, not every exception.** Where a
  holiday is moved, the moved date is the one shown — so a US New Year's Day
  observed on 31 December appears in the earlier year.
- **Working-day counts assume a Monday-to-Friday week.** Countries and
  industries with a Friday–Saturday weekend or a six-day week will differ.
- **Coverage follows upstream, then the rule tables.** The API publishes roughly
  110 countries; `lib/world.mjs` carries 187 more. A country with neither is not
  published at all rather than shipped as an empty page.
- **Core coverage is not a complete list.** For the countries that come from
  `lib/world.mjs`, only the principal national holidays are computed. Every page
  built from one says so, and its working-day count is an upper bound — the real
  figure is lower wherever a holiday is missing.
- **Islamic dates are estimates, and are labelled as such.** They come from the
  arithmetic Hijri calendar and land within a day or so of the observed date,
  which depends on a moon sighting and is confirmed only days ahead.

Use it for planning. For payroll, statutory notice periods, or anything with
legal consequences, confirm against the national gazette or labour authority.

## Explicitly out of scope

Accounts, comments, newsletters, a CMS, server-side rendering, a public API,
paid tiers, and any framework. If a change seems to need a dependency, write the
thirty lines instead.

## Licence

Code: MIT. Holiday data comes from Nager.Date under its own terms; check them
before redistributing the data itself.
