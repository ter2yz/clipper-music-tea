import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { displayName, outPath, type Episode } from "./episode.js";
import { findBackground } from "./episodeFolder.js";
import { decodeTrack, makeSilence } from "./media/audio.js";
import { probeDurationSeconds } from "./media/ffmpeg.js";
import { concatEntry, encodeStillSegments, muxEpisode } from "./media/video.js";
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
 * Renders an already-validated Episode into out/video.mp4. Intermediate files live in a
 * temporary work directory; outputs are written under a temporary name and then renamed,
 * so a failed render never leaves a half-written video behind.
 */
export async function renderEpisode(episode: Episode, io: RenderIo): Promise<RenderResult> {
  const background = await findBackground(episode.folder);
  const workDir = await mkdtemp(path.join(tmpdir(), "clipper-render-"));
  try {
    io.log(`Decoding ${episode.tracklist.length} Tracks…`);
    const trackWavs = episode.tracklist.map((_, i) => path.join(workDir, `track-${i + 1}.wav`));
    await Promise.all(episode.tracklist.map((entry, i) => decodeTrack(path.join(episode.folder, entry.file), trackWavs[i]!)));
    const durations = await Promise.all(trackWavs.map(probeDurationSeconds));
    const timeline = planTimeline(durations);

    const gapWav = path.join(workDir, "gap.wav");
    await makeSilence(GAP_SECONDS, gapWav);
    const audioList = path.join(workDir, "audio.txt");
    const audioParts = trackWavs.flatMap((wav, i) => (i === 0 ? [wav] : [gapWav, wav]));
    await writeFile(audioList, audioParts.map(concatEntry).join("\n") + "\n");

    io.log("Drawing Tracklist overlays…");
    const rows = episode.tracklist.map(displayName);
    const overlays = await renderTracklistOverlays(rows, VIDEO_FRAME, workDir);

    io.log("Encoding video…");
    const videoList = await encodeStillSegments(
      background,
      overlays.map((overlay, i) => ({ overlay, startSeconds: timeline.trackStarts[i]! })),
      timeline.totalSeconds,
      VIDEO_FRAME,
      workDir,
    );

    await mkdir(outPath(episode, ""), { recursive: true });
    const video = outPath(episode, "video.mp4");
    const partialVideo = outPath(episode, ".video.partial.mp4");
    await muxEpisode(videoList, audioList, partialVideo);
    await rename(partialVideo, video);

    const timestamps = outPath(episode, "timestamps.txt");
    await writeFile(timestamps, timestampsText(rows, timeline));

    return { video, timestamps };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
