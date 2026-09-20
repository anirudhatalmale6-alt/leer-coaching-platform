# LEER - 1:1 video coaching platform

Trainers sell 1:1 video coaching passes on their own page, deliver frame-by-frame
analysis inside 24 hours, and are paid 80/20 through escrow.

Stack: Next.js 16 (App Router) - TypeScript - Prisma - Auth.js v5 - Stripe Connect.

---

## Milestone 1 - Auth, roles, Stripe Connect onboarding

**Status: complete.** Verified against the live Stripe test API for US, GB and DE trainers.

What is in this milestone:

- Google OAuth single sign-on (Auth.js v5, database sessions)
- Everyone signs up as a **Trainee**. No role picker, no self-service elevation.
- Stripe Connect onboarding via **Accounts v2**, with account links created per attempt
- Automatic **Trainee -> Trainer** elevation driven by Stripe's own account state
- Public trainer URL issued on elevation: `leersports.com/<username>`
- Stripe v2 capability webhook with signature verification and replay protection
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

### What that means for onboarding

Because the trainee's card is charged on the **platform** account, a trainer's
connected account never processes a card itself. A trainer is a **recipient**,
not a merchant.

## Accounts v2

Stripe **refuses v1 account creation** for new Connect integrations:

> Stripe no longer recommends Accounts v1 for new Connect integrations. Create
> connected accounts with POST /v2/core/accounts instead.

So there is no `type: "express"` anywhere. The account is created through
`v2.core.accounts` with `dashboard: "express"`, `fees_collector: "application"`
and `losses_collector: "application"` - the last is required, because
`losses_collector: "stripe"` is rejected outright alongside separate charges and
transfers.

### The role gate

`qualifiesAsTrainer` elevates only when

```
configuration.recipient.capabilities.stripe_balance.stripe_transfers.status === "active"
```

The v1 fields (`details_submitted`, `charges_enabled`, `payouts_enabled`) are
deprecated for v2 accounts and are not read at all. "active" is the only value
that means money can actually reach the trainer: a freshly created account comes
back `restricted` with `requirements_past_due`, and elevating there produces a
trainer who can take a booking and never be paid - with the trainee's money
already in escrow. Unknown future statuses fail closed. Tested both ways.

### Capability rules differ by country - verified, not assumed

A recipient-only account is **not** universally allowed. Tested against the live
API:

| country | recipient only | needs merchant + card_payments |
| --- | --- | --- |
| US | works | no |
| GB, DE, CA, AU, SG | rejected | yes |

Rejection is `capability_not_available_without_other_capability`. Rather than
hardcode that list - it would rot as Stripe changes per-country rules -
`createRecipientAccount` asks for the minimum and widens only when Stripe says
to, so trainers in countries that allow it still get the shorter onboarding.

Two consequences that cost real debugging time:

- `identity.country` is **required** at creation (`identity_country_required`)
  and is not comfortably changed afterwards, so the trainer picks it before
  onboarding rather than inheriting the platform's country. LEER is pitched as
  global; defaulting everyone to US would strand every trainer outside it.
- The account link's `configurations` must **match the account's applied
  configurations**, or Stripe rejects it. They are read back from the account
  rather than assumed, which is what makes the GB path work.

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

Target infrastructure: **Vercel** (app) + **Neon** (Postgres) + **Cloudflare R2**
(video), on **leersports.com**. The 24h sweep runs on Vercel Cron, so no Redis
is needed - see below.

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
   `v2.core.account[configuration.recipient].capability_status_updated` and
   `payment_intent.amount_capturable_updated`, and set `STRIPE_WEBHOOK_SECRET`.
5. Set `CRON_SECRET`. The sweep refuses to run without it.
6. Delete `src/app/api/dev/` before the platform accepts real money.

`postinstall` runs `prisma generate`, which Vercel needs - its build cache would
otherwise serve a stale Prisma client after a schema change.

### Why the timeout queue is cron, not BullMQ (decided)

BullMQ is a **worker** - a process that holds a Redis connection open and waits.
Vercel runs functions per invocation and has no always-on process to host one, so
the 24h timeout queue cannot live in this app's deployment. Upstash is fine as
the Redis itself; the worker is the problem.

The options were, in order of preference - **option 1 was chosen**, so no Redis
is needed at all:

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

