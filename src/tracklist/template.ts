/**
 * The one Tracklist template (ADR 0002). Render screenshots it into a transparent PNG per
 * Now-Playing Marker position; Preview serves the very same page. Anything that changes
 * how the Tracklist looks belongs here, so the two can never drift apart.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Frame {
  width: number;
  height: number;
}

/** The video frame. The template lays out for any frame size; renders target 4K. */
export const VIDEO_FRAME: Frame = { width: 3840, height: 2160 };

export const FONTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../assets/fonts");
export const FONT_FILES = { inter: "Inter-Regular.ttf", notoSansJp: "NotoSansJP-Regular.otf" } as const;

/**
 * House style, as fractions of the frame so it looks the same at any resolution.
 * Calibrated against the reference Episode (jp-city-pop, 6144×3456) by rendering and
 * comparing row widths and spacing: rows sit 1/24 of the frame height apart (≈ 47 px on a
 * 1125 px frame), the font size is half that (72 px at 3456; row widths match to < 1 %),
 * and the text's left edge is at 63.6 % of the frame width. The list is centred vertically and
 * then lifted by 0.0427 of the frame height (92 px at 2160): rendering the reference's 11 Display
 * Names over its Background and scaling to 2000×1125 lines every row up with the reference's to
 * within 1 px.
 */
export const HOUSE_STYLE = {
  rowPitch: 1 / 24,
  fontSize: 1 / 48,
  /** Right side: the text's left edge, from the frame's left. Left side (mirrored): the list's right edge, from the frame's right. */
  listLeft: 0.636,
  /** How far the list's centre sits above the frame's centre, as a fraction of frame height. */
  listLift: 0.0427,
  textColor: "#FFFFFF",
  marker: "▶",
  /** Space between the ▶ and its row's text, as a fraction of frame height. */
  markerGap: 0.0165,
  /** The ▶ is drawn smaller than the text, like the reference. */
  markerScale: 0.62,
} as const;

export type Side = "right" | "left";

/** The Episode Settings that change how the Tracklist is drawn. */
export interface TracklistSettings {
  /** `right` is the house style; `left` mirrors the list about the frame's vertical centre line. */
  side: Side;
  /** Any CSS colour (already validated); colours the text and the ▶. */
  textColor: string;
}

export const HOUSE_TRACKLIST_SETTINGS: TracklistSettings = { side: "right", textColor: HOUSE_STYLE.textColor };

export interface HorizontalSpan {
  left: number;
  right: number;
}

/**
 * Tracklist text must stay inside the frame inset by 5 % of its width on the left and right
 * (the "graphics safe" margin of EBU R 95), so it survives TV overscan and never touches the
 * frame edge. The width check compares each row's measured extent, ▶ included, against this;
 * it holds the same for a list on either side.
 */
export function safeArea(frame: Frame): HorizontalSpan {
  const inset = 0.05 * frame.width;
  return { left: inset, right: frame.width - inset };
}

export interface TracklistPageOptions {
  /** Display Names in play order. */
  rows: string[];
  /** Index of the row with the Now-Playing Marker. */
  markedRow: number;
  settings: TracklistSettings;
  frame: Frame;
  /** Where the page loads the bundled fonts from (a file:// URL for render, an HTTP path for Preview). */
  fontBaseUrl: string;
}

/**
 * A complete HTML page drawing the Tracklist on a transparent background. The page exposes
 * `window.setMarkedRow(index)` so one loaded page can be stepped through every
 * Now-Playing Marker position without reloading fonts, and `markAllRows()` / `rowExtents()`
 * for the width check (see TracklistWindow in browser.ts).
 */
export function tracklistPage({ rows, markedRow, settings, frame, fontBaseUrl }: TracklistPageOptions): string {
  const px = (fraction: number) => `${(fraction * frame.height).toFixed(3)}px`;
  // On the right, the text's left edge sits at listLeft. On the left, the list is mirrored: its
  // widest row ends as far from the frame's left edge as listLeft is from the right edge. Rows
  // stay left-aligned and the ▶ stays to the left of its row on both sides.
  const horizontal = settings.side === "left" ? "right" : "left";
  const base = fontBaseUrl.endsWith("/") ? fontBaseUrl : `${fontBaseUrl}/`;
  const items = rows
    .map((row, i) => `<li${i === markedRow ? ' class="now-playing"' : ""}>${escapeHtml(row)}</li>`)
    .join("\n      ");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      @font-face {
        font-family: "Inter";
        src: url("${base}${FONT_FILES.inter}") format("truetype");
        font-weight: 400;
        font-style: normal;
      }
      @font-face {
        font-family: "Noto Sans JP";
        src: url("${base}${FONT_FILES.notoSansJp}") format("opentype");
        font-weight: 400;
        font-style: normal;
      }
      html, body {
        margin: 0;
        width: ${frame.width}px;
        height: ${frame.height}px;
        overflow: hidden;
        background: transparent;
      }
      .tracklist {
        position: absolute;
        top: ${px(-HOUSE_STYLE.listLift)};
        bottom: ${px(HOUSE_STYLE.listLift)};
        ${horizontal}: ${(HOUSE_STYLE.listLeft * 100).toFixed(3)}%;
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        justify-content: center;
        font-family: "Inter", "Noto Sans JP";
        font-weight: 400;
        font-size: ${px(HOUSE_STYLE.fontSize)};
        line-height: ${px(HOUSE_STYLE.rowPitch)};
        color: ${settings.textColor};
        white-space: nowrap;
      }
      .tracklist li {
        position: relative;
      }
      .tracklist li.now-playing::before {
        content: "${HOUSE_STYLE.marker}";
        position: absolute;
        right: 100%;
        margin-right: ${px(HOUSE_STYLE.markerGap)};
        font-size: ${HOUSE_STYLE.markerScale}em;
      }
    </style>
  </head>
  <body>
    <ol class="tracklist">
      ${items}
    </ol>
    <script>
      const rows = () => [...document.querySelectorAll(".tracklist li")];
      window.setMarkedRow = (index) => {
        rows().forEach((li, i) => li.classList.toggle("now-playing", i === index));
      };
      // For the width check: every row wears the ▶ at once (it is absolutely positioned, so
      // this moves nothing), then each row reports its extent from the ▶'s left edge to the
      // end of its text. A pseudo-element has no box to query, so the ▶'s left edge comes from
      // its computed width and gap.
      window.markAllRows = () => {
        rows().forEach((li) => li.classList.add("now-playing"));
      };
      // Each row is measured with the others hidden, i.e. laid out as if it were the widest.
      // On the right that changes nothing horizontally; on the left, where the widest row sets
      // where every row starts, it means only the rows that are themselves too wide are blamed.
      window.rowExtents = () =>
        rows().map((li) => {
          const others = rows().filter((other) => other !== li);
          others.forEach((other) => (other.style.display = "none"));
          const range = document.createRange();
          range.selectNodeContents(li);
          const text = range.getBoundingClientRect();
          const marker = getComputedStyle(li, "::before");
          others.forEach((other) => (other.style.display = ""));
          return { left: text.left - parseFloat(marker.width) - parseFloat(marker.marginRight), right: text.right };
        });
    </script>
  </body>
</html>
`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
