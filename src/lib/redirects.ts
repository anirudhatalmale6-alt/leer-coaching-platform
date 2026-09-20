/**
 * Where to send somebody after they sign in.
 *
 * This value arrives in a query string, so it is attacker-controlled: a link
 * like /signin?next=https://evil.example/login sends a trainee to a copy of
 * LEER's sign-in page with LEER's own domain in the referrer. That is a
 * textbook open redirect, and it is worth more to a phisher here than almost
 * anywhere else in the app, because the people following these links arrived
 * from a social bio and are about to type card details.
 *
 * Only a plain in-app path survives.
 */
export const DEFAULT_AFTER_SIGN_IN = "/dashboard";

export function safeNext(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_AFTER_SIGN_IN;

  // Must be a rooted path. Anything with a scheme is out.
  if (!raw.startsWith("/")) return DEFAULT_AFTER_SIGN_IN;

  // "//evil.com" is protocol-relative: the browser treats it as a full URL and
  // leaves the site. So is "/\evil.com" in several browsers, which normalise
  // the backslash to a forward slash.
  if (raw.startsWith("//") || raw.startsWith("/\\")) return DEFAULT_AFTER_SIGN_IN;

  // A control character can be used to smuggle the above past a naive check.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(raw)) return DEFAULT_AFTER_SIGN_IN;

  return raw;
}
