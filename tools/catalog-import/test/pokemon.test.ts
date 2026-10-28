import assert from "node:assert/strict";
import { test } from "node:test";
import { imageKey, isDigital, toCatalogCard, type TcgdexDetail } from "../src/pokemon.ts";

const furret: TcgdexDetail = {
  id: "swsh3-136",
  localId: "136",
  name: "Furret",
  image: "https://assets.tcgdex.net/en/swsh/swsh3/136",
  category: "Pokemon",
  rarity: "Uncommon",
  types: ["Colorless"],
  set: { id: "swsh3", name: "Darkness Ablaze" },
  variants: { firstEdition: false, holo: false, normal: true, reverse: true, wPromo: false },
};

test("ogni variante diventa una stampa con l'etichetta in foiling", () => {
  const card = toCatalogCard(furret, "Furret");
  assert.deepEqual(card, {
    game: "pokemon",
    cardIdentifier: "swsh3-136",
    name: "Furret",
    types: ["Pokemon", "Colorless"],
    setName: "Darkness Ablaze",
    number: "136",
    rarity: "Uncommon",
    defaultImage: "en/swsh/swsh3/136",
    printings: [
      { identifier: "swsh3-136", print: "swsh3-136-normal", set: "Darkness Ablaze", image: "en/swsh/swsh3/136", rarity: "Uncommon" },
      {
        identifier: "swsh3-136",
        print: "swsh3-136-reverse",
        set: "Darkness Ablaze",
        image: "en/swsh/swsh3/136",
        foiling: "Reverse Holo",
        rarity: "Uncommon",
      },
    ],
  });
});

test("il nome italiano si aggiunge solo se diverso", () => {
  assert.equal(toCatalogCard({ ...furret, name: "Charizard" }, "Charizard").nameIt, undefined);
  assert.equal(toCatalogCard({ ...furret, name: "Professor's Research" }, "Ricerca Accademica").nameIt, "Ricerca Accademica");
});

test("senza varianti o senza immagine resta una stampa normale senza immagine", () => {
  const card = toCatalogCard({ ...furret, variants: undefined, image: undefined, rarity: undefined });
  assert.equal(card.defaultImage, undefined);
  assert.deepEqual(card.printings, [{ identifier: "swsh3-136", print: "swsh3-136-normal", set: "Darkness Ablaze" }]);
});

test("chiave immagine dal percorso TCGdex", () => {
  assert.equal(imageKey("https://assets.tcgdex.net/en/base/base1/4"), "en/base/base1/4");
  assert.equal(imageKey("https://altro.example/x"), undefined);
  assert.equal(imageKey(undefined), undefined);
});

test("le carte TCG Pocket (solo digitali) vengono riconosciute anche con set dai nomi simili", () => {
  const digital = new Set(["A1", "P-A"]);
  assert.equal(isDigital("A1-001", digital), true);
  assert.equal(isDigital("P-A-007", digital), true);
  assert.equal(isDigital("A1a-001", digital), false);
  assert.equal(isDigital("swsh3-136", digital), false);
});
