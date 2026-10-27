// Adapter Flesh and Blood: legge il pacchetto @flesh-and-blood/cards (dati di the-fab-cube) e lo riduce ai campi
// usati da Squarcia Manager, mantenendo gli stessi nomi del pacchetto (cardIdentifier, print, image...) così i dati
// già salvati in Firestore restano validi.
import { readFileSync } from "node:fs";
import { cards } from "@flesh-and-blood/cards";
// Versione usata dall'app fino alla migrazione: serve solo per conoscere le chiavi immagine già salvate in Firestore.
import { cards as legacyCards } from "@flesh-and-blood/cards-legacy";

export interface FabPrinting {
  identifier: string;
  print: string;
  image?: string;
  set: string;
  edition?: string;
  foiling?: string;
  treatment?: string;
  treatments?: string[];
  rarity?: string;
}

export interface FabCatalogCard {
  cardIdentifier: string;
  name: string;
  pitch?: number;
  cost?: number;
  power?: number;
  defense?: number;
  life?: number;
  intellect?: number;
  types: string[];
  subtypes?: string[];
  classes?: string[];
  talents?: string[];
  rarity?: string;
  rarities?: string[];
  typeText?: string;
  functionalText?: string;
  defaultImage?: string;
  specialImage?: string;
  hero?: string;
  young?: boolean;
  bannedFormats?: string[];
  printings: FabPrinting[];
}

type AnyCard = Record<string, unknown> & { printings: Record<string, unknown>[] };

const CARD_FIELDS = [
  "cardIdentifier", "name", "pitch", "cost", "power", "defense", "life", "intellect", "types", "subtypes", "classes",
  "talents", "rarity", "rarities", "typeText", "functionalText", "defaultImage", "specialImage", "hero", "young",
  "bannedFormats",
] as const;

const PRINTING_FIELDS = ["identifier", "print", "image", "set", "edition", "foiling", "treatment", "treatments", "rarity"] as const;

function pick<T>(source: Record<string, unknown>, fields: readonly string[]): T {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = source[field];
    if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) continue;
    out[field] = value;
  }
  return out as T;
}

export function toCatalogCard(card: AnyCard): FabCatalogCard {
  return {
    ...pick<Omit<FabCatalogCard, "printings">>(card, CARD_FIELDS),
    // Sempre presente (anche vuoto): l'app usa `card.types.includes(...)`.
    types: Array.isArray(card["types"]) ? (card["types"] as string[]) : [],
    printings: card.printings.map((p) => pick<FabPrinting>(p, PRINTING_FIELDS)),
  } as FabCatalogCard;
}

/** Chiavi immagine referenziate da un elenco di carte (stampe, immagine predefinita e speciale). */
export function imageKeysOf(list: readonly AnyCard[]): string[] {
  const keys = new Set<string>();
  for (const card of list) {
    for (const key of [card["defaultImage"], card["specialImage"], ...card.printings.map((p) => p["image"])]) {
      if (typeof key === "string" && key) keys.add(key);
    }
  }
  return [...keys];
}

export function fabPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("../node_modules/@flesh-and-blood/cards/package.json", import.meta.url), "utf8"));
  return pkg.version;
}

export function buildFab() {
  const catalogCards = (cards as unknown as AnyCard[]).map(toCatalogCard);
  // Prima le chiavi attuali (diventano i file "canonici"), poi quelle storiche (diventano alias se identiche).
  const currentKeys = imageKeysOf(cards as unknown as AnyCard[]);
  const legacyKeys = imageKeysOf(legacyCards as unknown as AnyCard[]);
  const imageKeys = [...new Set([...currentKeys, ...legacyKeys])];
  return {
    cards: catalogCards,
    imageKeys,
    source: `@flesh-and-blood/cards@${fabPackageVersion()}`,
    version: fabPackageVersion(),
  };
}
