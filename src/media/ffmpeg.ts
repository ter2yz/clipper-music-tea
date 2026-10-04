import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Runs ffmpeg (from PATH) quietly; a failure carries ffmpeg's own error output. */
export async function ffmpeg(args: string[]): Promise<void> {
  await runFfmpeg("error", args);
}

/**
 * Runs ffmpeg for what it logs rather than what it writes (e.g. a meter's summary): returns
 * stderr at info level. A failure carries ffmpeg's own error output.
 */
export async function ffmpegLog(args: string[]): Promise<string> {
  return runFfmpeg("info", ["-nostats", ...args]);
}

async function runFfmpeg(logLevel: "error" | "info", args: string[]): Promise<string> {
  try {
    const { stderr } = await exec("ffmpeg", ["-hide_banner", "-nostdin", "-v", logLevel, "-y", ...args], { maxBuffer: 64 * 1024 * 1024 });
    return stderr;
  } catch (error) {
    // At info level stderr is mostly chatter; the error is at the end.
    const stderr = ((error as { stderr?: string }).stderr ?? "").trim().split("\n").slice(-10).join("\n");
    throw new Error(`ffmpeg failed: ${stderr || String(error)}`);
  }
}

/** Number of audio samples (per channel) in a PCM file's first audio stream. */
export async function probeSampleCount(file: string): Promise<number> {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=duration_ts", "-of", "csv=p=0", file]);
  const samples = Number(stdout.trim());
  if (!Number.isInteger(samples) || samples < 0) throw new Error(`ffprobe could not read a sample count from ${file}`);
  return samples;
}

/** Duration in seconds, as ffprobe reports it for the container. */
export async function probeDurationSeconds(file: string): Promise<number> {
  return (await probeDurationAndTags(file)).durationSeconds;
}

/** Writes an ffmpeg concat-demuxer list that plays `files` back to back. */
export async function writeConcatList(listFile: string, files: string[]): Promise<void> {
  const lines = files.map((file) => `file '${file.replace(/'/g, "'\\''")}'`);
  await writeFile(listFile, lines.join("\n") + "\n");
}

/** Pixel width of an image (or a video's first video stream). */
export async function probeWidth(file: string): Promise<number> {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "csv=p=0", file]);
  const width = Number(stdout.trim());
  if (!Number.isInteger(width) || width <= 0) throw new Error(`ffprobe could not read a width from ${file}`);
  return width;
}

/** Container duration in seconds and its embedded tags (keys lower-cased), as ffprobe reports them. */
export async function probeDurationAndTags(file: string): Promise<{ durationSeconds: number; tags: Record<string, string> }> {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration:format_tags", "-of", "json", file]);
  const format = (JSON.parse(stdout) as { format?: { duration?: string; tags?: Record<string, unknown> } }).format ?? {};
  const durationSeconds = Number(format.duration);
  if (!Number.isFinite(durationSeconds)) throw new Error(`ffprobe could not read a duration from ${file}`);
  const tags = Object.fromEntries(Object.entries(format.tags ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return { durationSeconds, tags };
}
