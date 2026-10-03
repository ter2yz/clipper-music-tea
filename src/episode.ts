import path from "node:path";

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