**Status: complete.** Canvas at `/canvas`, upload flow at `/upload`.

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

## Storage - Cloudflare R2 (verified end to end)

Uploads go straight from the browser to R2 via a signed URL; the file never
passes through the server. Verified against the live bucket:

| check | result |
| --- | --- |
| upload via signed PUT | 200 |
| same URL, 1KB extra appended | 403 - the signed `ContentLength` pins the size, so the 100MB cap is enforced by R2, not by trusting the browser |
| stored object | correct byte count and content type |
| signed playback | 200 |
| `Range: bytes=0-1023` | 206 Partial Content - **frame stepping depends on this** |
| unsigned fetch | 400 - the bucket is private |

Limits (`src/lib/storage/r2.ts`): 100MB, 60 seconds, MP4/WebM/MOV. Duration is
measured in the browser before the upload starts so a too-long clip is rejected
instantly instead of after a 90MB transfer; size and type are re-checked server
side regardless.

Object keys are `uploads/<userId>/<uuid>.<ext>`. The UUID matters: coaching
footage is a person's body, and a predictable key is a directory listing for
anyone who learns the bucket hostname.

### The bucket needs a CORS policy

Browser uploads are blocked until this is set in the Cloudflare dashboard
(R2 > bucket > Settings > CORS policy). It cannot be set through the S3 API
token:

```json
[
  {
    "AllowedOrigins": [
      "https://leersports.com",
      "https://www.leersports.com",
      "https://<your-project>.vercel.app",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type", "range"],
    "ExposeHeaders": ["etag", "content-range", "accept-ranges", "content-length"],
    "MaxAgeSeconds": 3600
  }
]
```

**`range` in AllowedHeaders is not optional.** A first version of this policy
listed only `content-type`, and uploads worked perfectly - but `Range` is not a
CORS-safelisted request header, so the video element's range requests trigger a
preflight, and that preflight returned **403**. Verified directly against the
bucket:

| preflight requesting | result |
| --- | --- |
| `content-type` | 204, allowed |
| `range` | **403, blocked** |

The failure mode is nasty precisely because uploading keeps working: the clip
lands in the bucket and then cannot be played or analysed.

It is also load-bearing for the canvas itself, not just playback. The video is
loaded with `crossOrigin="anonymous"` because WebGL cannot upload a frame from a
cross-origin video as a texture without CORS permission - it taints the canvas.
No CORS, no analysis.

---

## Milestone 3 - coaching room, session guard, escrow

**Status: complete**, verified against the live Stripe test API.

### Session guard

The obfuscated room URL (`/coaching/a8f9-4b21-...`) stops rooms being
enumerated; it is **not** the security boundary. Access is checked server-side
on every render: the paying trainee and their trainer, nobody else, however the
link was obtained. Verified in a browser:

| visitor | result |
| --- | --- |
| signed out | redirected to sign in, room never rendered |
| signed in, not a participant | **404** (not 403 - confirming it exists is a disclosure) |
| paying trainee | sees room, countdown, approve button, no deliver button |
| trainer | sees room and deliver button, no approve button |

### Escrow, proven end to end

| step | verified |
| --- | --- |
| purchase authorises only | `requires_capture`, `amount_received = 0` |
| delivery captures | `succeeded`, `amount_received = 5000` |
| approval transfers 80% | trainer balance `4000`, platform keeps `1000` |
| retrying a transfer | idempotency key returns the *same* transfer - no double payout |
| capturing twice | rejected by Stripe (`payment_intent_unexpected_state`) |
| 24h timeout | authorisation cancelled, `amount_received = 0`, **no refund issued** |

That last row is the point of authorise-then-capture: a no-show costs nothing,
because there was never a charge to refund.

### The sweep (replacing BullMQ)

`/api/cron/sweep`, on Vercel Cron every 5 minutes (`vercel.json`). Verified
against real rooms and real PaymentIntents:

- overdue undelivered room → refunded, `closeReason: trainer_timeout`, Stripe
  authorisation cancelled
- room not yet due → untouched, authorisation still live
- **delivered room → untouched** (the money-losing case: coach did the work)
- released / cancelled rooms → untouched
- running the sweep twice refunds nothing the second time
- unauthenticated request → 404; wrong secret → 404

Set `CRON_SECRET`; Vercel sends it as `Authorization: Bearer`. Without it the
route refuses to run at all rather than running open - an unauthenticated
endpoint that cancels payments is a denial-of-service button.

