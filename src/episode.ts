import path from "node:path";
import type { Side } from "./tracklist/template.js";

/** One row of the Tracklist: which MP3 plays, and how it's written on screen. */
export interface TracklistEntry {
  file: string;
  title: string;
  artist: string;
}

/** An Episode as read from its Episode Folder's episode.yaml (see validation's checkEpisodeFolder). */
export interface Episode {
  folder: string;
  approved: boolean;
  // Episode Settings, with the house style filled in for anything not set.
  /** Which side of the frame the Tracklist sits on (default right). */
  side: Side;
  /** CSS colour of the Tracklist text and ▶ (default white). */
  textColor: string;
  /** Level every Track to the house loudness before joining (default true). */
  normalizeLoudness: boolean;
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
