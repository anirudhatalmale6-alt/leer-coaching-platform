"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CATEGORIES,
  MAX_BIO_LENGTH,
  MAX_PORTFOLIO_LINKS,
} from "@/lib/profile";

type Props = {
  appHost: string;
  initial: {
    username: string;
    bio: string;
    category: string;
    instagram: string;
    youtube: string;
    price: string;
    coachingEnabled: boolean;
    portfolio: string[];
    hasAvatar: boolean;
  };
  payoutsActive: boolean;
};

type Errors = Record<string, string>;

/**
 * The trainer's profile form.
 *
 * One form, one save, a sticky bar that only appears once something has
 * actually changed. Saving field-by-field as you type sounds friendlier but
 * makes the username claim - which can fail against another person claiming the
 * same handle - impossible to report sensibly.
 */
export default function ProfileEditor({ appHost, initial, payoutsActive }: Props) {
  const router = useRouter();

  const [username, setUsername] = useState(initial.username);
  const [bio, setBio] = useState(initial.bio);
  const [category, setCategory] = useState(initial.category);
  const [instagram, setInstagram] = useState(initial.instagram);
  const [youtube, setYoutube] = useState(initial.youtube);
  const [price, setPrice] = useState(initial.price);
  const [enabled, setEnabled] = useState(initial.coachingEnabled);
  const [portfolio, setPortfolio] = useState<string[]>(
    initial.portfolio.length ? initial.portfolio : [""],
  );

  const [avatarKey, setAvatarKey] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [handleHint, setHandleHint] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  const dirty =
    username !== initial.username ||
    bio !== initial.bio ||
    category !== initial.category ||
    instagram !== initial.instagram ||
    youtube !== initial.youtube ||
    price !== initial.price ||
    enabled !== initial.coachingEnabled ||
    avatarKey !== null ||
    portfolio.filter(Boolean).join("\n") !== initial.portfolio.join("\n");

  /**
   * Check the handle while they type, but only after they stop.
   *
   * The answer is advisory - the unique index settles it on save - so this is
   * purely to stop somebody typing a taken name for thirty seconds before
   * finding out.
   */
  useEffect(() => {
    if (!username || username === initial.username) {
      setHandleHint(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/profile/username?u=${encodeURIComponent(username)}`);
        const data = (await res.json()) as { available?: boolean; reason?: string };
        setHandleHint(data.available ? "available" : (data.reason ?? "unavailable"));
      } catch {
        setHandleHint(null);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [username, initial.username]);

  const uploadAvatar = useCallback(async (file: File) => {
    setAvatarBusy(true);
    setErrors((e) => ({ ...e, avatarKey: "" }));
    try {
      const res = await fetch("/api/profile/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type, size: file.size }),
      });
      const signed = (await res.json()) as {
        url?: string;
        key?: string;
        headers?: Record<string, string>;
        error?: string;
      };
      if (!res.ok || !signed.url || !signed.key) {
        throw new Error(signed.error ?? "Could not prepare the upload.");
      }

      const put = await fetch(signed.url, {
        method: "PUT",
        headers: signed.headers,
        body: file,
      });
      if (!put.ok) {
        throw new Error(
          "Storage rejected the image. The bucket's CORS policy may need this site allowed.",
        );
      }

      setAvatarKey(signed.key);
      // Show the local file immediately: the stored object is behind a signed
      // URL that only resolves once the profile has been saved.
      setAvatarPreview(URL.createObjectURL(file));
    } catch (err) {
      setErrors((e) => ({ ...e, avatarKey: (err as Error).message }));
    }
    setAvatarBusy(false);
  }, []);

  async function save() {
    setSaving(true);
    setErrors({});
    setSaved(false);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          bio,
          category,
          instagram,
          youtube,
          price,
          coachingEnabled: enabled,
          portfolio: portfolio.filter((p) => p.trim()),
          ...(avatarKey ? { avatarKey } : {}),
        }),
      });
      const data = (await res.json()) as { errors?: Errors; error?: string };
      if (!res.ok) {
        setErrors(data.errors ?? { form: data.error ?? "Could not save." });
      } else {
        setSaved(true);
        setAvatarKey(null);
        // Re-render the server component so the page reflects what was stored,
        // rather than what the form happens to be holding.
        router.refresh();
      }
    } catch {
      setErrors({ form: "Network error. Please try again." });
    }
    setSaving(false);
  }

  const portfolioRows = portfolio.slice(0, MAX_PORTFOLIO_LINKS);

  return (
    <div className="pb-24">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="text-sm font-semibold tracking-wide text-[var(--muted)]">
          PUBLIC PROFILE
        </h2>

        <div className="mt-5 flex items-center gap-5">
          {avatarPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarPreview}
              alt=""
              className="h-20 w-20 rounded-full object-cover"
            />
          ) : initial.hasAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/avatar/${initial.username}`}
              alt=""
              className="h-20 w-20 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--surface-2)] text-xs text-[var(--muted)]">
              No image
            </div>
          )}

          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadAvatar(file);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={avatarBusy}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm transition hover:border-[var(--muted)] disabled:opacity-50"
            >
              {avatarBusy ? "Uploading..." : "Upload profile image"}
            </button>
            <p className="mt-2 text-xs text-[var(--muted)]">JPEG, PNG or WebP. Up to 5MB.</p>
            {errors.avatarKey && (
              <p className="mt-2 text-xs text-[var(--danger)]">{errors.avatarKey}</p>
            )}
          </div>
        </div>

        <Field label="PROFILE URL" error={errors.username}>
          <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3">
            <span className="shrink-0 text-sm text-[var(--muted)]">{appHost}/</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              spellCheck={false}
              autoCapitalize="none"
              className="w-full bg-transparent py-2.5 text-sm outline-none"
            />
          </div>
          <p className="mt-1.5 text-xs text-[var(--muted)]">
            Letters, numbers and underscores.{" "}
            {handleHint === "available" ? (
              <span className="text-[var(--accent)]">Available.</span>
            ) : handleHint ? (
              <span className="text-[var(--warn)]">{handleHint}</span>
            ) : null}
          </p>
        </Field>

        <Field label="ONE-LINE BIO" error={errors.bio}>
          <input
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, MAX_BIO_LENGTH))}
            placeholder="IFBB Pro / Posing & frame correction specialist"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
          />
          <p className="mt-1.5 text-right text-xs text-[var(--muted)]">
            {bio.length}/{MAX_BIO_LENGTH}
          </p>
        </Field>

        <Field label="SPECIALTY CATEGORY" error={errors.category}>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
          >
            <option value="">Select category</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="INSTAGRAM" error={errors.instagram} tight>
            <input
              value={instagram}
              onChange={(e) => setInstagram(e.target.value)}
              placeholder="@username"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
            />
          </Field>
          <Field label="YOUTUBE" error={errors.youtube} tight>
            <input
              value={youtube}
              onChange={(e) => setYoutube(e.target.value)}
              placeholder="@channel"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
            />
          </Field>
        </div>

        <Field label={`PORTFOLIO LINKS (UP TO ${MAX_PORTFOLIO_LINKS})`} error={errors.portfolio}>
          <div className="space-y-2">
            {portfolioRows.map((url, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={url}
                  onChange={(e) => {
                    const next = [...portfolio];
                    next[i] = e.target.value;
                    setPortfolio(next);
                  }}
                  placeholder="https://instagram.com/reel/..."
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
                />
                <button
                  onClick={() => {
                    const next = portfolio.filter((_, j) => j !== i);
                    setPortfolio(next.length ? next : [""]);
                  }}
                  aria-label="Remove link"
                  className="shrink-0 rounded-lg border border-[var(--border)] px-3 text-sm text-[var(--muted)] transition hover:text-[var(--foreground)]"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
          {portfolioRows.length < MAX_PORTFOLIO_LINKS && (
            <button
              onClick={() => setPortfolio([...portfolio, ""])}
              className="mt-2 text-sm text-[var(--muted)] underline underline-offset-4 hover:text-[var(--foreground)]"
            >
              + Add another link
            </button>
          )}
        </Field>
      </section>

      <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="text-sm font-semibold tracking-wide text-[var(--muted)]">
          1:1 VIDEO COACHING PASS
        </h2>

        <Field label="PRICE" error={errors.price}>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3">
              <span className="text-sm text-[var(--muted)]">$</span>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                inputMode="decimal"
                className="w-28 bg-transparent py-2.5 text-sm outline-none"
              />
            </div>
            <span className="text-xs text-[var(--muted)]">
              You keep 80%. $30 to $500.
            </span>
          </div>
        </Field>

        <label className="mt-5 flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
          />
          <span className="text-sm">
            Enable coaching pass
            <span className="mt-0.5 block text-xs text-[var(--muted)]">
              Shows the booking button on your public page.
            </span>
          </span>
        </label>

        {enabled && !payoutsActive && (
          <p className="mt-4 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/10 p-4 text-sm text-[var(--warn)]">
            Your page stays unbookable until Stripe confirms you can receive
            payouts. Nothing else is needed from you here - it switches on by
            itself once Stripe is done.
          </p>
        )}
      </section>

      {errors.form && <p className="mt-4 text-sm text-[var(--danger)]">{errors.form}</p>}

      {/* Sticky save bar, per the spec. Only rendered once something changed,
          so it never sits over the page demanding attention for nothing. */}
      {(dirty || saving) && (
        <div className="fixed inset-x-0 bottom-0 border-t border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-3">
            <span className="text-sm text-[var(--muted)]">Unsaved changes</span>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-[var(--accent)] px-5 py-2.5 font-semibold text-[var(--on-accent)] transition hover:brightness-110 disabled:bg-[var(--surface-2)] disabled:text-[var(--muted)]"
            >
              {saving ? "Saving..." : "Save profile changes"}
            </button>
          </div>
        </div>
      )}

      {saved && !dirty && (
        <p className="mt-4 text-sm text-[var(--accent)]">Profile saved.</p>
      )}
    </div>
  );
}

function Field({
  label,
  error,
  tight,
  children,
}: {
  label: string;
  error?: string;
  tight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={tight ? "" : "mt-5"}>
      <label className="block text-xs font-semibold tracking-wide text-[var(--muted)]">
        {label}
      </label>
      <div className="mt-2">{children}</div>
      {error && <p className="mt-1.5 text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}
