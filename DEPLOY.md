# Deploying LEER

Target: **Vercel** (app) + **Neon** (Postgres) + **Cloudflare R2** (video).
Roughly ten minutes, all on free tiers.

---

## Before you start: put this on YOUR GitHub account

The repository currently lives on the developer's GitHub account. Before you
deploy anything that holds your Stripe keys, move it to yours:

1. Fork or import `anirudhatalmale6-alt/leer-coaching-platform` into your own
   GitHub account.
2. Connect Vercel to **your** copy, not the original.

This is not paperwork. Vercel redeploys automatically on every push to the
connected repository, so whoever can push to that repo can run code inside your
deployment - with your Stripe secret key and R2 credentials in its environment.
The account that owns a deployment should be the account that owns the money.

---

## 1. Database (Neon)

1. Create a project at neon.tech. Any region; pick one near your users.
2. Copy the **pooled** connection string. It looks like:
   `postgresql://user:password@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require`

Use the pooled one. Serverless functions open a connection per invocation and
will exhaust a direct Postgres connection limit under any real traffic.

## 2. Vercel

Import the repository. Vercel detects Next.js; the only thing to change is the
**Build Command**:

```
npm run vercel-build
```

That runs `scripts/prepare-postgres.mjs`, pushes the schema to Neon, regenerates
the Prisma client for Postgres, then builds.

### Why not `prisma migrate deploy`

The migrations committed under `prisma/migrations/` are **SQLite** DDL - they
contain `PRAGMA` statements and `DATETIME` columns, and Postgres rejects them.
`vercel-build` therefore uses `prisma db push`, which creates the schema from
the models and is correct for a fresh database.

Before the platform holds real customer data, generate a Postgres migration
baseline and switch the build back to `migrate deploy`, so schema changes are
reviewable and reversible. `db push` will happily drop a column.

## 3. Environment variables

Set these in Vercel (Project → Settings → Environment Variables):

| variable | value |
| --- | --- |
| `DATABASE_URL` | the Neon **pooled** connection string |
| `AUTH_SECRET` | generate with `openssl rand -base64 32` |
| `AUTH_URL` | `https://<your-deployment>` |
| `NEXT_PUBLIC_APP_URL` | same as `AUTH_URL` |
| `AUTH_GOOGLE_ID` | Google OAuth client id |
| `AUTH_GOOGLE_SECRET` | Google OAuth client secret |
| `STRIPE_SECRET_KEY` | `sk_test_...` while testing |
| `STRIPE_WEBHOOK_SECRET` | from step 5 |
| `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` | R2 access key |
| `R2_SECRET_ACCESS_KEY` | R2 secret |
| `R2_BUCKET` | `leer` |
| `CRON_SECRET` | generate with `openssl rand -hex 32` |

Leave `LEER_DEV_LOGIN` **unset**. The app refuses to boot in production if it is
set, and with it unset the dev-only login and Stripe simulator return 404.

## 4. Google OAuth

Add the deployment's callback URL to the OAuth client's authorised redirect URIs:

```
https://<your-deployment>/api/auth/callback/google
```

Sign-in fails with `redirect_uri_mismatch` until this exists. Preview
deployments get their own hostname, so add those too if you want sign-in to work
on them.

## 5. Stripe webhook

Add an endpoint at `https://<your-deployment>/api/stripe/webhook`, subscribed to:

- `v2.core.account[configuration.recipient].capability_status_updated`
- `v2.core.account[configuration.recipient].updated`
- `payment_intent.amount_capturable_updated`

Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

The first two complete Trainee → Trainer elevation: Stripe often finishes
verifying an account long after the trainer has closed the onboarding tab. The
third starts the trainer's 24 hour clock when the trainee's card is authorised.

## 6. R2 CORS

The bucket needs this policy (R2 → bucket → Settings → CORS policy), including
the deployment's own origin:

```json
[
  {
    "AllowedOrigins": [
      "https://leersports.com",
      "https://www.leersports.com",
      "https://<your-deployment>",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type", "range"],
    "ExposeHeaders": ["etag", "content-range", "accept-ranges", "content-length"],
    "MaxAgeSeconds": 3600
  }
]
```

`range` is required. Without it uploads still work but playback and the analysis
canvas both break - see the README.

## 7. Cron

`vercel.json` already declares the sweep at `*/5 * * * *`. Vercel enables cron
on the first deployment that contains it, and sends `CRON_SECRET` as
`Authorization: Bearer`. Without that variable the route returns 404 and the
sweep never runs, so expired holds would never be released.

---

## Smoke test after deploying

1. `/` loads.
2. Sign in with Google.
3. `/dashboard` shows **TRAINEE**.
4. Pick a country, click Connect Stripe - you should land on a real Stripe
   onboarding page.
5. `/canvas` - step frames, draw an angle, toggle split screen.
6. `/upload` - drop a clip under 60s. If it fails, the bucket's CORS does not
   list this deployment's origin.
7. Hit the sweep manually:
   `curl -H "Authorization: Bearer $CRON_SECRET" https://<your-deployment>/api/cron/sweep`
   Expect `{"ok":true,"checked":0,"refunded":0,...}` on a quiet platform, and
   `404` without the header.

## Before real money

- Delete `src/app/api/dev/`.
- Swap `db push` for a Postgres migration baseline.
- Replace the Stripe test keys with live keys, and re-run the smoke test.
- Top up the platform balance: captured funds arrive **pending**, so the first
  payouts can fail with `balance_insufficient` until funds settle.
