import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface ProbedVideo {
  durationSeconds: number;
  video: { codec: string; width: number; height: number; pixelFormat: string };
  audio: { codec: string; bitRate: number; sampleRate: number };
}

export async function probeVideo(file: string): Promise<ProbedVideo> {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", file]);
  const info = JSON.parse(stdout);
  const v = info.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  const a = info.streams.find((s: { codec_type: string }) => s.codec_type === "audio");
  return {
    durationSeconds: Number(info.format.duration),
    video: { codec: v.codec_name, width: v.width, height: v.height, pixelFormat: v.pix_fmt },
    audio: { codec: a.codec_name, bitRate: Number(a.bit_rate), sampleRate: Number(a.sample_rate) },
  };
}

export interface GrayFrame {
  width: number;
  height: number;
  /** One luminance byte per pixel, row by row. */
  pixels: Buffer;
}

/** Decodes the single video frame showing at `seconds`, as 8-bit luminance. */
export async function frameAt(file: string, seconds: number): Promise<GrayFrame> {
  const { video } = await probeVideo(file);
  const { stdout } = await exec(
    "ffmpeg",
    ["-v", "error", "-ss", String(seconds), "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    { encoding: "buffer", maxBuffer: video.width * video.height * 2 },
  );
  return { width: video.width, height: video.height, pixels: stdout };
}

export interface TextRow {
  top: number;
  bottom: number;
  /** Leftmost bright pixel in the row — the ▶ when the row is marked, else the text. */
  left: number;
}

/**
 * Finds the rows of bright (Tracklist) text in a frame by scanning for horizontal bands of
 * near-white pixels. Knows nothing about the template's layout constants on purpose.
 */
export function findTextRows(frame: GrayFrame, threshold = 200): TextRow[] {
  const { width, height, pixels } = frame;
  const rows: TextRow[] = [];
  let current: TextRow | undefined;
  let blankRun = 0;
  for (let y = 0; y < height; y++) {
    let left = -1;
    for (let x = 0; x < width; x++) {
      if (pixels[y * width + x]! > threshold) {
        left = x;
        break;
      }
    }
    if (left >= 0) {
      if (current && blankRun <= 12) {
        current.bottom = y;
        current.left = Math.min(current.left, left);
      } else {
        current = { top: y, bottom: y, left };
        rows.push(current);
      }
      blankRun = 0;
    } else {
      blankRun++;
    }
  }
  return rows;
}

/** Index of the one row that starts clearly further left than the others — where the ▶ is. */
export function markedRowIndex(rows: TextRow[]): number {
  const lefts = rows.map((r) => r.left).sort((a, b) => a - b);
  const typicalLeft = lefts[Math.floor(lefts.length / 2)]!;
  const marked = rows.flatMap((r, i) => (r.left < typicalLeft - 20 ? [i] : []));
  if (marked.length !== 1) throw new Error(`Expected exactly one marked row, found ${marked.length}: ${JSON.stringify(rows)}`);
  return marked[0]!;
}
