# clipper-music-tea

Turns a folder of songs and one background image into a YouTube music video that shows the song list with a marker on the song currently playing.

## Language

**Episode**:
One YouTube video and everything that goes into it.
_Avoid_: video project, mix

**Episode Folder**:
One folder holding everything for exactly one video: its Tracks and its Background.
_Avoid_: project, input dir, a-folder

**Track**:
One MP3 song in an Episode Folder.
_Avoid_: song file, clip

**Background**:
The single still image shown behind the Tracklist for the whole video.
_Avoid_: cover, wallpaper, frame

**Display Name**:
How a Track is written on screen — its canonical title and artist in their original script, e.g. `異端なスター - Official髭男dism`. Not the same as the MP3's embedded tags or filename, which are often wrong or romanised.
_Avoid_: tag, metadata, filename

**Tracklist**:
The ordered list of Display Names drawn over the Background; its order is the play order. It is proposed by Claude, then approved (and possibly edited) by the user before any render.
_Avoid_: playlist, setlist

**Approved Tracklist**:
A Tracklist the user has confirmed; the only thing a render reads Display Names and order from.
_Avoid_: final list, locked list

**Episode Settings**:
Optional per-Episode overrides of the house style — Tracklist side, text colour, loudness levelling on/off. Everything not overridden uses the house style.
_Avoid_: config, options, theme

**Now-Playing Marker**:
The ▶ beside the Tracklist row whose Track is currently playing. It moves to a Track at the start of that Track's Gap.
_Avoid_: arrow, cursor, highlight

**Gap**:
The one second of silence before every Track except the first; it belongs to the Track that follows it.
_Avoid_: pause, spacer, transition

**Track Start**:
The moment a Track's Gap begins (or 0:00 for the first Track) — where the Now-Playing Marker moves and where the Track's timestamp points.
_Avoid_: offset, cue point

**Preview**:
A live browser view of the Episode's frame — Background plus Tracklist, steppable through every Now-Playing Marker position — drawn from the same template the render uses. It is how the user reviews a Tracklist before approving it.
_Avoid_: mockup, draft render

**Timestamps**:
One `MM:SS Display Name` line per Track, at its Track Start, for pasting into the YouTube description; YouTube turns them into chapters.
_Avoid_: chapters list, cue sheet

**Description Draft**:
Claude's suggested YouTube title options and description (intro text plus Timestamps) for an Episode; the user copies it into YouTube by hand.
_Avoid_: metadata, copy
