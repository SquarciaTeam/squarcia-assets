// Sincronizza le immagini delle carte: scarica solo le chiavi mancanti, elimina i duplicati (stesso contenuto,
// chiave diversa) registrandoli come alias, ridimensiona e salva in webp.
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface ImageState {
  /** chiave canonica → sha256 del file sorgente (serve a riconoscere i duplicati nei run successivi) */
  files: Record<string, string>;
  /** chiave → chiave canonica con lo stesso contenuto */
  aliases: Record<string, string>;
  /** chiavi che la sorgente non ha (404): vengono ritentate a ogni run */
  missing: string[];
}

export interface SyncDeps {
  /** Restituisce i byte dell'immagine o null se la sorgente non ce l'ha (404). */
  download(key: string): Promise<Uint8Array | null>;
  /** Converte l'immagine sorgente nel formato pubblicato. */
  transform(source: Uint8Array): Promise<Uint8Array>;
  /** Scrive il file pubblicato per la chiave. */
  write(key: string, data: Uint8Array): Promise<void>;
}

export interface SyncOptions {
  concurrency?: number;
  limit?: number;
  onProgress?(done: number, total: number): void;
  /** Chiamata ogni `checkpointEvery` immagini, per salvare lo stato e riprendere dopo un'interruzione. */
  onCheckpoint?(state: ImageState): Promise<void>;
  checkpointEvery?: number;
}

export interface SyncResult {
  written: string[];
  aliased: string[];
  missing: string[];
  failed: { key: string; error: string }[];
}

export function emptyState(): ImageState {
  return { files: {}, aliases: {}, missing: [] };
}

/** Chiavi da scaricare: né file né alias già presenti. */
export function pendingKeys(keys: readonly string[], state: ImageState): string[] {
  return keys.filter((k) => !(k in state.files) && !(k in state.aliases));
}

export function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function syncImages(keys: readonly string[], state: ImageState, deps: SyncDeps, options: SyncOptions = {}): Promise<SyncResult> {
  const todo = pendingKeys(keys, state).slice(0, options.limit ?? Infinity);
  const byHash = new Map(Object.entries(state.files).map(([key, hash]) => [hash, key]));
  const missing = new Set(state.missing);
  const result: SyncResult = { written: [], aliased: [], missing: [], failed: [] };
  let done = 0;
  let next = 0;

  async function worker() {
    while (next < todo.length) {
      const key = todo[next++];
      try {
        const source = await deps.download(key);
        if (!source) {
          missing.add(key);
          result.missing.push(key);
        } else {
          missing.delete(key);
          const hash = sha256(source);
          const canonical = byHash.get(hash);
          if (canonical) {
            state.aliases[key] = canonical;
            result.aliased.push(key);
          } else {
            // Registrato subito (prima di qualsiasi await) così un duplicato in parallelo diventa alias.
            byHash.set(hash, key);
            await deps.write(key, await deps.transform(source));
            state.files[key] = hash;
            result.written.push(key);
          }
        }
      } catch (error) {
        result.failed.push({ key, error: error instanceof Error ? error.message : String(error) });
      }
      done++;
      options.onProgress?.(done, todo.length);
      if (options.onCheckpoint && done % (options.checkpointEvery ?? 500) === 0) {
        state.missing = [...missing].sort();
        await options.onCheckpoint(state);
      }
    }
  }

  await Promise.all(Array.from({ length: options.concurrency ?? 6 }, worker));
  state.missing = [...missing].sort();
  return result;
}

// --- Implementazioni reali ---

const USER_AGENT = "squarcia-assets-import (+https://github.com/SquarciaTeam/squarcia-assets)";

/** `urlFor` può essere asincrono: es. URL firmati da rinnovare prima del download (Cyberpunk). */
export function httpDownloader(urlFor: (key: string) => string | Promise<string>, retries = 3) {
  return async (key: string): Promise<Uint8Array | null> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const res = await fetch(await urlFor(key), { headers: { "User-Agent": USER_AGENT } });
        if (res.status === 404 || res.status === 403) return null;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      } catch (error) {
        lastError = error;
        await new Promise((r) => setTimeout(r, 1000 * 3 ** attempt));
      }
    }
    throw lastError;
  };
}

/** 450 px di larghezza, webp q80: circa 50 KB a carta, sufficiente anche per stampare i proxy. */
export async function webpTransform(source: Uint8Array): Promise<Uint8Array> {
  const { default: sharp } = await import("sharp");
  return sharp(source).resize({ width: 450, withoutEnlargement: true }).webp({ quality: 80, effort: 5 }).toBuffer();
}

export function fileWriter(dir: string) {
  return async (key: string, data: Uint8Array) => {
    const path = join(dir, `${key}.webp`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  };
}

export async function loadState(path: string): Promise<ImageState> {
  try {
    return { ...emptyState(), ...JSON.parse(await readFile(path, "utf8")) };
  } catch {
    return emptyState();
  }
}

export async function saveState(path: string, state: ImageState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const sorted = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(path, JSON.stringify({ files: sorted(state.files), aliases: sorted(state.aliases), missing: state.missing }, null, 1) + "\n");
}

/** Larghezza delle miniature (liste e ricerca): circa 7 KB a carta. */
export const THUMB_WIDTH = 160;

export async function webpThumb(source: Uint8Array): Promise<Uint8Array> {
  const { default: sharp } = await import("sharp");
  return sharp(source).resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 70, effort: 5 }).toBuffer();
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false
  );
}

/**
 * Crea le miniature mancanti (<dir>/thumbs/<key>.webp) dalle immagini già pubblicate in <dir>/<key>.webp.
 * Incrementale: le miniature esistenti non vengono rigenerate. Restituisce le chiavi elaborate.
 */
export async function generateThumbs(
  dir: string,
  keys: readonly string[],
  options: { transform?: (source: Uint8Array) => Promise<Uint8Array>; concurrency?: number } = {}
): Promise<string[]> {
  const transform = options.transform ?? webpThumb;
  const created: string[] = [];
  const todo: string[] = [];
  for (const key of keys) {
    if (!(await exists(join(dir, "thumbs", `${key}.webp`))) && (await exists(join(dir, `${key}.webp`)))) todo.push(key);
  }
  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const key = todo[next++];
      const thumb = await transform(await readFile(join(dir, `${key}.webp`)));
      const path = join(dir, "thumbs", `${key}.webp`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, thumb);
      created.push(key);
    }
  }
  await Promise.all(Array.from({ length: options.concurrency ?? 6 }, worker));
  return created;
}
