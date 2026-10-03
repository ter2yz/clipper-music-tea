import path from "node:path";
import { ffmpeg, writeConcatList } from "./ffmpeg.js";

export const SAMPLE_RATE = 48_000;
const PCM = ["-ar", String(SAMPLE_RATE), "-ac", "2", "-c:a", "pcm_s16le"];

/**
 * Decodes one Track to PCM. Every later step (durations, the Timeline, joining) works on
 * these exact samples, so what we measure is exactly what plays.
 * Loudness levelling (normalizeLoudness) belongs here.
 */
export async function decodeTrack(mp3: string, wavOut: string): Promise<void> {
  await ffmpeg(["-i", mp3, "-vn", "-map_metadata", "-1", ...PCM, wavOut]);
}

/**
 * Lays the decoded Tracks end to end with a Gap of silence before every Track but the
 * first. Returns a concat list for ffmpeg, so the joined audio is never written out in full.
 */
export async function joinWithGaps(trackWavs: string[], gapSeconds: number, workDir: string): Promise<string> {
  const gapWav = path.join(workDir, "gap.wav");
  await ffmpeg(["-f", "lavfi", "-i", `anullsrc=r=${SAMPLE_RATE}:cl=stereo`, "-t", String(gapSeconds), ...PCM, gapWav]);
  const list = path.join(workDir, "audio.txt");
  await writeConcatList(list, trackWavs.flatMap((wav, i) => (i === 0 ? [wav] : [gapWav, wav])));
  return list;
}