### Concurrency

Every state change is a conditional `UPDATE ... WHERE status = <expected>`. Two
simultaneous approvals both see `delivered`, but only one UPDATE matches a row,
so only one transfer is created. A read-then-write would pay the trainer twice.

### One thing to know before launch

Captured funds arrive **pending**, not available, so a transfer immediately
after capture can fail with `balance_insufficient`. It surfaced during testing
and is handled - a failed transfer leaves the room `released` with
`closeReason: payout_pending` for retry, never un-approved or re-charged - but
the platform needs a working balance, or payouts must wait for settlement.

Video uploads are capped at **under 60 seconds and 100MB** (confirmed with the
client). At that size the whole clip decodes to frames in browser memory, which
is what makes frame stepping instant in both directions.

Not in scope for Phase 1: trainer profile galleries and embeds, e-book/PDF
sales, the tip feature, voice-recording feedback, the 72h revision flow, mutual
cancel, and timeout-based auto-suspension.

---

## Phase 2, M1 - trainer profile, public sales page, booking

The trainer fills in a profile on `/dashboard`; it renders at
`leersports.com/<username>` as a single card, and its button leads to
`/book/<username>`, which takes the clip and opens Stripe Checkout.

- **Profile** - handle, one-line bio, specialty category, profile image, Instagram
  and YouTube, up to five portfolio links, coaching price and an on/off toggle.
- **Public page** - one card, no gallery, no navigation. Nearly all of its traffic
  is a thumb on a phone arriving from a bio link.
- **Booking** - upload first, pay second. A trainee who cannot upload has simply
  not bought anything; one who pays first has a support ticket and a refund.

### The price is server-side, and that is a fix not a detail

`POST /api/rooms` used to accept `priceCents` **from the request body**, checked
only against the platform's $30-$500 bounds. A buyer could book a $65 pass for
$30 by editing the request, and every check would pass. The body no longer
carries a price at all - it names the coach, and the server reads
`coachingPriceCents` from that coach's row.

Verified against Stripe rather than against our own database: two bookings sent
with `priceCents: 3000` and `priceCents: 1` both produced Checkout Sessions with
`amount_total: 6500`, the trainer's real price.

### Checkout, not a card form

`payment_intent_data.capture_method: "manual"` means Checkout produces exactly
the authorised PaymentIntent the direct integration did, so delivery captures
it, approval transfers 80%, and a timeout cancels it - the escrow machinery in
`lib/escrow.ts` is untouched. What changes is that Stripe hosts the card page,
handles SCA and 3-D Secure, and offers each country's payment methods, which
matters for a platform whose selling point is that both sides can be anywhere.

The PaymentIntent id arrives with the webhook rather than at creation, because
Checkout mints it when the trainee reaches the payment step. `markPaid()` records
it even when the room has already moved on, so an out-of-order or redelivered
event cannot leave a paid room with nothing to capture.

`checkout.session.expired` closes an abandoned booking instead of leaving it in
`awaiting_payment` forever.

### Two things the tests initially failed to catch

Both were found by deliberately breaking the code and checking the suite went
red - it did not.

1. `normalisePortfolioUrl` rejected `javascript:alert(1)`, but only by accident:
   that URL parses with an empty hostname, so the "must contain a dot" rule
   caught it and the scheme check was never exercised. `javascript://evil.com/%0aalert(1)`
   has a real hostname, and in JS the `//` comments out the rest of the line so
   the payload after the newline still runs. It is now tested directly.
2. The price parser's comment claimed `49.99 * 100` drifts. It does not - that
   one is exact. `32.05 * 100` is `3204.9999999999995`, and Stripe rejects a
   non-integer amount outright, so the coach's page would just stop taking
   bookings with nothing to explain why. The test now sweeps every price in the
   allowed range instead of spot-checking a value that happened to pass.

### Sign-in now returns you to where you were going

`/signin` ignored any return URL and always went to `/dashboard`, so a visitor
who tapped "Book video coaching" from an Instagram bio signed in and landed on
an empty dashboard, having lost what they came for. It now honours `?next=`,
guarded by `safeNext()` - only a rooted in-app path survives, because an open
redirect on a sign-in page is a phishing primitive, and these particular
visitors are about to type card details.
