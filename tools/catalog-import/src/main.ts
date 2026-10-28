// Import del catalogo carte. Uso:
//   node src/main.ts --game fab|pokemon [--limit 100] [--skip-images]
// Variabili d'ambiente: IMAGE_SOURCE (template con {key}, solo giochi con immagini copiate), CONCURRENCY.
import { join } from "node:path";
import { parseArgs } from "node:util";
import { buildFab } from "./fab.ts";
import { fileWriter, httpDownloader, loadState, saveState, syncImages, webpTransform } from "./images.ts";
import { buildPokemon } from "./pokemon.ts";
import { publish, type CardLike, type ImageUrls } from "./publish.ts";

const ROOT = join(import.meta.dirname, "../../..");
const PAGES_BASE = "https://squarciateam.github.io/squarcia-assets";

interface GameBuild {
  cards: CardLike[];
  source: string;
  version: string;
  images: ImageUrls;
  /** Presente solo se le immagini vanno copiate nel repo (servite da GitHub Pages). */
  mirror?: { keys: string[]; urlFor(key: string): string };
}

/** Immagini copiate in images/<game>/ e servite da GitHub Pages. */
function mirrored(game: string): ImageUrls {
  const url = `${PAGES_BASE}/images/${game}/{key}.webp`;
  return { imageUrl: url, thumbUrl: url };
}

const GAMES: Record<string, () => Promise<GameBuild>> = {
  async fab() {
    const fab = buildFab();
    const template = process.env.IMAGE_SOURCE ?? "https://content.fabrary.net/cards/{key}.webp";
    return {
      ...fab,
      images: mirrored("fab"),
      mirror: { keys: fab.imageKeys, urlFor: (key) => template.replace("{key}", encodeURIComponent(key)) },
    };
  },
  async pokemon() {
    const pokemon = await buildPokemon({
      cachePath: join(ROOT, "tools/catalog-import/state/pokemon-details.json"),
      concurrency: Number(process.env.CONCURRENCY ?? 6),
    });
    // Immagini servite direttamente da TCGdex: low 245px per le liste, high 600px per il dettaglio.
    return {
      ...pokemon,
      images: { imageUrl: "https://assets.tcgdex.net/{key}/high.webp", thumbUrl: "https://assets.tcgdex.net/{key}/low.webp" },
    };
  },
};

const { values } = parseArgs({
  options: {
    game: { type: "string", default: "fab" },
    limit: { type: "string" },
    "skip-images": { type: "boolean", default: false },
  },
});

const game = values.game!;
if (!(game in GAMES)) {
  console.error(`Gioco non supportato: ${game}. Disponibili: ${Object.keys(GAMES).join(", ")}`);
  process.exit(1);
}

const catalog = await GAMES[game]();
console.log(`[${game}] ${catalog.source}: ${catalog.cards.length} carte`);

const statePath = join(ROOT, `tools/catalog-import/state/${game}-images.json`);
const state = await loadState(statePath);
let failed = 0;

if (catalog.mirror && !values["skip-images"]) {
  const { keys, urlFor } = catalog.mirror;
  let lastLog = 0;
  const result = await syncImages(
    keys,
    state,
    { download: httpDownloader(urlFor), transform: webpTransform, write: fileWriter(join(ROOT, `images/${game}`)) },
    {
      concurrency: Number(process.env.CONCURRENCY ?? 6),
      limit: values.limit ? Number(values.limit) : undefined,
      onProgress(done, total) {
        if (Date.now() - lastLog > 10_000 || done === total) {
          lastLog = Date.now();
          console.log(`[${game}] immagini ${done}/${total}`);
        }
      },
      onCheckpoint: (s) => saveState(statePath, s),
    }
  );
  failed = result.failed.length;
  console.log(
    `[${game}] immagini nuove ${result.written.length}, alias ${result.aliased.length}, assenti alla sorgente ${result.missing.length}, errori ${failed}`
  );
  for (const f of result.failed.slice(0, 20)) console.log(`  errore ${f.key}: ${f.error}`);
  await saveState(statePath, state);
}

const withImage = catalog.cards.filter((c) => c.defaultImage).length;
const entry = await publish(ROOT, game, {
  version: catalog.version,
  source: catalog.source,
  cards: catalog.cards,
  aliases: state.aliases,
  images: catalog.images,
  imageCount: catalog.mirror ? Object.keys(state.files).length : withImage,
  missingImageCount: catalog.mirror ? state.missing.length : catalog.cards.length - withImage,
});
console.log(`[${game}] pubblicato: ${entry.cardCount} carte, ${entry.printingCount} stampe, ${entry.changelog.addedCardCount} nuove carte`);

// Errori di rete: lo stato è salvato, il prossimo run riprende da dove si è fermato.
if (failed > 0) process.exitCode = 2;
