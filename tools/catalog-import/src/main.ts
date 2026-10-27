// Import del catalogo carte. Uso:
//   node src/main.ts --game fab [--limit 100] [--skip-images]
// Variabili d'ambiente: IMAGE_SOURCE (template con {key}), CONCURRENCY.
import { join } from "node:path";
import { parseArgs } from "node:util";
import { buildFab } from "./fab.ts";
import { fileWriter, httpDownloader, loadState, saveState, syncImages, webpTransform } from "./images.ts";
import { publish } from "./publish.ts";

const ROOT = join(import.meta.dirname, "../../..");
const GAMES = { fab: buildFab } as const;
const IMAGE_SOURCES: Record<string, string> = {
  fab: "https://content.fabrary.net/cards/{key}.webp",
};

const { values } = parseArgs({
  options: {
    game: { type: "string", default: "fab" },
    limit: { type: "string" },
    "skip-images": { type: "boolean", default: false },
  },
});

const game = values.game as keyof typeof GAMES;
if (!(game in GAMES)) {
  console.error(`Gioco non supportato: ${game}. Disponibili: ${Object.keys(GAMES).join(", ")}`);
  process.exit(1);
}

const catalog = GAMES[game]();
console.log(`[${game}] ${catalog.source}: ${catalog.cards.length} carte, ${catalog.imageKeys.length} chiavi immagine`);

const statePath = join(ROOT, `tools/catalog-import/state/${game}-images.json`);
const state = await loadState(statePath);
let failed = 0;

if (!values["skip-images"]) {
  const template = process.env.IMAGE_SOURCE ?? IMAGE_SOURCES[game];
  let lastLog = 0;
  const result = await syncImages(
    catalog.imageKeys,
    state,
    {
      download: httpDownloader((key) => template.replace("{key}", encodeURIComponent(key))),
      transform: webpTransform,
      write: fileWriter(join(ROOT, `images/${game}`)),
    },
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

const entry = await publish(ROOT, game, {
  version: catalog.version,
  source: catalog.source,
  cards: catalog.cards,
  aliases: state.aliases,
  imageCount: Object.keys(state.files).length,
  missingImageCount: state.missing.length,
});
console.log(`[${game}] pubblicato: ${entry.cardCount} carte, ${entry.printingCount} stampe, ${entry.changelog.addedCardCount} nuove carte`);

// Errori di rete: lo stato è salvato, il prossimo run riprende da dove si è fermato.
if (failed > 0) process.exitCode = 2;
