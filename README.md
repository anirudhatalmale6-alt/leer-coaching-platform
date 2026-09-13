# LEER - 1:1 video coaching platform

Trainers sell 1:1 video coaching passes on their own page, deliver frame-by-frame
analysis inside 24 hours, and are paid 80/20 through escrow.

Stack: Next.js 16 (App Router) - TypeScript - Prisma - Auth.js v5 - Stripe Connect.

---

## Milestone 1 - Auth, roles, Stripe Connect onboarding

**Status: complete.** 8 unit tests pass, production build clean, click-through verified.

What is in this milestone:

- Google OAuth single sign-on (Auth.js v5, database sessions)
- Everyone signs up as a **Trainee**. No role picker, no self-service elevation.
- Stripe Connect **Express** onboarding, with account links created per attempt
- Automatic **Trainee -> Trainer** elevation driven by Stripe's own account state
- Public trainer URL issued on elevation: `leersports.com/<username>`
- Stripe `account.updated` webhook with signature verification and replay protection
- Dev-mode shortcuts so the app runs before Google and Stripe credentials exist

---

## The one design decision worth reading

LEER settles with **separate charges and transfers**, not destination charges and
not a plain authorise-and-hold.

The reason is a hard Stripe limit. From the Stripe API reference:

> Uncaptured PaymentIntents are cancelled a set number of days (7 by default)
> after their creation.

The dispute rules in the spec add up to more than 7 days - 24h for the trainer to
deliver, the trainee's approval window, a revision request up to 72h after
delivery, then another 72h for the trainer to answer it. An authorisation held
across that would be voided by Stripe after the trainer had already done the
work. So:

1. **On purchase** - authorise only (`capture_method: "manual"`). If the trainer
   is silent for 24h the queue cancels the authorisation: the trainee is never
   charged, so there is no refund fee and no chargeback exposure.
2. **On delivery** - capture. Funds sit in the LEER platform balance and the
   7-day clock is gone.
3. **On approval** - transfer 80% to the trainer's connected account.

### What that means for onboarding, which is this milestone

Because the trainee's card is charged on the **platform** account, a connected
account never processes a card itself. So the capability an Express account needs
is `transfers`, **not** `card_payments`.

`src/lib/connect.ts` therefore:

- requests only `capabilities: { transfers: { requested: true } }`
- elevates on `details_submitted && capabilities.transfers === "active" && payouts_enabled`

That last line is stricter than "they finished the form" on purpose. Stripe very
often returns `details_submitted: true` while still verifying the account.
Elevating there would produce a trainer who can take a booking and then never be
paid - and by that point the trainee's money is already in escrow. There is a
test for exactly this case.

---

## Running it

```bash
npm install
cp .env.example .env          # fill in what you have
npx prisma migrate dev        # creates the SQLite dev database
npm run dev
```

With no Google or Stripe credentials the app still runs: sign-in and onboarding
each show a clear "not configured" notice rather than failing.

### Development shortcuts

Set `LEER_DEV_LOGIN=1` in `.env` to enable, in local development only:

- passwordless sign-in on `/signin`, standing in for Google OAuth
- three simulated Stripe account states on `/dashboard`, which feed the **real**
  `applyConnectStatus()` so the role rules are genuinely exercised

Both are gated on `NODE_ENV !== "production"` **and** the flag, and
`assertProductionConfig()` refuses to boot production if the flag is set.
Verified: with the flag off, `/api/dev/login` and `/api/dev/simulate-connect`
both return 404 and the dev panel does not render.

These shortcuts prove the role-elevation rules. They prove nothing about Stripe's
API - that needs test keys.

### Tests

```bash
npm test
```

---

## Going to production

Target infrastructure: **Vercel** (app) + **Neon** (Postgres) + **Upstash**
(Redis) + **Cloudflare R2** (video), on **leersports.com**.

Note: the spec says AWS S3; the credentials supplied are Cloudflare R2, which is
S3-compatible. The client is configured with `requestChecksumCalculation:
"WHEN_REQUIRED"` because recent AWS SDK versions send flexible-checksum headers
that R2 rejects with a confusing 400.

