import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Runs ffmpeg (from PATH) quietly; a failure carries ffmpeg's own error output. */
export async function ffmpeg(args: string[]): Promise<void> {
  try {
    await exec("ffmpeg", ["-hide_banner", "-nostdin", "-v", "error", "-y", ...args], { maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";
    throw new Error(`ffmpeg failed: ${stderr.trim() || String(error)}`);
  }
}

/** Duration in seconds, as ffprobe reports it for the container. */
export async function probeDurationSeconds(file: string): Promise<number> {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds)) throw new Error(`ffprobe could not read a duration from ${file}`);
  return seconds;
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
