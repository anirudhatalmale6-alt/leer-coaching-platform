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
- Public trainer URL issued on elevation: `leer.fit/<username>`
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

1. Switch `provider` in `prisma/schema.prisma` to `postgresql`, point
   `DATABASE_URL` at Postgres, run `npm run db:migrate`. No model changes needed -
   nothing in the schema uses a SQLite-only type.
2. Set every variable in `.env.example`. Leave `LEER_DEV_LOGIN` empty.
3. Register the Google OAuth redirect URI: `<AUTH_URL>/api/auth/callback/google`
4. Point a Stripe webhook endpoint at `/api/stripe/webhook`, subscribed to
   `account.updated`, and set `STRIPE_WEBHOOK_SECRET`.
5. Delete `src/app/api/dev/` before the platform accepts real money.

---

## Coming in later milestones

- **M2** - S3 signed-URL upload, the WebGL analysis canvas (frame-by-frame,
  angle and line drawing, 2-split comparison), the coaching room and its session
  guard
- **M3** - the escrow flow above, BullMQ 24h timeout queue, 80/20 payout, deploy

Video uploads are capped at **under 60 seconds and 100MB** (confirmed with the
client). At that size the whole clip decodes to frames in browser memory, which
is what makes frame stepping instant in both directions.

Not in scope for this build: trainer profile galleries and embeds, e-book/PDF
sales, the tip feature, voice-recording feedback, the 72h revision flow, mutual
cancel, and timeout-based auto-suspension.
