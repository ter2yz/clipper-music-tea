import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { UserError } from "./errors.js";

/** One row of the Tracklist: which MP3 plays, and how it's written on screen. */
export interface TracklistEntry {
  file: string;
  title: string;
  artist: string;
}

/** An Episode as read from its Episode Folder's episode.yaml. */
export interface Episode {
  folder: string;
  approved: boolean;
  // Episode Settings (side, textColor, normalizeLoudness) are read here once they're supported.
  /** In play order. */
  tracklist: TracklistEntry[];
}

export const EPISODE_FILE = "episode.yaml";
export const OUT_DIR = "out";

export function displayName(entry: TracklistEntry): string {
  return `${entry.title} - ${entry.artist}`;
}

export function outPath(episode: Episode, file: string): string {
  return path.join(episode.folder, OUT_DIR, file);
}

/**
 * Reads episode.yaml. Deliberately lenient about shape: the rules about what makes an
 * Episode renderable live in validation, so every problem can be reported together.
 */
export async function readEpisode(folder: string): Promise<Episode> {
  const file = path.join(folder, EPISODE_FILE);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    throw new UserError(`No ${EPISODE_FILE} in ${folder}. Run /episode on the folder to propose one.`);
  }
  let doc: Record<string, unknown>;
  try {
    doc = (parse(raw) ?? {}) as Record<string, unknown>;
  } catch (error) {
    throw new UserError(`${file} is not valid YAML: ${(error as Error).message}`);
  }
  const tracks = Array.isArray(doc.tracks) ? doc.tracks : [];
  return {
    folder,
    approved: doc.approved === true,
    tracklist: tracks.map((t: Record<string, unknown>) => ({
      file: String(t?.file ?? ""),
      title: String(t?.title ?? ""),
      artist: String(t?.artist ?? ""),
    })),
  };
}
