# Level loudness with a measured gain; use loudnorm only where peaks need limiting

Every Track is levelled to −14 LUFS integrated with true peaks held to −1 dBTP. We measure each decoded Track with ffmpeg's `ebur128` meter, and when one constant gain reaches −14 LUFS without pushing the true peak past −1 dBTP — almost every real Track — we apply exactly that gain with `volume`. Only a Track whose peaks would pass the limit goes through ffmpeg's `loudnorm` two-pass (first pass for its measurements and `target_offset`, second pass with them), whose dynamic mode limits the peaks; its 192 kHz output is resampled back to 48 kHz and pinned to the Track's original sample count. A constant gain is what `loudnorm`'s linear mode does anyway, but `loudnorm` refuses linear mode whenever the measured loudness range is exactly 0 or above its LRA target, upsamples everything to 192 kHz, and its measuring pass is several times slower than `ebur128`.

## Considered Options

- `loudnorm` two-pass with `linear=true` for every Track — the textbook recipe, but it falls back to dynamic (gain-riding) processing on Tracks it could have levelled linearly, and costs a 192 kHz round trip per Track.
- Gain plus a separate true-peak limiter — ffmpeg's `alimiter` limits sample peaks, not true peaks, so it can't hold −1 dBTP on its own.

## Consequences

- Peaky Tracks under 3 s can't reach −14 LUFS: `loudnorm` treats them as one block and only raises them as far as their peaks allow. Songs are never that short.
- The −1 dBTP limit applies to the levelled PCM; AAC encoding can overshoot it by a few tenths of a dB (still well clear of clipping).
