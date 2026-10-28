// Adapter Cyberpunk TCG: dati dall'API JSON di NetDeck (api.netdeck.gg), la stessa usata dalla galleria ufficiale
// cyberpunktcg.com/cards. Le immagini hanno URL firmati che scadono dopo pochi minuti: vengono copiate nel repo
// (images/cyberpunk/<id stampa>.webp) e, se una firma sta per scadere, la pagina dell'API viene riletta.
import { fetchJson } from "./http.ts";

const API = "https://api.netdeck.gg/api/cards/cyberpunk";
const PAGE_SIZE = 60;
/** Margine prima della scadenza della firma oltre il quale si rilegge la pagina. */
const EXPIRY_MARGIN_MS = 60_000;

export interface NetdeckPrinting {
  id: string;
  collector_number: string;
  image_url: string;
  set: { code: string; name: string };
  rarity?: string;
  finish?: string | null;
  language?: string;
}

export interface NetdeckCard {
  slug: string;
  name: string;
  canonical_name?: string;
  display_name?: string;
  rarity?: string;
  color?: string;
  card_type?: string;
  classifications?: string[];
  cost?: number | null;
  power?: number | null;
  print_number?: string;
  printing_id?: string;
  printings: NetdeckPrinting[];
}

interface NetdeckPage {
  items: NetdeckCard[];
  total: number;
  limit: number;
  offset: number;
}

export interface CyberpunkPrinting {
  identifier: string;
  print: string;
  image: string;
  set: string;
  rarity?: string;
  foiling?: string;
}

export interface CyberpunkCatalogCard {
  game: "cyberpunk";
  cardIdentifier: string;
  name: string;
  types: string[];
  rarity?: string;
  setName?: string;
  number?: string;
  cost?: number;
  power?: number;
  defaultImage?: string;
  printings: CyberpunkPrinting[];
}

/** La chiave immagine è l'id (UUID) della stampa: stabile e sicuro negli URL. */
export function toCatalogCard(card: NetdeckCard): CyberpunkCatalogCard {
  const printings = card.printings.map((p) => {
    const printing: CyberpunkPrinting = { identifier: p.collector_number, print: p.id, image: p.id, set: p.set.name };
    if (p.rarity) printing.rarity = p.rarity;
    if (p.finish) printing.foiling = p.finish;
    return printing;
  });
  const main = card.printings.find((p) => p.id === card.printing_id) ?? card.printings[0];
  const result: CyberpunkCatalogCard = {
    game: "cyberpunk",
    cardIdentifier: card.slug,
    name: card.canonical_name ?? card.display_name ?? card.name,
    types: [card.card_type, card.color, ...(card.classifications ?? [])].filter((t): t is string => !!t),
    printings,
  };
  if (card.rarity) result.rarity = card.rarity;
  if (main) {
    result.setName = main.set.name;
    result.number = main.collector_number;
    result.defaultImage = main.id;
  }
  if (typeof card.cost === "number") result.cost = card.cost;
  if (typeof card.power === "number") result.power = card.power;
  return result;
}

/** Scadenza (ms) di un URL CloudFront firmato; senza parametro Expires lo si considera sempre valido. */
export function expiresAt(url: string): number {
  const expires = Number(new URL(url).searchParams.get("Expires"));
  return expires ? expires * 1000 : Number.POSITIVE_INFINITY;
}

type PageFetcher = (offset: number) => Promise<NetdeckPage>;

const fetchPage: PageFetcher = async (offset) => {
  const page = await fetchJson<NetdeckPage>(`${API}?limit=${PAGE_SIZE}&offset=${offset}`);
  if (!page) throw new Error(`NetDeck: pagina ${offset} non trovata`);
  return page;
};

/** URL firmati delle stampe, rinnovati rileggendo la pagina dell'API quando stanno per scadere. */
export class SignedImageUrls {
  private readonly urls = new Map<string, { url: string; offset: number }>();
  private readonly refreshing = new Map<number, Promise<void>>();
  // Campi espliciti: Node esegue questi file togliendo solo i tipi (niente parameter properties).
  private readonly fetcher: PageFetcher;
  private readonly now: () => number;

  constructor(fetcher: PageFetcher, now: () => number = Date.now) {
    this.fetcher = fetcher;
    this.now = now;
  }

  register(page: NetdeckPage): void {
    for (const card of page.items) {
      for (const p of card.printings) this.urls.set(p.id, { url: p.image_url, offset: page.offset });
    }
  }

  async urlFor(key: string): Promise<string> {
    let entry = this.urls.get(key);
    if (!entry) throw new Error(`Stampa sconosciuta: ${key}`);
    if (expiresAt(entry.url) - this.now() < EXPIRY_MARGIN_MS) {
      await this.refresh(entry.offset);
      entry = this.urls.get(key)!;
    }
    return entry.url;
  }

  private refresh(offset: number): Promise<void> {
    let pending = this.refreshing.get(offset);
    if (!pending) {
      pending = this.fetcher(offset)
        .then((page) => this.register(page))
        .finally(() => this.refreshing.delete(offset));
      this.refreshing.set(offset, pending);
    }
    return pending;
  }
}

export async function buildCyberpunk(fetcher: PageFetcher = fetchPage) {
  const signed = new SignedImageUrls(fetcher);
  const cards: NetdeckCard[] = [];
  let total = Infinity;
  for (let offset = 0; offset < total; offset += PAGE_SIZE) {
    const page = await fetcher(offset);
    total = page.total;
    signed.register(page);
    cards.push(...page.items);
    if (!page.items.length) break;
  }
  if (!cards.length) throw new Error("NetDeck: nessuna carta Cyberpunk");
  const catalog = cards.map(toCatalogCard);
  return {
    cards: catalog,
    imageKeys: [...new Set(catalog.flatMap((c) => c.printings.map((p) => p.image)))],
    urlFor: (key: string) => signed.urlFor(key),
    source: "NetDeck (galleria ufficiale Cyberpunk TCG)",
    version: new Date().toISOString().slice(0, 10),
  };
}
