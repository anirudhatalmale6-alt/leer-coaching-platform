import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

/**
 * Cloudflare R2 storage.
 *
 * R2 speaks the S3 API, so the AWS SDK drives it - but two settings are not
 * optional:
 *
 * 1. `region: "auto"`. R2 has no regions; the SDK still demands one to sign.
 * 2. Checksum calculation set to WHEN_REQUIRED. Recent AWS SDK versions send
 *    flexible-checksum headers (x-amz-checksum-crc32) on every request by
 *    default, and R2 rejects them with an opaque 400. Left on, uploads fail
 *    with an error that looks like a credentials problem and is not.
 *
 * R2 is deliberate rather than S3: coaching clips get replayed repeatedly, and
 * R2 charges nothing for egress.
 */

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100MB, per the spec
export const MAX_DURATION_SECONDS = 60; // per the spec, confirmed with the client

export const ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime", // what an iPhone actually produces
] as const;

export function storageConfigured(): boolean {
  return Boolean(
    process.env.R2_ENDPOINT &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET,
  );
}

let cached: S3Client | null = null;

export function getR2(): S3Client | null {
  if (!storageConfigured()) return null;
  if (!cached) {
    cached = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return cached;
}

export type UploadValidation =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Server-side gate on what may be uploaded.
 *
 * Duration cannot be checked here - it is only knowable by decoding the file -
 * so the browser measures it before requesting a URL and the value is recorded
 * alongside the object. Size and type ARE enforced here, and the signed URL
 * pins the exact byte count so a client cannot request permission for 1MB and
 * then push 4GB through the door.
 */
export function validateUpload(input: {
  contentType: string;
  size: number;
  durationSeconds?: number;
}): UploadValidation {
  if (!ALLOWED_VIDEO_TYPES.includes(input.contentType as (typeof ALLOWED_VIDEO_TYPES)[number])) {
    return { ok: false, reason: `Unsupported format. Use MP4, WebM or MOV.` };
  }
  if (!Number.isFinite(input.size) || input.size <= 0) {
    return { ok: false, reason: "Invalid file size." };
  }
  if (input.size > MAX_UPLOAD_BYTES) {
    const mb = (input.size / 1024 / 1024).toFixed(1);
    return { ok: false, reason: `That clip is ${mb}MB. The limit is 100MB.` };
  }
  if (input.durationSeconds !== undefined) {
    if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) {
      return { ok: false, reason: "Could not read the clip's length." };
    }
    // A small tolerance: a 60.0s clip often measures 60.03 depending on how the
    // encoder rounded the last frame, and rejecting those would be maddening.
    if (input.durationSeconds > MAX_DURATION_SECONDS + 0.5) {
      return {
        ok: false,
        reason: `That clip is ${input.durationSeconds.toFixed(1)}s. The limit is 60s.`,
      };
    }
  }
  return { ok: true };
}

/**
 * Profile images.
 *
 * Far smaller limit than a clip, and a much narrower type list: this file is
 * rendered in an <img> on a public page, and SVG is a script execution vector
 * when served from your own origin, so it is deliberately not allowed.
 */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export function validateAvatar(input: {
  contentType: string;
  size: number;
}): UploadValidation {
  if (!ALLOWED_IMAGE_TYPES.includes(input.contentType as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    return { ok: false, reason: "Use a JPEG, PNG or WebP image." };
  }
  if (!Number.isFinite(input.size) || input.size <= 0) {
    return { ok: false, reason: "Invalid file size." };
  }
  if (input.size > MAX_AVATAR_BYTES) {
    const mb = (input.size / 1024 / 1024).toFixed(1);
    return { ok: false, reason: `That image is ${mb}MB. The limit is 5MB.` };
  }
  return { ok: true };
}

const EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Object key for an upload.
 *
 * Unguessable by construction. Coaching footage is a person's body, often a
 * minor's, and a predictable key is a directory listing for anyone who finds
 * the bucket hostname. The owner is in the path for operational sanity, not as
 * a security boundary - access is controlled by signed URLs.
 */
export function buildObjectKey(userId: string, contentType: string): string {
  const ext = EXT[contentType] ?? "bin";
  return `uploads/${userId}/${randomUUID()}.${ext}`;
}

/**
 * Object key for a profile image.
 *
 * A separate `avatars/` prefix, not `uploads/`, because the two have different
 * exposure: coaching footage is private to two people, while an avatar is
 * served to anyone who opens the trainer's public page. Keeping them apart
 * means a future bucket rule can treat them differently, and it keeps the
 * ownership check on /api/rooms ("the key must start uploads/<buyer>/") from
 * ever matching an image.
 *
 * Still a random UUID: overwriting a fixed key would leave the old image in
 * every CDN and browser cache that had already seen it.
 */
export function buildAvatarKey(userId: string, contentType: string): string {
  const ext = EXT[contentType] ?? "bin";
  return `avatars/${userId}/${randomUUID()}.${ext}`;
}

/** A short-lived URL the browser PUTs the file straight to. */
export async function signUpload(key: string, contentType: string, size: number) {
  const client = getR2();
  if (!client) throw new Error("Storage is not configured");

  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET!,
      Key: key,
      ContentType: contentType,
      // Signing the length pins it: a client that sends a different
      // Content-Length fails signature verification, so the 100MB cap is
      // enforced by R2 itself rather than by trusting the browser.
      ContentLength: size,
    }),
    { expiresIn: 600 },
  );
}

/** A short-lived URL for playback. Coaching footage is never public. */
export async function signPlayback(key: string, seconds = 3600) {
  const client = getR2();
  if (!client) throw new Error("Storage is not configured");

  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key }),
    { expiresIn: seconds },
  );
}
