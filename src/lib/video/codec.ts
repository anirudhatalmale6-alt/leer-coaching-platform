/**
 * Work out which video codec a clip actually uses, by reading the file.
 *
 * WHY THIS EXISTS
 *
 * An iPhone set to "High Efficiency" - which is the default - records HEVC
 * (H.265) inside a .mov container. Safari plays it. Chrome and Firefox are
 * inconsistent: support depends on the machine's hardware decoder, so it works
 * on one laptop and shows a black rectangle on another. The failure is silent
 * and it lands on the wrong person: the trainee films and uploads happily, and
 * the COACH opens a black screen with 24 hours to deliver feedback on it.
 *
 * Transcoding was ruled out of scope by the client, so the answer is to detect
 * it at upload and tell the trainee, in their own words, how to fix it.
 *
 * WHY NOT JUST LOOK AT THE FILE EXTENSION
 *
 * Because .mov says nothing about the codec - a .mov can hold H.264 and play
 * everywhere, and an .mp4 can hold HEVC and not. Warning on ".mov" would nag
 * people whose files are fine while missing files that are broken.
 *
 * WHY NOT JUST ASK THE BROWSER
 *
 * `canPlayType` answers for the browser doing the asking. A trainee uploading
 * from an iPhone is on Safari, which says yes to HEVC - and their coach is the
 * one who cannot open it. The question is what the FILE is, not what this
 * machine can read.
 *
 * HOW
 *
 * MP4 and MOV are both ISO base media format: a tree of boxes, each a 4-byte
 * size then a 4-byte type. The codec is the "format" field of the sample entry
 * inside moov > trak > mdia > minf > stbl > stsd. Reading it is a walk, not a
 * decode, so it costs nothing and needs no library.
 */

/** Video codecs we can name from a sample entry. */
export type VideoCodec =
  | "h264"
  | "hevc"
  | "av1"
  | "vp9"
  | "vp8"
  | "mpeg4"
  | "prores"
  | "unknown";

/** Sample-entry four-character codes, mapped to something a human can read. */
const VIDEO_FOURCC: Record<string, VideoCodec> = {
  avc1: "h264",
  avc3: "h264",
  // hvc1 and hev1 differ only in where the parameter sets live; both are HEVC.
  hvc1: "hevc",
  hev1: "hevc",
  // Dolby Vision profiles that carry an HEVC base layer - same decode problem.
  dvh1: "hevc",
  dvhe: "hevc",
  av01: "av1",
  vp09: "vp9",
  vp08: "vp8",
  mp4v: "mpeg4",
  // Apple ProRes, occasionally produced by editing apps exporting "best quality".
  apch: "prores",
  apcn: "prores",
  apcs: "prores",
  apco: "prores",
  ap4h: "prores",
};

/** Audio entries live in the same table; recognising them avoids false hits. */
const AUDIO_FOURCC = new Set(["mp4a", "ac-3", "ec-3", "alac", "sowt", "twos", "in24", "lpcm", "Opus", "fLaC"]);

export type CodecReport = {
  codec: VideoCodec;
  /** The raw four-character code, for support when something is unrecognised. */
  fourcc: string | null;
  /** True when this clip is likely to fail on a coach's Chrome or Firefox. */
  risky: boolean;
};

const CONTAINER_BOXES = new Set(["moov", "trak", "mdia", "minf", "stbl"]);

type BoxHeader = { type: string; headerSize: number; size: number };

/**
 * Read one box header.
 *
 * size === 1 means the real size is a 64-bit value after the type; size === 0
 * means "to the end of the file". Both appear in real files - a long clip from
 * a phone routinely exceeds the 32-bit size field - and mishandling either
 * makes the walk run off into nonsense.
 */
export function readBoxHeader(bytes: Uint8Array, offset: number): BoxHeader | null {
  if (offset + 8 > bytes.length) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let size = view.getUint32(offset);
  const type = String.fromCharCode(
    bytes[offset + 4],
    bytes[offset + 5],
    bytes[offset + 6],
    bytes[offset + 7],
  );
  let headerSize = 8;

  if (size === 1) {
    if (offset + 16 > bytes.length) return null;
    const high = view.getUint32(offset + 8);
    const low = view.getUint32(offset + 12);
    // Number is exact to 2^53; a video box cannot approach that.
    size = high * 2 ** 32 + low;
    headerSize = 16;
  } else if (size === 0) {
    size = bytes.length - offset;
  }

  if (size < headerSize) return null; // Malformed: would loop forever.
  return { type, headerSize, size };
}

/**
 * Find a top-level box by type, returning where it starts and how long it is.
 *
 * Used to locate `moov` without reading the whole file. In an iPhone .mov the
 * moov box is very often written AFTER the media data, so a naive "read the
 * first megabyte and look" finds nothing on exactly the files this check
 * exists for.
 */
