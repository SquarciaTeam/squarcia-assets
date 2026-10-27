import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFab, imageKeysOf, toCatalogCard } from "../src/fab.ts";
import { addedCards } from "../src/publish.ts";

test("toCatalogCard tiene solo i campi usati e scarta quelli vuoti", () => {
  const card = toCatalogCard({
    cardIdentifier: "snatch-red",
    name: "Snatch",
    pitch: 1,
    types: ["Action"],
    talents: [],
    artists: ["X"],
    legalHeroes: ["Y"],
    printings: [{ identifier: "WTR167", print: "WTR167-Alpha", image: "WTR167", set: "Welcome to Rathe", artists: ["X"], tcgplayer: {} }],
  });
  assert.deepEqual(card, {
    cardIdentifier: "snatch-red",
    name: "Snatch",
    pitch: 1,
    types: ["Action"],
    printings: [{ identifier: "WTR167", print: "WTR167-Alpha", image: "WTR167", set: "Welcome to Rathe" }],
  });
});

test("imageKeysOf raccoglie immagini di stampe, predefinite e speciali senza duplicati", () => {
  const keys = imageKeysOf([
    { defaultImage: "A", specialImage: "S", printings: [{ image: "A" }, { image: "B" }, {}] },
    { defaultImage: "B", printings: [] },
  ]);
  assert.deepEqual(keys.sort(), ["A", "B", "S"]);
});

test("il catalogo FaB conserva gli identificativi usati dall'app e include le chiavi storiche", () => {
  const fab = buildFab();
  const ids = new Set(fab.cards.map((c) => c.cardIdentifier));
  assert.equal(ids.size, fab.cards.length, "cardIdentifier univoci");
  assert.ok(ids.has("snatch-red"));
  // Chiavi salvate in Firestore con la versione 3.9.13 dell'app.
  for (const legacyKey of ["U-WTR167", "MST095_V2", "HNT001-MV", "CRU099"]) {
    assert.ok(fab.imageKeys.includes(legacyKey), legacyKey);
  }
  const hero = fab.cards.find((c) => c.types.includes("Hero") && c.young);
  assert.ok(hero?.specialImage, "gli eroi hanno l'immagine speciale");
});

test("addedCards individua le carte nuove", () => {
  const prev = [{ cardIdentifier: "a", name: "A", printings: [] }];
  const next = [...prev, { cardIdentifier: "b", name: "B", printings: [] }];
  assert.deepEqual(addedCards(prev, next).map((c) => c.name), ["B"]);
});
