# AI proposes the Tracklist; a deterministic tool renders the video

MP3 tags and filenames are unreliable for Display Names (wrong artists, romanised or English titles, lyricists mixed into artist fields), so resolving them needs world knowledge. We split the pipeline at a human-editable Tracklist file in the Episode Folder: a Claude skill proposes Display Names and order into it, the user approves or edits it, and a pure, AI-free tool renders the video from it. Re-rendering never requires AI, and AI never touches rendering.

## Considered Options

- Fully automatic AI naming with no review — rejected: a wrong name is baked into a published video.
- Audio fingerprinting (AcoustID/MusicBrainz) only — rejected as the sole source: returns romanised/English names rather than original script; may still be used as a hint for the skill.
