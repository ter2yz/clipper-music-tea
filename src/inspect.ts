import { access } from "node:fs/promises";
import path from "node:path";
import { EPISODE_FILE } from "./episode.js";
import { listEpisodeFolder } from "./episodeFolder.js";
import { probeDurationAndTags } from "./media/ffmpeg.js";

/**
 * The raw facts about an Episode Folder that /episode starts from when proposing a Tracklist.
 * Tags are reported as found — they are evidence for a Display Name, often wrong, never the answer.
 */
export interface FolderInspection {
  folder: string;
  hasEpisodeYaml: boolean;
  /** Images that could be the Background (validation wants exactly one). */
  backgroundCandidates: string[];
  /** Every Track, in file-name order. */
  tracks: TrackFacts[];
}

export interface TrackFacts {
  file: string;
  durationSeconds: number;
  /** Embedded tags, keys lower-cased. */
  tags: Record<string, string>;
}

export async function inspectEpisodeFolder(folder: string): Promise<FolderInspection> {
  const { tracks, backgroundCandidates } = await listEpisodeFolder(folder);
  return {
    folder,
    hasEpisodeYaml: await access(path.join(folder, EPISODE_FILE)).then(() => true, () => false),
    backgroundCandidates,
    tracks: await Promise.all(tracks.map(async (file) => ({ file, ...(await probeDurationAndTags(path.join(folder, file))) }))),
  };
}
