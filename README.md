# clipper-music-tea

Turns a folder of MP3s plus one background image into a 4K YouTube music video: the song list is shown over the image, with a ▶ marking the song now playing.

> **Status:** the whole workflow below works: the `/episode` Claude skill (in [`.claude/skills/episode/`](./.claude/skills/episode/SKILL.md)), `pnpm preview`, and `pnpm render` with every validation rule and Episode Setting.
> Vocabulary: [`CONTEXT.md`](./CONTEXT.md). Decisions: [`docs/adr/`](./docs/adr/).

## Making an Episode — what to do next

### 1. Prepare the Episode Folder

One folder per video, containing:

- every Track as an `.mp3` (up to 20)
- exactly **one** Background image (ideally ≥ 3840 px wide, or the tool warns it will look soft)

```
my-episode/
├── Shigeru Suzuki - LADY PINK PANTHER.mp3
├── Suchmos - Pinkvibes.mp3
├── ...
└── background.jpeg
```

### 2. Ask Claude to propose the Tracklist

```
/episode path/to/my-episode
```

Claude reads tags, filenames and durations (via `pnpm --silent inspect <folder>`, which prints them as JSON), works out each name with its own knowledge and web search, then writes `episode.yaml` with:

- each Track's **Display Name** (separate `title` and `artist`, in original script — tags are often wrong)
- a suggested running order by mood and energy, with a one-line `# reason` comment above each Track
- an `# UNSURE: …` comment under any name it isn't sure about, naming the alternatives
- `approved: false`

It checks the file against the same validation the render uses, then tells you the order, the flagged names, and what to do next.

If `episode.yaml` already exists and isn't approved, running `/episode` again won't reorder or rename anything you've edited — it only fills gaps (e.g. adds a Track you've just dropped into the folder). Ask it to "start over" for a fresh proposal; it confirms before discarding your edits.

### 3. Preview and fix

```
pnpm preview path/to/my-episode
```

Opens the frame in your browser exactly as it will render (add `--no-open` to just print the URL; Ctrl+C stops it). Use **← / →** to move the ▶ through every Track. Edit `episode.yaml` (names, order, `side`, `textColor`, `normalizeLoudness`) — the page reloads on save and shows any warnings (row too wide, unsupported characters, small Background).

### 4. Approve

In `episode.yaml`, set:

```yaml
approved: true
```

### 5. Render and draft the description

```
/episode path/to/my-episode
```

Seeing the approval, Claude runs the render (a few minutes for an hour-long Episode) and, if `out/description.md` doesn't exist yet, writes the Description Draft: 3–5 title options and a short intro followed by the exact Timestamps. If the render refuses, Claude shows why and nothing is drafted. Output lands in `my-episode/out/`:

| File | Made by | Overwritten on re-render? |
|---|---|---|
| `video.mp4` | tool | yes |
| `timestamps.txt` | tool | yes |
| `description.md` | Claude — title options + description with Timestamps | **never** (delete it to get a fresh draft) |

Rendering without AI: `pnpm render path/to/my-episode` (requires `approved: true`).

### 6. Upload

Upload `video.mp4` to YouTube by hand; copy title/description from `description.md`.

## `episode.yaml` reference

```yaml
approved: false            # render refuses until true
side: right                # optional: right | left (left mirrors the list; rows stay left-aligned, ▶ on their left)
textColor: "#FFFFFF"       # optional: any CSS colour, for the text and the ▶
normalizeLoudness: true    # optional: level every Track to -14 LUFS
tracks:                    # order here = play order
  - file: "Shigeru Suzuki - LADY PINK PANTHER.mp3"
    title: "LADY PINK PANTHER"
    artist: "鈴木茂"
```

The render stops with an error if a listed file is missing, an MP3 in the folder isn't listed, there isn't exactly one image, there are more than 20 Tracks, a file is listed twice, a Display Name (with its ▶) runs outside the frame's safe area (5 % in from each side), or a Display Name has characters the fonts can't draw. Preview shows the same problems as warnings.

## What the video does

- 3840×2160, H.264 + AAC 320 kbps
- Tracks play in Tracklist order with a 1 s Gap before each (except the first); the ▶ moves when the Gap begins
- Text: Inter Regular, Noto Sans JP fallback for Japanese, `Title - Artist`; by default white and on the right, the list sitting slightly above vertical centre
- Every Track levelled to −14 LUFS integrated before joining, with true peaks held to −1 dBTP (a Track that would otherwise clip is limited by ffmpeg's two-pass `loudnorm`); `normalizeLoudness: false` leaves the audio untouched

## Development

Requires Node 22, pnpm, and `ffmpeg`/`ffprobe` on `PATH`.

```
pnpm install
pnpm exec playwright install chromium   # the browser that draws the Tracklist
pnpm test                               # drives the CLI on generated Episode Folders (≈ 1 min)
pnpm typecheck
```

Bundled fonts (SIL Open Font License, licences alongside): `assets/fonts/Inter-Regular.ttf` (Inter 4.1, rsms/inter) and `assets/fonts/NotoSansJP-Regular.otf` (notofonts/noto-cjk).
