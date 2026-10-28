// Adapter Pokémon: dati da TCGdex (https://tcgdex.dev, MIT). Le immagini NON vengono copiate: restano su
// assets.tcgdex.net, che le serve apposta per le app (webp low/high, CORS aperto, cache immutabile).
// Il catalogo ha la stessa forma di quello FaB (cardIdentifier, printings...) così l'app lo usa senza adattamenti.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fetchJson, mapLimit } from "./http.ts";

const API = "https://api.tcgdex.net/v2";
const IMAGE_HOST = "https://assets.tcgdex.net/";
/** Serie solo digitali (TCG Pocket): non si vendono. */
const DIGITAL_SERIES = ["tcgp"];

export interface TcgdexBrief {
  id: string;
  localId: string;
  name: string;
  image?: string;
}

export interface TcgdexDetail {
  id: string;
  localId: string;
  name: string;
  image?: string;
  category?: string;
  rarity?: string;
  types?: string[];
  set: { id: string; name: string };
  variants?: Partial<Record<VariantKey, boolean>>;
}

type VariantKey = "normal" | "reverse" | "holo" | "firstEdition" | "wPromo";

/** Variante TCGdex → etichetta mostrata nell'app (campo `foiling` delle stampe, come per FaB). */
const VARIANT_LABELS: Record<VariantKey, string | undefined> = {
  normal: undefined,
  reverse: "Reverse Holo",
  holo: "Holo",
  firstEdition: "1st Edition",
  wPromo: "W Promo",
};

export interface PokemonPrinting {
  identifier: string;
  print: string;
  image?: string;
  set: string;
  foiling?: string;
  rarity?: string;
}

export interface PokemonCatalogCard {
  game: "pokemon";
  cardIdentifier: string;
  name: string;
  nameIt?: string;
  types: string[];
  rarity?: string;
  setName: string;
  number: string;
  defaultImage?: string;
  printings: PokemonPrinting[];
}

/** "https://assets.tcgdex.net/en/swsh/swsh3/136" → "en/swsh/swsh3/136" (chiave immagine). */
export function imageKey(url: string | undefined): string | undefined {
  return url?.startsWith(IMAGE_HOST) ? url.slice(IMAGE_HOST.length) : undefined;
}

export function toCatalogCard(detail: TcgdexDetail, nameIt?: string): PokemonCatalogCard {
  const image = imageKey(detail.image);
  const variants = (Object.keys(VARIANT_LABELS) as VariantKey[]).filter((v) => detail.variants?.[v]);
  const printings = (variants.length ? variants : (["normal"] as VariantKey[])).map((variant) => {
    const printing: PokemonPrinting = { identifier: detail.id, print: `${detail.id}-${variant}`, set: detail.set.name };
    if (image) printing.image = image;
    if (VARIANT_LABELS[variant]) printing.foiling = VARIANT_LABELS[variant];
    if (detail.rarity) printing.rarity = detail.rarity;
    return printing;
  });
  const card: PokemonCatalogCard = {
    game: "pokemon",
    cardIdentifier: detail.id,
    name: detail.name,
    types: [detail.category, ...(detail.types ?? [])].filter((t): t is string => !!t),
    setName: detail.set.name,
    number: detail.localId,
    printings,
  };
  if (nameIt && nameIt !== detail.name) card.nameIt = nameIt;
  if (detail.rarity) card.rarity = detail.rarity;
  if (image) card.defaultImage = image;
  return card;
}

/** Le carte delle serie digitali vanno escluse; l'id TCGdex è "<set>-<numero>". */
export function isDigital(cardId: string, digitalSetIds: ReadonlySet<string>): boolean {
  for (const setId of digitalSetIds) if (cardId.startsWith(`${setId}-`)) return true;
  return false;
}

type DetailCache = Record<string, TcgdexDetail>;

async function loadCache(path: string): Promise<DetailCache> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return {};
  }
}

async function saveCache(path: string, cache: DetailCache): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(path, JSON.stringify(sorted) + "\n");
}

/** Solo i campi che servono, per tenere piccola la cache nel repo. */
function slimDetail(d: TcgdexDetail): TcgdexDetail {
  return {
    id: d.id,
    localId: d.localId,
    name: d.name,
    image: d.image,
    category: d.category,
    rarity: d.rarity,
    types: d.types,
    set: { id: d.set.id, name: d.set.name },
    variants: d.variants,
  };
}

export async function buildPokemon(options: { cachePath: string; concurrency?: number; log?: (msg: string) => void }) {
  const log = options.log ?? console.log;
  const [briefs, briefsIt, ...digitalSeries] = await Promise.all([
    fetchJson<TcgdexBrief[]>(`${API}/en/cards`),
    fetchJson<TcgdexBrief[]>(`${API}/it/cards`),
    ...DIGITAL_SERIES.map((s) => fetchJson<{ sets: { id: string }[] }>(`${API}/en/series/${s}`)),
  ]);
  if (!briefs?.length) throw new Error("TCGdex: elenco carte vuoto");
  const digitalSetIds = new Set(digitalSeries.flatMap((s) => s?.sets.map((x) => x.id) ?? []));
  const namesIt = new Map((briefsIt ?? []).map((c) => [c.id, c.name]));
  const physical = briefs.filter((c) => !isDigital(c.id, digitalSetIds));

  // Dettagli: solo per le carte non ancora in cache (il primo run scarica tutto, poi solo le novità).
  const cache = await loadCache(options.cachePath);
  const missing = physical.filter((c) => !cache[c.id]);
  log(`[pokemon] ${physical.length} carte fisiche (${briefs.length - physical.length} digitali escluse), dettagli da scaricare: ${missing.length}`);
  let done = 0;
  let lastLog = Date.now();
  await mapLimit(missing, options.concurrency ?? 6, async (brief) => {
    const detail = await fetchJson<TcgdexDetail>(`${API}/en/cards/${encodeURIComponent(brief.id)}`).catch(() => null);
    if (detail) cache[brief.id] = slimDetail(detail);
    done++;
    if (Date.now() - lastLog > 10_000) {
      lastLog = Date.now();
      log(`[pokemon] dettagli ${done}/${missing.length}`);
      if (done % 2000 < 50) await saveCache(options.cachePath, cache);
    }
  });
  await saveCache(options.cachePath, cache);

  const cards = physical.filter((c) => cache[c.id]).map((c) => toCatalogCard(cache[c.id], namesIt.get(c.id)));
  const withoutDetail = physical.length - cards.length;
  if (withoutDetail) log(`[pokemon] ${withoutDetail} carte senza dettaglio (riprovate al prossimo run)`);
  return { cards, source: "TCGdex (api.tcgdex.net)", version: new Date().toISOString().slice(0, 10) };
}
