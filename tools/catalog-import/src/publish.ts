// Pubblica catalogo, alias delle immagini e manifest nella cartella del sito (GitHub Pages).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface ManifestEntry {
  version: string;
  source: string;
  publishedAt: string;
  cardCount: number;
  printingCount: number;
  imageCount: number;
  missingImageCount: number;
  catalog: string;
  aliases: string;
  images: string;
  changelog: { addedCardCount: number; addedCards: string[] };
}

export interface Manifest {
  schemaVersion: 1;
  games: Record<string, ManifestEntry>;
}

interface CardLike {
  cardIdentifier: string;
  name: string;
  printings: unknown[];
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(path: string, data: unknown, pretty = false): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, pretty ? 2 : undefined) + "\n");
}

/** Carte presenti nel nuovo catalogo e assenti nel precedente. */
export function addedCards(previous: readonly CardLike[], next: readonly CardLike[]): CardLike[] {
  const known = new Set(previous.map((c) => c.cardIdentifier));
  return next.filter((c) => !known.has(c.cardIdentifier));
}

export async function publish(
  root: string,
  game: string,
  data: { version: string; source: string; cards: CardLike[]; aliases: Record<string, string>; imageCount: number; missingImageCount: number }
): Promise<ManifestEntry> {
  const catalogPath = `catalog/${game}/index.json`;
  const aliasesPath = `catalog/${game}/image-aliases.json`;
  const previous = await readJson<{ cards: CardLike[] }>(join(root, catalogPath), { cards: [] });
  const added = previous.cards.length ? addedCards(previous.cards, data.cards) : [];
  const publishedAt = new Date().toISOString();

  await writeJson(join(root, catalogPath), { game, version: data.version, source: data.source, publishedAt, cards: data.cards });
  await writeJson(join(root, aliasesPath), data.aliases);

  const entry: ManifestEntry = {
    version: data.version,
    source: data.source,
    publishedAt,
    cardCount: data.cards.length,
    printingCount: data.cards.reduce((n, c) => n + c.printings.length, 0),
    imageCount: data.imageCount,
    missingImageCount: data.missingImageCount,
    catalog: catalogPath,
    aliases: aliasesPath,
    images: `images/${game}/`,
    changelog: { addedCardCount: added.length, addedCards: added.slice(0, 50).map((c) => c.name) },
  };
  const manifestPath = join(root, "catalog/manifest.json");
  const manifest = await readJson<Manifest>(manifestPath, { schemaVersion: 1, games: {} });
  manifest.games[game] = entry;
  await writeJson(manifestPath, manifest, true);
  return entry;
}
