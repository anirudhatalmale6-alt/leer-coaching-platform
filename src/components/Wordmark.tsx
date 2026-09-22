/**
 * The LEER SPORTS lockup: wordmark plus slogan.
 *
 * Everything that renders the brand goes through here, so swapping the text
 * placeholder for the real logo file is a change to ONE component rather than
 * a hunt through every page. Drop the image in `public/`, replace the <span>
 * with an <Image>, and every screen updates at once.
 */
export default function Wordmark({
  size = "sm",
  slogan = false,
  className = "",
}: {
  size?: "sm" | "lg";
  /** The slogan sits under the mark; off in tight spots like the nav bar. */
  slogan?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex flex-col ${className}`}>
      {/* PLACEHOLDER - swap for the supplied logo image when it arrives. */}
      <span className={`wordmark ${size === "lg" ? "text-sm" : "text-xs"}`}>
        LEER SPORTS
      </span>
      {slogan && (
        <span className="mt-1 text-[0.625rem] font-semibold tracking-[0.28em] text-[var(--accent)]">
          I CAN DO THIS
        </span>
      )}
    </span>
  );
}
