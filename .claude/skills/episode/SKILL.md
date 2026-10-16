---
name: episode
description: Use when the user runs /episode <folder>, or asks to propose a Tracklist, name the Tracks, render an Episode, or draft its YouTube title and description for an Episode Folder in clipper-music-tea.
argument-hint: <episode-folder>
---

# /episode <folder>

The judgement half of the pipeline (ADR 0001): Claude proposes the Tracklist in `episode.yaml`; the user reviews it in Preview and approves it; the AI-free CLI renders it; Claude then writes the Description Draft. Use the vocabulary in `CONTEXT.md` (Episode Folder, Track, Display Name, Tracklist, Approved Tracklist, Background, Timestamps, Description Draft) when talking to the user.

Run every command from this repo's root, with the Episode Folder as an **absolute path**.

## 1. Decide the mode

Read `<folder>/episode.yaml`.

| What you find | Mode |
|---|---|
| No `episode.yaml` | PROPOSE (fresh) |
| `approved: true` | RENDER |
| `approved` is anything but `true` (`false`, missing, a typo) | PROPOSE (existing file — see 2c) |
| Not valid YAML | Stop. Show the parse error and ask the user to fix it or say "start over". |

## 2. PROPOSE

### 2a. Gather the facts

```
pnpm --silent inspect <folder>
```

Prints JSON: `hasEpisodeYaml`, `backgroundCandidates`, and per Track its `file`, `durationSeconds` and all embedded `tags` (keys lower-cased). A long text tag — `synopsis`, `description` or `comment` — often carries a streaming service's "Provided to YouTube by …" credit block (release title, performers, ℗ year, writers); `purl` is the page the file was downloaded from. `--silent` keeps pnpm's banner out of the JSON. If `backgroundCandidates` isn't exactly one image, or there are more than 20 Tracks, tell the user now — render will refuse.

### 2b. Decide each Display Name

A Display Name is the Track's canonical **title** and **artist**, as the work is credited on its original release, in its original script. Tags and filenames are evidence, not answers: they are routinely wrong (an unrelated uploader as artist, a whole "Artist - Title" string in the title tag), romanised or translated (`Kanashimi ga Tomaranai` for `悲しみがとまらない`), or padded with lyricists and composers in the artist field.

For each Track:

1. Collect every clue: filename, `title`/`artist`/`album`/`date` tags, the credit block, `purl`. A filename may hold the original-script title when the tags don't, or the reverse.
2. Identify the actual recording (artist + song + release). Clues that agree can still all be wrong, so check every Track with **WebSearch** unless you already know the release's own credit for certain — search the original-language title and artist, and prefer the artist's or label's own pages, the Japanese storefront listing (Apple Music JP, Spotify `intl-ja`, mora, レコチョク), Japanese Wikipedia, and Japanese shops (Tower, HMV, diskunion) over international ones. For the exact written form — spacing, `&` vs `＆`, casing — the Japanese storefront listing is the tie-breaker, since that is where the release's own metadata shows.
3. Write the names by these rules:
   - **artist**: the performing act only, as it is credited at home — kanji/kana for Japanese acts (`山下達郎`, not `Tatsuro Yamashita`), Latin or mixed script only where that *is* the official name (`Perfume`, `m-flo`, `ずっと真夜中でいいのに。`). A romanised name in the tags or filename (`Taeko Onuki`, `Junko Yagami`) is almost never how a Japanese act writes itself: look up the kana/kanji form even when the romanisation looks like a stage name. If an act officially uses both a Latin and a kana name, prefer the kana one and flag the Latin alternative. Drop lyricists, composers, arrangers, guest vocalists already named in the title, and duplicated credits. A duo/collaboration credited as one act keeps its official joining word (`と`, `&`, `×`) — check the release's own credit, not a streaming service's comma-joined artist list.
   - The examples here are Japanese; apply the same principle to any language (Korean acts in Hangul, Chinese in their own characters, etc.), using that country's storefronts and sources.
   - **title**: as on the original release, in its script and casing. Translated or romanised titles go back to the original (`Kanashimi ga Tomaranai` → `悲しみがとまらない`). Latin-script titles keep the original release's casing — Japanese releases often write them in capitals where international listings title-case them; when you can't establish which, keep the tag's casing and flag it.
   - A featured artist stays in the **title** only if the original release title includes it (`<title> feat. <guest in original script>`); otherwise leave them out.
   - Don't add version notes (`Remastered 2017`, `Album ver.`) unless they distinguish the recording the user needs.
4. If after checking you are still not sure of any part — which recording, script, spelling, spacing, casing, the joining word — keep your best guess and flag it (see format). A flag costs the user one glance in Preview; a silent wrong name gets baked into a published video.

### 2c. Order the Tracklist and write `episode.yaml`

**Fresh (no file):** order the Tracks for listening as one session — an inviting opener, a build to the most energetic stretch around the middle, then wind down to a gentle closer; avoid putting two very similar Tracks back to back. Then write `<folder>/episode.yaml` in exactly this shape:

```yaml
# Proposed by /episode. Review with `pnpm preview <folder>`, edit freely, then set approved: true.
approved: false
tracks:
  # Opener: bright mid-tempo groove that sets the mood
  - file: "Tatsuro Yamashita - SPARKLE.mp3"
    title: "SPARKLE"
    artist: "山下達郎"
  # Lifts the energy: ...
  - file: "Some Artist - Some Song.mp3"
    title: "..."
    artist: "..."
    # UNSURE: tags say "X"; could not confirm whether the official title is "Y" or "Z"
```

