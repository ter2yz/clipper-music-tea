import { ffmpeg } from "./ffmpeg.js";

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

export async function makeSilence(seconds: number, wavOut: string): Promise<void> {
  await ffmpeg(["-f", "lavfi", "-i", `anullsrc=r=${SAMPLE_RATE}:cl=stereo`, "-t", String(seconds), ...PCM, wavOut]);
}
