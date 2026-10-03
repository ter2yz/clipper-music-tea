import path from "node:path";
import type { Frame } from "../tracklist/template.js";
import { ffmpeg, writeConcatList } from "./ffmpeg.js";

/**
 * Low frame rate: the picture only changes at Track Starts, and this keeps a 4K
 * hour-long Episode cheap. The ▶ moves on the nearest frame (within 1/FPS s).
 */
export const FPS = 10;
/** Frames per pre-encoded chunk of still video; also the keyframe interval (10 s). */
const CHUNK_FRAMES = 100;

const BT709 = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];
const H264 = [
  "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-crf", "18",
  "-pix_fmt", "yuv420p", "-r", String(FPS),
  "-g", String(CHUNK_FRAMES), "-keyint_min", String(CHUNK_FRAMES), "-sc_threshold", "0",
  ...BT709,
];

export interface StillSegment {
  /** Transparent Tracklist overlay shown over the Background for the whole segment. */
  overlay: string;
  /** Segment start, in seconds from the start of the video. */
  startSeconds: number;
}

/**
 * Encodes a video of still segments that ends at `totalSeconds`. Rather than encoding every
 * frame of a long still, each segment is built from at most two short pre-encoded chunks
 * that are repeated with stream copy — encode time is independent of Episode length.
 */
export async function encodeStillSegments(
  background: string,
  segments: StillSegment[],
  totalSeconds: number,
  frame: Frame,
  workDir: string,
): Promise<string> {
  // The last frame ends on or before the end of the audio, so the video is as long as the audio.
  const boundaries = [...segments.map((s) => Math.round(s.startSeconds * FPS)), Math.floor(totalSeconds * FPS)];
  const chunks: string[] = [];

  for (const [i, segment] of segments.entries()) {
    const frames = boundaries[i + 1]! - boundaries[i]!;
    const fullChunks = Math.floor(frames / CHUNK_FRAMES);
    const remainder = frames % CHUNK_FRAMES;
    if (fullChunks > 0) {
      const chunk = path.join(workDir, `segment-${i + 1}-full.mp4`);
      await encodeStillChunk(background, segment.overlay, frame, CHUNK_FRAMES, chunk);
      for (let k = 0; k < fullChunks; k++) chunks.push(chunk);
    }
    if (remainder > 0) {
      const chunk = path.join(workDir, `segment-${i + 1}-rest.mp4`);
      await encodeStillChunk(background, segment.overlay, frame, remainder, chunk);
      chunks.push(chunk);
    }
  }

  const list = path.join(workDir, "video.txt");
  await writeConcatList(list, chunks);
  return list;
}

/**
 * Encodes `frames` frames of one still: the Background scaled to cover the frame and
 * centre-cropped, with the Tracklist overlay on top. The picture is composed once and then
 * repeated in memory, so each frame costs only the H.264 encode.
 */
async function encodeStillChunk(background: string, overlay: string, frame: Frame, frames: number, out: string): Promise<void> {
  const { width, height } = frame;
  await ffmpeg([
    "-i", background, "-i", overlay,
    "-filter_complex",
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},setsar=1[bg];` +
      `[bg][1:v]overlay=0:0,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,` +
      `loop=loop=-1:size=1:start=0,setpts=N/(${FPS}*TB)[v]`,
    "-map", "[v]", "-frames:v", String(frames), ...H264, "-an", out,
  ]);
}

/** Joins the encoded picture with the joined audio into the finished MP4. */
export async function muxEpisode(videoList: string, audioList: string, mp4Out: string): Promise<void> {
  await ffmpeg([
    "-f", "concat", "-safe", "0", "-i", videoList,
    "-f", "concat", "-safe", "0", "-i", audioList,
    "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "copy",
    "-c:a", "aac", "-b:a", "320k",
    "-movflags", "+faststart",
    "-f", "mp4", mp4Out,
  ]);
}