- One `#` reason line above every Track saying why it sits there (mood/energy/transition). Don't number them — they go stale when the user reorders.
- An `# UNSURE: …` line under every flagged Track, saying what is uncertain and what the alternatives are.
- `file` is the exact filename from `inspect`; every Track listed once. Double-quote every string.
- Don't add Episode Settings (`side`, `textColor`, `normalizeLoudness`) — the house style applies unless the user asks.

**Existing unapproved file:** it may hold the user's edits, so never rewrite it wholesale. Leave every existing entry — order, names, comments, settings — exactly as it is. Only fill gaps, with small in-place edits (the Edit tool, never re-serialising the YAML, which would drop the comments):
- `approved` missing → add `approved: false` at the top;
- `approved` set to something other than `true`/`false` (e.g. `"true"`, `yes`) → don't change it; tell the user it must be exactly `true` or `false`;
- an MP3 in the folder not listed → append an entry for it at the end (with its reason and any flag);
- an entry with a blank `title` or `artist` → fill just that field.
- an entry whose `file` no longer exists → don't delete it; tell the user (validation in 2d will report it — that error is theirs to resolve, not yours).

If the user explicitly asks to start over, ask once to confirm that their edits will be lost, then write a fresh file.

### 2d. Validate, then hand over

First re-read `episode.yaml` and confirm it still says `approved: false` (the user may have edited it meanwhile — if it now says `true`, stop and ask instead of running the next command, which would start a full render). Then:

```
pnpm render <folder>
```

On an unapproved Tracklist this runs every check and refuses before rendering anything. Expect exactly one `Error:`, saying `episode.yaml` is not approved, then `Render refused.` `Warning:` lines (e.g. a small Background) don't block anything; pass them on.

Any other `Error:` about an entry you wrote is yours to fix, then re-run the check until only the approval error is left:
- a file listed/unlisted/twice → fix the `file` entries;
- characters the fonts can't draw → substitute the closest drawable character (e.g. a different dash or tilde) and add `# UNSURE: original is "…"; changed "x" to "y" so the fonts can draw it`;
- a row too wide for the frame → shorten it as little as possible without inventing anything (drop a `feat. …` or a subtitle before touching the main title or artist) and add `# UNSURE: shortened to fit the frame; full name is "…"`.

Errors about entries the user wrote (existing file) are reported to the user, not fixed.

Then tell the user, briefly:
1. the proposed order (`title - artist` per line) and total running time;
2. which Tracks are flagged and why;
3. next steps: `pnpm preview <folder>` to check names and order (edit `episode.yaml`, the page reloads on save) → set `approved: true` → run `/episode <folder>` again to render.

Stop there. Never set `approved: true` yourself.

## 3. RENDER

1. Run `pnpm render <folder>`. It takes minutes for a full Episode; allow a long timeout (≈10 min) or run it in the background and wait.
2. If it fails, show the `Error:` lines as printed and stop. Don't edit an Approved Tracklist to make it pass — tell the user what to change; nothing gets drafted.
3. On success it prints `Video:` and `Timestamps:` paths (`<folder>/out/video.mp4`, `<folder>/out/timestamps.txt`).
4. Description Draft: check whether `<folder>/out/description.md` exists (`test -e`).
   - **Exists** → leave it untouched (the user may have edited it); say so.
   - **Doesn't exist** → read `out/timestamps.txt` and the Approved Tracklist, then write `out/description.md`:

```markdown
# Title options

1. …
2. …
3. …

# Description

<2–4 sentence intro: the mood/setting of the Episode, and a few of the artists>

```

   Write exactly that — nothing after the intro but one blank line — then append the Timestamps with the shell so they are byte-for-byte the file's:

```
cat <folder>/out/timestamps.txt >> <folder>/out/description.md
```

   - 3–5 title options, ≤ 100 characters each (YouTube's limit), naming the genre/mood; mixing English and Japanese is fine when the Tracks are Japanese.
   - Never retype, reformat, re-time or re-sort the Timestamps. Claims in the titles and intro come only from the Tracklist plus the mood of the music; don't add release facts (years, decades, chart history, albums).
5. Report the three output paths, and whether `description.md` was written now or kept.

## Common mistakes

| Mistake | Instead |
|---|---|
| Copying the `artist` tag (`山下 達郎, 山下達郎, 吉田美奈子`, or an uploader's name) | Identify the performer; drop writers and junk |
| Keeping a romanised act name (`Taeko Onuki`) because it looks official | Find the kana/kanji form; flag if the act also uses a Latin name |
| Keeping a romanised/English title because it's in the tag | Original-release title, original script |
| Guessing silently | Best guess plus `# UNSURE:` |
| Re-ordering or renaming an existing unapproved file | Fill gaps only; full rewrite only on confirmed "start over" |
| `pnpm inspect` without `--silent` | pnpm's banner breaks the JSON |
| Retyping Timestamps into the description | Append `out/timestamps.txt` with `cat >>` |
| Overwriting `out/description.md` on a re-render | Never; it's the user's once written |
