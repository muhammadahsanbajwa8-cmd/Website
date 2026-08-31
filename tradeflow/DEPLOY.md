# Getting a live URL

Fifteen minutes, two free accounts, no card. At the end you have a real URL you
can open on your phone and send to someone.

You need a Supabase project (the database, file storage and sign-in) and a
Vercel project (the application itself). Both have free tiers that comfortably
run this.

---

## 1. Create the database — Supabase

1. Go to **supabase.com**, sign in with GitHub, and click **New project**.
2. Name it whatever you like. Choose the **Sydney** region — it is closest, so
   pages load faster. Set a database password and **write it down**; you need
   it in the next step and it is not shown again.
3. Wait about two minutes while it provisions.

Then collect four values. Leave this tab open — you will paste them in step 3.

| Where in Supabase | What to copy | Goes into |
| --- | --- | --- |
| Settings → Data API → Project URL | `https://xxxx.supabase.co` | `NEXT_PUBLIC_SUPABASE_URL` |
| Settings → API Keys → `anon` / publishable | the long key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Settings → API Keys → `service_role` | the other long key | `SUPABASE_SERVICE_ROLE_KEY` |
| Settings → Database → Connection string → URI | `postgresql://postgres:…` | `DATABASE_URL` |

The `service_role` key bypasses all security. It is a server-only value: it
goes in Vercel's environment variables and nowhere else. Never put it in a
front-end file or paste it into a browser.

---

## 2. Build the database

On your own machine, with the project cloned:

```bash
cd tradeflow
npm install
npm run setup            # asks for the four values above, then applies everything
npm run db:seed          # optional: a demo login with a business already in it
```

`npm run setup` writes `.env.local`, applies all five migrations, confirms row
level security is on every table and that the storage buckets exist. If it
reports a connection error, you have the pooled connection string — go back and
copy the **direct** one (port 5432).

You can also run the app locally at this point with `npm run dev`, which is the
fastest way to check everything works before deploying.

---

## 3. Deploy — Vercel

1. Go to **vercel.com**, sign in with GitHub, **Add New → Project**, and pick
   this repository.
2. **Set Root Directory to `tradeflow`.** This is the one setting that is easy
   to miss and the one that will fail the build if you miss it — the repository
   has another site at its root.
3. Under **Environment Variables**, add the four values from step 1, plus:

   ```
   NEXT_PUBLIC_APP_URL = https://your-project.vercel.app
   ```

   You will not know that URL until the first deploy finishes. Put anything in
   for now, then come back and correct it — quote share links and password
   reset emails are built from it, so it does need to be right.
4. **Deploy.** About two minutes.

Then, in Supabase → Authentication → URL Configuration, set **Site URL** to
your Vercel URL and add `https://your-project.vercel.app/**` to the redirect
allow list. Without this, confirmation and password-reset links bounce back to
`localhost`.

That is the link. Every push to the branch redeploys it, and every pull request
gets its own preview URL.

---

## 4. Switch on what you want

None of this is needed for the platform to run. Each one is a set of
environment variables in Vercel, then a redeploy.

**The AI assistant, email drafting and the phone agent**

```
ANTHROPIC_API_KEY = sk-ant-…        # console.anthropic.com → API keys
```

**Sending email for real** — without this, mail is composed and recorded in the
outbox but not delivered.

```
EMAIL_PROVIDER  = resend
RESEND_API_KEY  = re_…              # resend.com, verify your domain
EMAIL_FROM      = "Your Business <no-reply@yourdomain.com.au>"
```

**Answering the phone** — buy a number in the Twilio console, then point its
voice webhook at `https://your-app/api/voice/incoming` and its status callback
at `/api/voice/status`, both HTTP POST.

```
TWILIO_AUTH_TOKEN = …               # Twilio console → Account Info
```

**Connecting a mailbox** — register an OAuth client with Google
(console.cloud.google.com → Credentials) or Microsoft (entra.microsoft.com →
App registrations), and add `https://your-app/api/email/google/callback` (or
`/microsoft/`) as an authorised redirect URI.

```
GOOGLE_OAUTH_CLIENT_ID     = …
GOOGLE_OAUTH_CLIENT_SECRET = …
TOKEN_ENCRYPTION_KEY       = …      # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`TOKEN_ENCRYPTION_KEY` is not optional if you connect a mailbox: refresh tokens
are never written unencrypted, so without a key the connection is refused
rather than half-made.

---

## If the build fails

**"Module not found" or "No Next.js version detected"** — Root Directory is not
set to `tradeflow`. Project Settings → General → Root Directory.

**"NEXT_PUBLIC_SUPABASE_URL is not configured"** — the variable is missing, or
still says `your-…`. Note that `NEXT_PUBLIC_` values are baked in at build
time: after changing one you must redeploy, not just restart.

**The site loads but every page redirects to /login** — the migrations have not
been applied to *this* project's database. Re-run `npm run db:push` with that
project's `DATABASE_URL`.

**Sign-up works but the confirmation link goes to localhost** — the Site URL in
Supabase → Authentication is still the default.
