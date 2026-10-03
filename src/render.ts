import { copyFile, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { displayName, outPath, type Episode } from "./episode.js";
import { findBackground } from "./episodeFolder.js";
import { decodeTrack, joinWithGaps } from "./media/audio.js";
import { probeDurationSeconds } from "./media/ffmpeg.js";
import { encodeStillSegments, muxEpisode } from "./media/video.js";
import { GAP_SECONDS, planTimeline, timestampsText } from "./timeline.js";
import { renderTracklistOverlays } from "./tracklist/overlays.js";
import { VIDEO_FRAME } from "./tracklist/template.js";

export interface RenderResult {
  video: string;
  timestamps: string;
}

export interface RenderIo {
  log: (line: string) => void;
}

/**
 * Renders an already-validated Episode into out/video.mp4 and out/timestamps.txt. Everything,
 * outputs included, is built in a temporary work directory that is always removed, so a
 * failed render leaves out/ as it was.
 */
export async function renderEpisode(episode: Episode, io: RenderIo): Promise<RenderResult> {
  const background = await findBackground(episode.folder);
  const workDir = await mkdtemp(path.join(tmpdir(), "clipper-render-"));
  try {
    io.log(`Decoding ${episode.tracklist.length} Tracks${episode.normalizeLoudness ? " and levelling their loudness" : ""}…`);
    const trackWavs = episode.tracklist.map((_, i) => path.join(workDir, `track-${i + 1}.wav`));
    await Promise.all(episode.tracklist.map((entry, i) => decodeTrack(path.join(episode.folder, entry.file), trackWavs[i]!, { normalizeLoudness: episode.normalizeLoudness })));
    const durations = await Promise.all(trackWavs.map(probeDurationSeconds));
    const timeline = planTimeline(durations);

    const audioList = await joinWithGaps(trackWavs, GAP_SECONDS, workDir);

    io.log("Drawing Tracklist overlays…");
    const displayNames = episode.tracklist.map(displayName);
    const overlays = await renderTracklistOverlays(displayNames, VIDEO_FRAME, workDir);

    io.log("Encoding video…");
    const videoList = await encodeStillSegments(
      background,
      overlays.map((overlay, i) => ({ overlay, startSeconds: timeline.trackStarts[i]! })),
      timeline.totalSeconds,
      VIDEO_FRAME,
      workDir,
    );

    // Both outputs are finished in the work dir first, then moved into out/ together.
    const finishedVideo = path.join(workDir, "video.mp4");
    await muxEpisode(videoList, audioList, finishedVideo);
    const finishedTimestamps = path.join(workDir, "timestamps.txt");
    await writeFile(finishedTimestamps, timestampsText(displayNames, timeline));

    await mkdir(outPath(episode, ""), { recursive: true });
    const video = outPath(episode, "video.mp4");
    const timestamps = outPath(episode, "timestamps.txt");
    await moveFile(finishedVideo, video);
    await moveFile(finishedTimestamps, timestamps);

    return { video, timestamps };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/** Moves a file into place, falling back to copy when the work dir is on another volume. */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    const partial = `${to}.partial`;
    await copyFile(from, partial);
    await rename(partial, to);
  }
}