1. Switch `provider` in `prisma/schema.prisma` to `postgresql`, point
   `DATABASE_URL` at Neon, run `npm run db:migrate`. No model changes needed -
   the schema has been checked against the Postgres generator and translates
   cleanly (`prisma migrate diff --from-empty --to-schema-datamodel`).
2. Set every variable in `.env.example`. Leave `LEER_DEV_LOGIN` empty.
3. Register both Google OAuth redirect URIs:
   `https://leersports.com/api/auth/callback/google` and the localhost one for
   development.
4. Point a Stripe webhook endpoint at `/api/stripe/webhook`, subscribed to
   `account.updated`, and set `STRIPE_WEBHOOK_SECRET`.
5. Delete `src/app/api/dev/` before the platform accepts real money.

`postinstall` runs `prisma generate`, which Vercel needs - its build cache would
otherwise serve a stale Prisma client after a schema change.

### One thing to settle before M3: where the queue worker runs

BullMQ is a **worker** - a process that holds a Redis connection open and waits.
Vercel runs functions per invocation and has no always-on process to host one, so
the 24h timeout queue cannot live in this app's deployment. Upstash is fine as
the Redis itself; the worker is the problem.

Three options, in order of preference:

1. **Vercel Cron** hitting an internal sweep route every minute, which finds
   expired holds and cancels them. No extra host, no extra bill, and a 24h
   deadline does not need second-level precision. Drops BullMQ.
2. **BullMQ on a small always-on host** (Railway, Render, Fly) alongside Vercel.
   Keeps the spec exactly, costs a few dollars a month, one more thing to deploy.
3. **Upstash QStash** - a delayed HTTP callback scheduled at purchase time.
   Serverless-native, but a second Upstash product to configure.

All three produce the same user-visible behaviour. Option 1 is the
recommendation.

---

## Milestone 2 - the analysis canvas

**Status: canvas engine complete** at `/canvas`. Upload to storage is still
pending a bucket name.

- Frame-by-frame stepping, forwards and backwards, with keyboard shortcuts
- Angle measurement (3 points), line measurement with a pixel readout, text labels
- Split-screen comparison of two sessions, with an alignment offset
- Annotations pinned to a frame index and stored in normalised video coordinates
- WebGL2 compositing with an automatic Canvas2D fallback

### How frame accuracy is proven, not claimed

The two bundled test clips have their frame number burned into every frame by
ffmpeg. The test suite steps the UI to a target frame, reads the video's pixels,
and compares that region against the same frame extracted from the file by
ffmpeg - and against its neighbours. The correct frame scores a difference of
~0.25 while frames either side score 2-4, so the match is unambiguous.

Run it with `python3 scripts/frame_proof.py` against a running dev server
(needs `playwright` and `pillow`).

### Three bugs this found, worth knowing about

1. **Frame rate measured across a seek.** `requestVideoFrameCallback` also fires
   when a seek completes, so stepping produced samples like "6 frames spanning 2
   seconds" - a plausible 3 fps. Since the end of the clip is derived from fps,
   the timeline then clamped at frame 29 of 300. Measurement is now restricted to
   continuous playback, with a lower bound as a second line of defence.
2. **Stepping derived the next frame from `video.currentTime`,** which lags the
   seek, so two quick presses both computed from the same stale value and one was
   silently dropped. The intended frame is now authoritative.
3. **`dispose()` called `loseContext()`,** which permanently poisoned the canvas:
   the next mount got the dead context back and the video rendered as a black
   rectangle. React remounts this component on every navigation.

---

## Coming in M3

- S3/R2 signed-URL upload and the coaching room session guard
- The escrow flow above, the 24h timeout sweep (Vercel Cron), 80/20 payout, deploy

Video uploads are capped at **under 60 seconds and 100MB** (confirmed with the
client). At that size the whole clip decodes to frames in browser memory, which
is what makes frame stepping instant in both directions.

Not in scope for this build: trainer profile galleries and embeds, e-book/PDF
sales, the tip feature, voice-recording feedback, the 72h revision flow, mutual
cancel, and timeout-based auto-suspension.
