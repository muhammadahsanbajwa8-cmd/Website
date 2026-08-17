# Getting the site live, and changing it afterwards

Written for someone who has not deployed a site before. Follow it in order.

There are three stages, and you can stop after any of them:

1. **Live on a free URL** — about fifteen minutes, no money, no card.
2. **On your own domain** — needed before applying to AdSense.
3. **Making changes** — the loop you will use from then on.

---

## Before anything: get the work onto `main`

All the work is on a branch called `claude/follow-instructions-7q58x3`. Hosts
build from your `main` branch, so merge it first.

On github.com, in your repository:

1. Click **Pull requests** → **New pull request**.
2. Set *base* to `main` and *compare* to `claude/follow-instructions-7q58x3`.
3. **Create pull request**, then **Merge pull request**.

That is all a merge is: it copies the branch's work onto `main`.

---

## Stage 1 — Live on a free URL

**Use Cloudflare Pages or Netlify, not GitHub Pages.** The reason is specific
and it will bite you otherwise: this site links everything from the domain root
(`/assets/board.css`, `/us/2026/`). A GitHub Pages *project* site serves at
`yourname.github.io/Website/` — a sub-folder — so the first page loads and then
every stylesheet and every link returns 404. Cloudflare and Netlify give you a
root URL, so nothing breaks. GitHub Pages is fine later, once you have a custom
domain pointed at it.

### Cloudflare Pages (recommended)

1. Sign up free at **dash.cloudflare.com** — no card needed.
2. **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
3. Authorise GitHub and pick your `Website` repository.
4. Set the build settings exactly:

   | Field | Value |
   | --- | --- |
   | Production branch | `main` |
   | Build command | `npm run build` |
   | Build output directory | `dist` |

5. Open **Environment variables** and add one: `NODE_VERSION` = `20`.
6. **Save and Deploy.** The first build takes a couple of minutes.

You get a URL like `holiday-board.pages.dev`. Open it — all 195 countries, the
calculator, the comparison. Every push to `main` rebuilds it automatically.

### Netlify (the same thing, if you prefer it)

Sign up at **netlify.com** → **Add new site** → **Import an existing project** →
pick the repo. Build command `npm run build`, publish directory `dist`, and an
environment variable `NODE_VERSION` = `20`.

### If the build fails

Read the log — it says which step failed. The usual causes:

- **Node version too old.** Set `NODE_VERSION` to `20`. This is the common one.
- **Wrong output directory.** It must be `dist`, not `build` or `public`.

---

## Stage 2 — Your own domain

Do this before applying to AdSense. Google wants a site on a domain you own, and
right now `site.config.mjs` still says `holidayboard.example`, which is a
placeholder that would fail a review on its own.

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
url: 'https://yourdomain.com',        // no trailing slash
contactEmail: 'you@yourdomain.com',   // an address you actually read
```

This matters more than it looks: those values go into the canonical tag of
every page, all 1,594 sitemap URLs, and the contact line on `/about/` and
`/privacy/`.

Then commit and push (see below) and the site rebuilds. Confirm with:

```bash
npm run build
npm run adsense:check
```

Both blocking issues should now be gone.

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
| Colours, spacing, type | `assets/board.css` |
| Wording on the About or Privacy pages | `lib/pages/site.mjs` |

After editing `lib/world.mjs` or `lib/glossary.mjs`, run `npm test`. The tests
check the dates still land correctly and the explanations still match.

### Two commands worth knowing

```bash
npm run adsense:check   # scans the built site for what gets AdSense rejected
npm run preview         # bundles the whole site into one file you can send someone
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
