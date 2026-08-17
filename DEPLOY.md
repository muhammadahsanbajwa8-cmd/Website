# Getting the site live, and changing it afterwards

Written for someone who has not deployed a site before. Follow it in order.

There are three stages, and you can stop after any of them:

1. **Live on a free URL** — about fifteen minutes, no money, no card.
2. **On your own domain** — needed before applying to AdSense.
3. **Making changes** — the loop you will use from then on.

---

## Before anything

Nothing. The work is already merged to `main`, and `main` is what gets
published. Start at Stage 1.

---

## Stage 1 — Live on a free URL

**GitHub Pages, free, no card, no domain.** Your repository can host the site
itself. One setting, then every push publishes automatically.

1. On github.com, open your repository.
2. **Settings** (top row) → **Pages** (left sidebar).
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.

That is the whole thing. There is no build command to fill in and no folder to
choose — the workflow in this repository already does that part.

Within a few minutes the site is live at:

```
https://muhammadahsanbajwa8-cmd.github.io/Website/
```

Every push to `main`, and the nightly rebuild at 03:17 UTC, republishes it.

### Why the address has `/Website` on the end

A GitHub Pages *project* site is served from a folder named after the
repository rather than from the root of the domain. That used to break this
site outright: it wrote every link and every stylesheet from the domain root,
so the first page loaded and everything after it 404'd.

The generator now takes its mount point from `url` in `site.config.mjs` and
prefixes every address it writes. Nothing to configure — change `url` and the
whole site follows.

The one thing a sub-folder cannot do is `robots.txt`. Crawlers only read it
from the root of a domain, and you do not control `github.io`'s root. It has no
effect on the site working, and it stops mattering the moment you move to your
own domain.

### Cloudflare Pages or Netlify instead

Both are also free and give you a root address (`something.pages.dev`), which
avoids the `/Website` folder entirely.

- **Cloudflare**: dash.cloudflare.com → **Workers & Pages** → **Create** →
  **Pages** → **Connect to Git** → pick the repo. Production branch `main`,
  build command `npm run build`, output directory `dist`.
- **Netlify**: netlify.com → **Add new site** → **Import an existing project**
  → pick the repo, accept what it offers. `netlify.toml` fills in the rest.

If you use either, set `url` in `site.config.mjs` to the address they give you
(no trailing slash, no folder), and switch the GitHub deploy off with a
repository variable: **Settings → Secrets and variables → Actions → Variables**
→ `DEPLOY_TARGET` = `off`.

### If the deploy step goes red

- **"Pages site not found"** — step 3 above has not been done yet. The build
  itself succeeded; only publishing failed.
- **Wrong Source** — it must be **GitHub Actions**, not "Deploy from a branch".

## Stage 2 — Your own domain

Do this before applying to AdSense. Google wants a site on a domain you own,
and a `github.io` sub-folder is not one. The site works perfectly well there —
it is just not a good address to apply with.

### Buy a domain

Any registrar: Cloudflare Registrar, Namecheap, Porkbun. Roughly $10–15 a year
for a `.com`. Pick something a person could say out loud.

### Point it at your site

In Cloudflare Pages: your project → **Custom domains** → **Set up a domain** →
type it in and follow the DNS instructions. If you bought the domain at
Cloudflare it is two clicks; elsewhere you copy a record into your registrar's
DNS page. HTTPS is automatic and free.

### Tell the site its own address

Two lines in `site.config.mjs`:

```js
url: 'https://yourdomain.com',        // no trailing slash, no folder
contactEmail: 'you@yourdomain.com',   // an address you actually read
```

Changing `url` also moves the whole site back to the domain root: the `/Website`
prefix disappears from every link and every asset on the next build, because
every address is derived from that one line.

This matters more than it looks: those values go into the canonical tag of
every page, all 1,790 sitemap URLs, and the contact line on `/about/` and
`/privacy/`.

Then commit and push (see below) and the site rebuilds. Confirm with:

```bash
npm run build
npm run adsense:check
```

Both TODO lines should now be gone, and the last line should read *Ready to
apply*.

---

## Stage 3 — Making changes

### The loop

```bash
npm run build:offline   # rebuild the site into dist/
npm run serve           # open http://localhost:8080 and look at it
npm test                # make sure nothing broke
```

Then publish:

```bash
git add -A
git commit -m "Describe what you changed"
git push
```

Your host sees the push and rebuilds within a minute or two. There is no
separate "upload" step.

You need Node 20 or newer installed to run those commands. If you have not got
it, **nodejs.org** has an installer. Nothing else is needed — this project has
no dependencies to install.

### The things you are most likely to want to change

Almost everything a normal change touches is in **`site.config.mjs`**:

| To change | Edit |
| --- | --- |
| Site name and tagline | `name`, `tagline` |
| Your domain and contact | `url`, `contactEmail` |
| Which countries appear on the home page | `featured` |
| How many years are published | `years.back`, `years.ahead` |
| Turn on AdSense after approval | `adsense.publisherId` and the three `slots` |
| Turn on real event listings | set `TICKETMASTER_API_KEY` in your host's environment variables |

Beyond the config:

| To change | Edit |
| --- | --- |
| What a holiday means, in the explanations | `lib/glossary.mjs` |
| A country's holiday list | `lib/world.mjs` — one line per country |
| How the leave planner picks days | `lib/leave.mjs` — the strategies are at the top |
| How many countries the team view allows | `lib/team.mjs` — `MAX_MEMBERS` |
| Colours, spacing, type | `assets/board.css` |
| Wording on the About or Privacy pages | `lib/pages/site.mjs` |

After editing `lib/world.mjs` or `lib/glossary.mjs`, run `npm test`. The tests
check the dates still land correctly and the explanations still match.

### Two commands worth knowing

```bash
npm run adsense:check   # scans the built site for what gets AdSense rejected
npm run preview         # bundles the whole site into one file you can send someone
npm run preview:static  # ten pages, no JavaScript — opens in anything
```

### If something goes wrong

Nothing is lost — every version is in git.

```bash
git log --oneline      # the history
git diff               # what you have changed but not committed
git checkout .         # throw away uncommitted changes
```

---

## What happens without you

A scheduled job rebuilds and redeploys the site every night at 03:17 UTC. That
is what keeps `/today/` correct, and it is why next year's calendars appear on
their own without you doing anything.

It also means a change you push is not the only thing that updates the site —
the data refreshes on its own.

---

## The order that matters for AdSense

1. Live on your own domain, on HTTPS.
2. `url` and `contactEmail` set to real values, and rebuilt.
3. `npm run adsense:check` passing.
4. Sitemap submitted in Google Search Console, and give it a few weeks to index.
5. **Then** apply.

Applying the day a site goes live is the most common way to be turned down.
