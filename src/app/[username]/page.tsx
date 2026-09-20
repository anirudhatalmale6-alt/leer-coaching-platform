import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicProfile } from "@/lib/profile-store";
import { formatPrice, isSellable } from "@/lib/profile";
import { appUrl } from "@/lib/env";

/**
 * The trainer's public sales page: leersports.com/<username>.
 *
 * Single card, centred, per the client's UI spec - this is the link that goes
 * in an Instagram bio, so almost all of its traffic is one thumb on a phone.
 * There is no gallery and no navigation to get lost in: the page exists to turn
 * a visitor into a booking.
 */

type Props = { params: Promise<{ username: string }> };

/**
 * Share previews matter more here than anywhere else in the app, because this
 * URL gets pasted into Instagram, YouTube descriptions and DMs.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const trainer = await getPublicProfile(username);
  if (!trainer?.isTrainer) return { title: "Not found - LEER" };

  const name = trainer.name ?? trainer.username ?? "Coach";
  const title = trainer.category ? `${name} - ${trainer.category} | LEER` : `${name} | LEER`;
  const description =
    trainer.bio ??
    `Book 1:1 video coaching with ${name}. Frame-by-frame analysis delivered within 24 hours.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${appUrl}/${trainer.username}`,
      type: "profile",
    },
  };
}

function Initial({ name }: { name: string | null }) {
  return (
    <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[var(--surface-2)] text-3xl font-semibold text-[var(--muted)]">
      {(name ?? "?").charAt(0).toUpperCase()}
    </div>
  );
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" fill="currentColor">
      <path d="M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.2 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.2 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.2-2.2-.4a3.9 3.9 0 0 1-1.4-.9 3.9 3.9 0 0 1-.9-1.4c-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c.1-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4C8.4 2.2 8.8 2.2 12 2.2Zm0 1.8c-3.1 0-3.5 0-4.7.1-1.1.1-1.7.2-2.1.3-.5.2-.9.4-1.2.8-.4.3-.6.7-.8 1.2-.1.4-.3 1-.3 2.1-.1 1.2-.1 1.6-.1 4.7s0 3.5.1 4.7c.1 1.1.2 1.7.3 2.1.2.5.4.9.8 1.2.3.4.7.6 1.2.8.4.1 1 .3 2.1.3 1.2.1 1.6.1 4.7.1s3.5 0 4.7-.1c1.1-.1 1.7-.2 2.1-.3.5-.2.9-.4 1.2-.8.4-.3.6-.7.8-1.2.1-.4.3-1 .3-2.1.1-1.2.1-1.6.1-4.7s0-3.5-.1-4.7c-.1-1.1-.2-1.7-.3-2.1a3 3 0 0 0-.8-1.2 3 3 0 0 0-1.2-.8c-.4-.1-1-.3-2.1-.3-1.2-.1-1.6-.1-4.7-.1Zm0 3.1a4.9 4.9 0 1 1 0 9.8 4.9 4.9 0 0 1 0-9.8Zm0 8.1a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Zm6.2-8.3a1.1 1.1 0 1 1-2.3 0 1.1 1.1 0 0 1 2.3 0Z" />
    </svg>
  );
}

function YouTubeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" fill="currentColor">
      <path d="M21.6 7.2c-.2-.9-.9-1.6-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4c-.9.2-1.6.9-1.8 1.8C2 8.8 2 12 2 12s0 3.2.4 4.8c.2.9.9 1.6 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4c.9-.2 1.6-.9 1.8-1.8.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8ZM10 15V9l5.2 3L10 15Z" />
    </svg>
  );
}

export default async function TrainerPage({ params }: Props) {
  const { username } = await params;
  const trainer = await getPublicProfile(username);

  // A username exists only for trainers, but check the flag too: a demoted
  // account keeps its handle and must stop rendering as bookable.
  if (!trainer || !trainer.isTrainer) notFound();

  const bookable = isSellable(trainer);
  const displayName = trainer.name ?? trainer.username ?? "Coach";

  return (
    <main className="flex-1">
      <header className="border-b border-[var(--border)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Link href="/" className="text-sm font-semibold tracking-[0.25em]">
            LEER
          </Link>
          <Link
            href="/signin"
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]"
          >
            Sign in
          </Link>
        </div>
      </header>

      <div className="mx-auto w-full max-w-lg px-5 py-10 sm:py-14">
        <article className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex flex-col items-center px-6 pt-8 text-center">
            {trainer.avatarKey ? (
              // Plain <img>: the source is a redirect to a signed URL that
              // changes every hour, which defeats the point of next/image's
              // optimiser and would need the R2 host allow-listed as well.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/avatar/${trainer.username}`}
                alt={displayName}
                width={96}
                height={96}
                className="h-24 w-24 rounded-full object-cover"
              />
            ) : trainer.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={trainer.image}
                alt={displayName}
                width={96}
                height={96}
                className="h-24 w-24 rounded-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <Initial name={trainer.name} />
            )}

            <h1 className="mt-5 text-2xl font-semibold">{displayName}</h1>
            {trainer.category && (
              <span className="mt-2 rounded-full bg-[var(--surface-2)] px-3 py-1 text-xs font-semibold tracking-wide text-[var(--muted)]">
                {trainer.category.toUpperCase()}
              </span>
            )}
            {trainer.bio && (
              <p className="mt-4 text-sm leading-relaxed text-[var(--muted)]">{trainer.bio}</p>
            )}

            {(trainer.instagram || trainer.youtube) && (
              <div className="mt-5 flex items-center gap-3">
                {trainer.instagram && (
                  <a
                    href={`https://instagram.com/${trainer.instagram}`}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    aria-label={`${displayName} on Instagram`}
                    className="rounded-lg border border-[var(--border)] p-2 text-[var(--muted)] transition hover:text-[var(--foreground)]"
                  >
                    <InstagramIcon />
                  </a>
                )}
                {trainer.youtube && (
                  <a
                    href={`https://youtube.com/@${trainer.youtube}`}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    aria-label={`${displayName} on YouTube`}
                    className="rounded-lg border border-[var(--border)] p-2 text-[var(--muted)] transition hover:text-[var(--foreground)]"
                  >
                    <YouTubeIcon />
                  </a>
                )}
              </div>
            )}
          </div>

          <div className="mt-8 border-t border-[var(--border)] p-6">
            <p className="text-xs font-semibold tracking-[0.2em] text-[var(--muted)]">
              1:1 VIDEO COACHING PASS
            </p>

            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-semibold">
                {formatPrice(trainer.coachingPriceCents)}
              </span>
              <span className="text-sm text-[var(--muted)]">per clip</span>
            </div>

            <ul className="mt-4 space-y-2 text-sm text-[var(--muted)]">
              <li>Delivered within 24 hours, or you are automatically refunded.</li>
              <li>Frame-by-frame drawing, angle and split-screen analysis.</li>
              <li>Your card is only charged once your coach delivers.</li>
            </ul>

            {bookable ? (
              <Link
                href={`/book/${trainer.username}`}
                className="mt-6 block rounded-xl bg-[var(--accent)] px-5 py-3.5 text-center font-semibold text-[#06240f] transition hover:brightness-110"
              >
                Book video coaching ({formatPrice(trainer.coachingPriceCents)})
              </Link>
            ) : (
              <p className="mt-6 rounded-xl border border-dashed border-[var(--border)] px-5 py-3.5 text-center text-sm text-[var(--muted)]">
                {displayName} is not taking new bookings right now.
              </p>
            )}
          </div>

          {trainer.portfolioLinks.length > 0 && (
            <div className="border-t border-[var(--border)] px-6 py-5">
              <p className="text-xs font-semibold tracking-[0.2em] text-[var(--muted)]">
                RECENT WORK
              </p>
              <ul className="mt-3 space-y-2">
                {trainer.portfolioLinks.map((link) => (
                  <li key={link.url}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="block truncate text-sm text-[var(--muted)] underline decoration-[var(--border)] underline-offset-4 transition hover:text-[var(--foreground)]"
                    >
                      {link.url.replace(/^https?:\/\/(www\.)?/, "")}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </article>

        <p className="mt-6 text-center text-xs text-[var(--muted)]">
          Payments are held in escrow by LEER and released to the coach on your approval.
        </p>
      </div>
    </main>
  );
}
