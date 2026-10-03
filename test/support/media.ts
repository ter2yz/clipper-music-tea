import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface ProbedVideo {
  durationSeconds: number;
  video: { codec: string; width: number; height: number; pixelFormat: string };
  audio: { codec: string; bitRate: number };
}

export async function probeVideo(file: string): Promise<ProbedVideo> {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", file]);
  const info = JSON.parse(stdout);
  const v = info.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  const a = info.streams.find((s: { codec_type: string }) => s.codec_type === "audio");
  return {
    durationSeconds: Number(info.format.duration),
    video: { codec: v.codec_name, width: v.width, height: v.height, pixelFormat: v.pix_fmt },
    audio: { codec: a.codec_name, bitRate: Number(a.bit_rate) },
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

export interface RgbFrame {
  width: number;
  height: number;
  /** Three bytes (R, G, B) per pixel, row by row. */
  pixels: Buffer;
}

/** Decodes the single video frame showing at `seconds`, as 8-bit RGB. */
export async function rgbFrameAt(file: string, seconds: number): Promise<RgbFrame> {
  const { video } = await probeVideo(file);
  const { stdout } = await exec(
    "ffmpeg",
    ["-v", "error", "-ss", String(seconds), "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { encoding: "buffer", maxBuffer: video.width * video.height * 4 },
  );
  return { width: video.width, height: video.height, pixels: stdout };
}

/**
 * Average colour of the ink (pixels brighter than `threshold` in `gray`) inside a box, read
 * from the same frame decoded as RGB.
 */
export function inkColour(gray: GrayFrame, rgb: RgbFrame, box: { left: number; right: number; top: number; bottom: number }, threshold: number): [number, number, number] {
  const sum = [0, 0, 0];
  let count = 0;
  for (let y = box.top; y <= box.bottom; y++) {
    for (let x = box.left; x <= box.right; x++) {
      if (gray.pixels[y * gray.width + x]! <= threshold) continue;
      for (let c = 0; c < 3; c++) sum[c]! += rgb.pixels[(y * rgb.width + x) * 3 + c]!;
      count++;
    }
  }
  if (count === 0) throw new Error(`No ink in ${JSON.stringify(box)}`);
  return sum.map((s) => Math.round(s / count)) as [number, number, number];
}

export interface TextRow {
  top: number;
  bottom: number;
  /** Leftmost bright pixel in the row — the ▶ when the row is marked, else the text. */
  left: number;
  /** Rightmost bright pixel in the row. */
  right: number;
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
    let right = -1;
    for (let x = 0; x < width; x++) {
      if (pixels[y * width + x]! > threshold) {
        if (left < 0) left = x;
        right = x;
      }
    }
    if (left >= 0) {
      if (current && blankRun <= 12) {
        current.bottom = y;
        current.left = Math.min(current.left, left);
        current.right = Math.max(current.right, right);
      } else {
        current = { top: y, bottom: y, left, right };
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

export interface Loudness {
  /** Integrated loudness, LUFS (−Infinity for digital silence). */
  integrated: number;
  /** True peak, dBTP (−Infinity for digital silence). */
  truePeak: number;
}

/**
 * EBU R128 loudness of the audio between `fromSeconds` and `toSeconds` (the whole file when
 * omitted). Read from loudnorm's measuring pass, whose meter is a separate implementation from
 * the ebur128 filter the render measures Tracks with, so a misreading meter can't hide itself.
 */
export async function measureLoudness(file: string, fromSeconds?: number, toSeconds?: number): Promise<Loudness> {
  const range = fromSeconds === undefined ? [] : ["-ss", String(fromSeconds), "-to", String(toSeconds)];
  const { stderr } = await exec("ffmpeg", ["-hide_banner", "-nostats", ...range, "-i", file, "-vn", "-af", "loudnorm=print_format=json", "-f", "null", "-"]);
  const stats = JSON.parse(stderr.slice(stderr.lastIndexOf("{"), stderr.lastIndexOf("}") + 1)) as Record<string, string>;
  const decibels = (value: string | undefined): number => {
    const number = value === "-inf" ? -Infinity : Number(value);
    if (Number.isNaN(number)) throw new Error(`Could not read loudness of ${file}:\n${JSON.stringify(stats)}`);
    return number;
  };
  return { integrated: decibels(stats.input_i), truePeak: decibels(stats.input_tp) };
}

/** Stretches of (near-)digital silence at least `minSeconds` long, as [start, end] in seconds. */
export async function findSilences(file: string, minSeconds: number): Promise<Array<[number, number]>> {
  const { stderr } = await exec("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", `silencedetect=noise=-80dB:d=${minSeconds}`, "-f", "null", "-"]);
  const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.map((start, i) => [start, ends[i] ?? Number.NaN]);
}