export function findBox(bytes: Uint8Array, type: string, start = 0, end = bytes.length) {
  let offset = start;
  while (offset < end) {
    const header = readBoxHeader(bytes, offset);
    if (!header) return null;
    if (header.type === type) return { offset, ...header };
    offset += header.size;
  }
  return null;
}

/**
 * Walk into container boxes and read the first video sample entry found.
 *
 * `bytes` should span the whole moov box.
 */
export function readCodecFromMoov(bytes: Uint8Array, start = 0, end = bytes.length): CodecReport {
  let offset = start;

  while (offset < end) {
    const header = readBoxHeader(bytes, offset);
    if (!header) break;

    const contentStart = offset + header.headerSize;
    const contentEnd = Math.min(offset + header.size, end);

    if (CONTAINER_BOXES.has(header.type)) {
      const found = readCodecFromMoov(bytes, contentStart, contentEnd);
      // Keep looking through later traks: the first one may be audio.
      if (found.fourcc) return found;
    } else if (header.type === "stsd") {
      const found = readSampleDescription(bytes, contentStart, contentEnd);
      if (found) return found;
    }

    offset += header.size;
  }

  return { codec: "unknown", fourcc: null, risky: false };
}

/**
 * stsd: a 1-byte version, 3 flag bytes, a 4-byte entry count, then entries -
 * each a standard box whose type IS the codec.
 */
function readSampleDescription(bytes: Uint8Array, start: number, end: number): CodecReport | null {
  let offset = start + 8; // version + flags + entry_count

  while (offset < end) {
    const header = readBoxHeader(bytes, offset);
    if (!header) return null;

    if (!AUDIO_FOURCC.has(header.type)) {
      const codec = VIDEO_FOURCC[header.type];
      if (codec) {
        return { codec, fourcc: header.type, risky: codec === "hevc" || codec === "prores" };
      }
    }
    offset += header.size;
  }
  return null;
}

/**
 * Read the codec out of a File without loading it into memory.
 *
 * Walks the top-level boxes by reading 8-byte headers and skipping over each
 * box's length, so finding `moov` in a 100MB clip costs a handful of small
 * reads. This is why it is a walk rather than "read the first megabyte": every
 * fixture ffmpeg produces for .mov puts moov AFTER the media data, and so do
 * iPhones - the files this check exists for are exactly the ones where the
 * naive approach finds nothing.
 *
 * Returns `unknown` rather than throwing on anything it cannot parse. A clip
 * that fails to parse must still be uploadable; this is advice, not a gate.
 */
export async function detectCodecFromFile(file: Blob): Promise<CodecReport> {
  const UNKNOWN: CodecReport = { codec: "unknown", fourcc: null, risky: false };

  try {
    let offset = 0;
    // A guard against a malformed file turning this into an infinite loop.
    for (let box = 0; box < 64 && offset < file.size; box++) {
      const headerBytes = new Uint8Array(
        await file.slice(offset, Math.min(offset + 16, file.size)).arrayBuffer(),
      );
      const header = readBoxHeader(headerBytes, 0);
      if (!header) return UNKNOWN;

      if (header.type === "moov") {
        const moov = new Uint8Array(
          await file.slice(offset, Math.min(offset + header.size, file.size)).arrayBuffer(),
        );
        return readCodecFromMoov(moov, header.headerSize, moov.length);
      }
      offset += header.size;
    }
  } catch {
    return UNKNOWN;
  }
  return UNKNOWN;
}

/** Guidance for a trainee whose clip may not open for their coach. */
export function codecWarning(report: CodecReport): string | null {
  if (!report.risky) return null;

  if (report.codec === "hevc") {
    return (
      "This clip is HEVC (H.265), which iPhones record by default. It plays on " +
      "an iPhone and in Safari, but often shows as a black screen in Chrome - " +
      "which may be what your coach uses. To be safe: on your iPhone go to " +
      "Settings > Camera > Formats and choose \"Most Compatible\", then re-record; " +
      "or export the clip as H.264/MP4 before uploading."
    );
  }
  if (report.codec === "prores") {
    return (
      "This clip is Apple ProRes, an editing format most browsers cannot play. " +
      "Export it as H.264/MP4 before uploading."
    );
  }
  return null;
}

/**
 * Can the browser running this code actually decode the clip?
 *
 * Only a secondary signal - the coach's browser is the one that matters - but
 * when the answer is no even here, the warning is not hypothetical.
 */
export function browserCanPlay(report: CodecReport): boolean | null {
  if (typeof document === "undefined") return null;
  const probe = document.createElement("video");

  const types: Partial<Record<VideoCodec, string>> = {
    hevc: 'video/mp4; codecs="hvc1"',
    h264: 'video/mp4; codecs="avc1.42E01E"',
    av1: 'video/mp4; codecs="av01.0.05M.08"',
    vp9: 'video/webm; codecs="vp9"',
  };

  const type = types[report.codec];
  if (!type) return null;
  // "maybe" and "probably" both mean it will try; "" means it will not.
  return probe.canPlayType(type) !== "";
}
