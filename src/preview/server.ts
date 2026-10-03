import { createReadStream, watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { EPISODE_FILE, type Episode } from "../episode.js";
import { listEpisodeFolder } from "../episodeFolder.js";
import { UserError } from "../errors.js";
import { FONT_FILES, FONTS_DIR } from "../tracklist/template.js";
import { checkEpisodeFolder, type Problem } from "../validation.js";
import { previewPage } from "./page.js";

export interface PreviewServer {
  url: string;
  close(): Promise<void>;
}

/** One check of the Episode Folder, as the page shows it. */
interface PreviewState {
  version: number;
  episode: Episode | undefined;
  problems: Problem[];
  /** Present when the folder has exactly one Background. */
  background: { file: string; /** Changes whenever the file does, so the browser never shows a stale one. */ tag: string } | undefined;
}

/** Changes to these names in the Episode Folder can change what Preview shows. */
const isWatched = (name: string) => name === EPISODE_FILE || /\.(mp3|jpe?g|png|webp)$/i.test(name);
/** Editors often save in several steps (write a temp file, rename); wait for them to settle. */
const SETTLE_MS = 40;
const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".ttf": "font/ttf", ".otf": "font/otf" };
const FONT_PATHS = new Set(Object.values(FONT_FILES).map((file) => `/fonts/${file}`));

/**
 * Serves the Preview of an Episode Folder on a free local port. Every change to episode.yaml,
 * the Tracks or the Background re-runs the render's own checks (without requiring approval),
 * then tells open pages to reload. One headless Chromium stays open for the width check, so a
 * re-check takes a fraction of a second rather than a browser launch.
 */
export async function startPreviewServer(folder: string): Promise<PreviewServer> {
  await listEpisodeFolder(folder); // A folder that isn't there is fatal, unlike every problem inside it.

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      console.error(error);
      if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain" });
      response.end(String(error));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  // Only this machine's own pages may read the Episode: refusing other Host names stops a
  // website from reaching the server through DNS rebinding.
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  const browser = new KeptBrowser();
  let version = 0;
  let current = checkFolder(folder, browser, version);
  const listeners = new Set<ServerResponse>();

  let settle: NodeJS.Timeout | undefined;
  const recheck = () => {
    clearTimeout(settle);
    settle = setTimeout(() => {
      const checking = checkFolder(folder, browser, ++version);
      current = checking;
      void checking.then((state) => {
        if (state.version !== version) return; // A newer check is already on its way.
        for (const listener of listeners) listener.write(`data: ${state.version}\n\n`);
      });
    }, SETTLE_MS);
  };
  const watcher: FSWatcher = watch(folder, (_event, name) => {
    if (name === null || isWatched(name)) recheck();
  });
  watcher.on("error", (error) => console.error(`Stopped watching ${folder}: ${error.message}`));

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!allowedHosts.has(request.headers.host ?? "")) return send(response, 403, "text/plain", "Forbidden");
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    if (pathname === "/") {
      const state = await current;
      send(response, 200, "text/html; charset=utf-8", previewPage({
        folderName: path.basename(folder),
        episode: state.episode,
        problems: state.problems,
        backgroundUrl: state.background ? `/background?${state.background.tag}` : undefined,
        fontBaseUrl: "/fonts/",
        version: state.version,
      }));
    } else if (pathname === "/events") {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      listeners.add(response);
      request.on("close", () => listeners.delete(response));
      // Report the latest check straight away, in case the folder changed while the page loaded.
      response.write(`retry: 500\ndata: ${(await current).version}\n\n`);
    } else if (pathname === "/background") {
      const { background } = await current;
      if (background) await sendFile(response, background.file);
      else send(response, 404, "text/plain", "No Background");
    } else if (FONT_PATHS.has(pathname)) {
      // The bundled fonts don't change while Preview runs; caching them keeps each reload quick.
      await sendFile(response, path.join(FONTS_DIR, path.basename(pathname)), "max-age=3600");
    } else {
      send(response, 404, "text/plain", "Not found");
    }
  }

  return {
    url: `http://127.0.0.1:${port}/`,
    async close() {
      clearTimeout(settle);
      watcher.close();
      for (const listener of listeners) listener.end();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await browser.close();
    },
  };
}

/**
 * The headless Chromium the width check lays rows out in, launched on first use and kept open
 * between checks; launched again if it has died, so one crash doesn't break every later check.
 */
class KeptBrowser {
  private launching: Promise<Browser> | undefined;

  get(): Promise<Browser> {
    if (this.launching) return this.launching;
    // Signals are handled by the CLI, which closes the server and, through it, this browser.
    const launching = chromium.launch({ handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
    const forget = () => {
      if (this.launching === launching) this.launching = undefined;
    };
    launching.then((browser) => browser.on("disconnected", forget), forget);
    return (this.launching = launching);
  }

  async close(): Promise<void> {
    const launching = this.launching;
    this.launching = undefined;
    await (await launching?.catch(() => undefined))?.close();
  }
}

/** Runs the render's checks, except approval; anything unexpected becomes a Problem rather than a crash. */
async function checkFolder(folder: string, browser: KeptBrowser, version: number): Promise<PreviewState> {
  try {
    const [{ episode, problems }, { backgroundCandidates }] = await Promise.all([
      browser.get().then((b) => checkEpisodeFolder(folder, { requireApproval: false, browser: b })),
      listEpisodeFolder(folder),
    ]);
    const file = backgroundCandidates.length === 1 ? path.join(folder, backgroundCandidates[0]!) : undefined;
    return { version, episode, problems, background: file ? { file, tag: await fileTag(file) } : undefined };
  } catch (error) {
    const message = error instanceof UserError ? error.message : `Preview couldn't check the Episode Folder: ${(error as Error).message ?? String(error)}`;
    return { version, episode: undefined, problems: [{ severity: "error", message }], background: undefined };
  }
}

async function fileTag(file: string): Promise<string> {
  try {
    const { mtimeMs, size } = await stat(file);
    return `${Math.round(mtimeMs)}-${size}`;
  } catch {
    return "";
  }
}

function send(response: ServerResponse, status: number, type: string, body: string): void {
  response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  response.end(body);
}

async function sendFile(response: ServerResponse, file: string, cacheControl = "no-cache"): Promise<void> {
  const { size } = await stat(file);
  response.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream", "content-length": size, "cache-control": cacheControl });
  await new Promise<void>((resolve, reject) => {
    createReadStream(file).on("error", reject).on("end", resolve).pipe(response);
  });
}
