# Draw Tracklist overlays as HTML in a headless browser; ffmpeg only composites

Display Names mix Latin and Japanese, and the house style is Inter with Noto Sans JP as the fallback for CJK glyphs. ffmpeg's `drawtext` has no per-glyph font fallback, so it cannot render these rows correctly. We render each Tracklist state (one per Now-Playing Marker position) as a transparent PNG from HTML/CSS via Playwright, where `font-family: Inter, "Noto Sans JP"` gives correct fallback for free, then let ffmpeg composite Background + overlays + audio and encode. The picture changes only once per Track, so per-frame renderers (e.g. Remotion) would be wasted work.

## Considered Options

- `@napi-rs/canvas` — lighter, supports fallback, but layout is hand-positioned canvas code instead of CSS.
- Python + Pango/Cairo — robust text shaping, but off the user's stack (TypeScript) and needs a newer Python plus system libraries.
- Remotion — renders every frame; slow for hour-long videos where the picture changes ~11 times.
