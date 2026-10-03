import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { stringify } from "yaml";

const exec = promisify(execFile);

export interface FixtureTrack {
  /** File name of the Track inside the Episode Folder. */
  file: string;
  /** Exact length of the generated tone, in seconds. */
  seconds: number;
  /**
   * What the Track sounds like (default `tone`). `noise` is dense stereo noise, enough to fill
   * a 320 kbps AAC stream; `silence` is fast to generate even for hour-long Tracks.
   */
  signal?: "tone" | "noise" | "silence";
  /** Tone frequency in Hz (for `tone`). */
  frequency?: number;
  /** Display Name parts written to episode.yaml. */
  title: string;
  artist: string;
  /** Embedded MP3 tags — deliberately allowed to disagree with the Display Name. */
  tags?: { title?: string; artist?: string };
}

export interface FixtureEpisode {
  tracks: FixtureTrack[];
  approved?: boolean;
  /** `null` leaves the Episode Folder without a Background. */
  background?: { file?: string; width: number; height: number } | null;
}

const DEFAULT_BACKGROUND = { file: "background.png", width: 4000, height: 2400 };

/** Builds a throwaway Episode Folder: generated MP3 tones, a generated Background and an episode.yaml. */
const root = path.join(tmpdir(), "clipper-music-tea-tests");
const cacheDir = path.join(root, "fixture-cache");

export async function makeEpisodeFolder(episode: FixtureEpisode): Promise<string> {
  await mkdir(cacheDir, { recursive: true });
  const folder = await mkdtemp(path.join(root, "episode-"));

  await Promise.all(episode.tracks.map((track) => makeToneMp3(path.join(folder, track.file), track)));

  if (episode.background !== null) {
    const background = { ...DEFAULT_BACKGROUND, ...episode.background };
    await addImage(folder, background.file, background.width, background.height);
  }

  await writeEpisodeYaml(folder, {
    approved: episode.approved ?? true,
    tracks: episode.tracks.map(({ file, title, artist }) => ({ file, title, artist })),
  });
  return folder;
}

export async function writeEpisodeYaml(folder: string, content: unknown): Promise<void> {
  await writeFile(path.join(folder, "episode.yaml"), stringify(content));
}

/** Adds a generated MP3 to `folder` (a path relative to the Episode Folder, e.g. `out/old.mp3`) without listing it. */
export async function addMp3(folder: string, file: string, seconds = 1): Promise<void> {
  await mkdir(path.dirname(path.join(folder, file)), { recursive: true });
  await makeToneMp3(path.join(folder, file), { file, seconds, title: "", artist: "" });
}

/** Adds a plain generated image to `folder` (a path relative to the Episode Folder, e.g. `out/frame.png`). */
export async function addImage(folder: string, file: string, width = 1000, height = 600): Promise<void> {
  await mkdir(path.dirname(path.join(folder, file)), { recursive: true });
  await makeBackground(path.join(folder, file), width, height);
}

/**
 * Generated MP3s are cached by their recipe (in the OS temp dir, never in the repo) so the
 * hour-long fixture is only made once per machine.
 */
async function makeToneMp3(file: string, track: FixtureTrack): Promise<void> {
  const recipe = JSON.stringify([track.signal ?? "tone", track.seconds, track.frequency ?? 440, track.tags ?? {}]);
  const cached = path.join(cacheDir, `${createHash("sha1").update(recipe).digest("hex")}.mp3`);
  if (!existsSync(cached)) {
    const partial = `${cached}.${randomUUID()}.partial.mp3`;
    await generateMp3(partial, track);
    await rename(partial, cached);
  }
  await copyFile(cached, file);
}

async function generateMp3(file: string, track: FixtureTrack): Promise<void> {
  const d = track.seconds;
  const sources = {
    tone: ["-f", "lavfi", "-i", `sine=frequency=${track.frequency ?? 440}:sample_rate=44100:duration=${d}`, "-b:a", "128k"],
    noise: [
      "-f", "lavfi", "-i",
      `anoisesrc=d=${d}:c=white:a=0.3:r=44100:s=1[l];anoisesrc=d=${d}:c=white:a=0.3:r=44100:s=2[r];[l][r]amerge=inputs=2[out0]`,
      "-b:a", "192k",
    ],
    // Low sample rate and bitrate so hour-long fixtures take seconds to make.
    silence: ["-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono", "-t", String(d), "-b:a", "8k"],
  };
  const tags = Object.entries(track.tags ?? {}).flatMap(([key, value]) => ["-metadata", `${key}=${value}`]);
  await exec("ffmpeg", ["-v", "error", "-y", ...sources[track.signal ?? "tone"], "-c:a", "libmp3lame", ...tags, file]);
}

/** A plain dark image, so white Tracklist text is easy to find in sampled frames. */
async function makeBackground(file: string, width: number, height: number): Promise<void> {
  await exec("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", `color=c=0x18222e:s=${width}x${height}`,
    "-frames:v", "1", file,
  ]);
}
