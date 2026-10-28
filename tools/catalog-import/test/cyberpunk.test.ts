import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCyberpunk, expiresAt, SignedImageUrls, toCatalogCard, type NetdeckCard } from "../src/cyberpunk.ts";

const signedUrl = (id: string, expires: number) =>
  `https://dstcynss47vun.cloudfront.net/prod/cyberpunk/portal/${id}/render.webp?Expires=${expires}&Key-Pair-Id=K&Signature=S`;

const v: NetdeckCard = {
  slug: "v-streetkid",
  name: "V",
  canonical_name: "V — Streetkid",
  rarity: "Rare",
  color: "Red",
  card_type: "Legend",
  classifications: ["Merc"],
  cost: 5,
  power: 6,
  print_number: "005a",
  printing_id: "p-main",
  printings: [
    { id: "p-beta", collector_number: "β005a", image_url: signedUrl("p-beta", 100), set: { code: "beta", name: "Welcome to Night City — Beta" }, rarity: "Rare", finish: null },
    { id: "p-main", collector_number: "005a", image_url: signedUrl("p-main", 100), set: { code: "retail", name: "Welcome to Night City — Retail" }, rarity: "Rare", finish: "Foil" },
  ],
};

test("mapping nella forma comune del catalogo", () => {
  assert.deepEqual(toCatalogCard(v), {
    game: "cyberpunk",
    cardIdentifier: "v-streetkid",
    name: "V — Streetkid",
    types: ["Legend", "Red", "Merc"],
    rarity: "Rare",
    setName: "Welcome to Night City — Retail",
    number: "005a",
    defaultImage: "p-main",
    cost: 5,
    power: 6,
    printings: [
      { identifier: "β005a", print: "p-beta", image: "p-beta", set: "Welcome to Night City — Beta", rarity: "Rare" },
      { identifier: "005a", print: "p-main", image: "p-main", set: "Welcome to Night City — Retail", rarity: "Rare", foiling: "Foil" },
    ],
  });
});

test("scadenza degli URL firmati", () => {
  assert.equal(expiresAt(signedUrl("x", 1700000000)), 1700000000_000);
  assert.equal(expiresAt("https://x.example/a.webp"), Number.POSITIVE_INFINITY);
});

test("un URL in scadenza viene rinnovato rileggendo la sua pagina, una sola volta", async () => {
  let fetches = 0;
  const now = 1_000_000_000_000;
  const fresh = Math.round(now / 1000) + 600;
  const urls = new SignedImageUrls(async (offset) => {
    fetches++;
    return { offset, limit: 60, total: 1, items: [{ ...v, printings: v.printings.map((p) => ({ ...p, image_url: signedUrl(p.id, fresh) })) }] };
  }, () => now);
  urls.register({ offset: 0, limit: 60, total: 1, items: [v] }); // firme scadute (Expires=100)

  const [a, b] = await Promise.all([urls.urlFor("p-main"), urls.urlFor("p-beta")]);
  assert.match(a, new RegExp(`Expires=${fresh}`));
  assert.match(b, new RegExp(`Expires=${fresh}`));
  assert.equal(fetches, 1, "una sola rilettura per pagina");
  await assert.rejects(urls.urlFor("sconosciuta"), /Stampa sconosciuta/);
});

test("legge tutte le pagine e raccoglie le chiavi immagine", async () => {
  const pages = [
    // total: 61 → con pagine da 60 servono due letture (come con l'API reale).
    { offset: 0, limit: 60, total: 61, items: [v] },
    { offset: 60, limit: 60, total: 61, items: [{ ...v, slug: "johnny", printing_id: "p-j", printings: [{ ...v.printings[0], id: "p-j" }] }] },
  ];
  const offsets: number[] = [];
  const result = await buildCyberpunk(async (offset) => {
    offsets.push(offset);
    return pages[offset / 60];
  });
  assert.deepEqual(offsets, [0, 60]);
  assert.deepEqual(result.cards.map((c) => c.cardIdentifier), ["v-streetkid", "johnny"]);
  assert.deepEqual(result.imageKeys.sort(), ["p-beta", "p-j", "p-main"]);
});

test("nessuna carta dalla sorgente è un errore", async () => {
  await assert.rejects(buildCyberpunk(async () => ({ offset: 0, limit: 60, total: 0, items: [] })), /nessuna carta/);
});
