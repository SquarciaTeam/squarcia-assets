import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { publish } from "../src/publish.ts";

const cards = (n: number) => Array.from({ length: n }, (_, i) => ({ cardIdentifier: `c${i}`, name: `Carta ${i}`, printings: [{}] }));
const images = { imageUrl: "https://x/{key}.webp", thumbUrl: "https://x/{key}-s.webp" };
const base = { version: "1", source: "test", aliases: {}, images, imageCount: 0, missingImageCount: 0 };

test("pubblica catalogo e manifest con i template delle immagini", async () => {
  const root = await mkdtemp(join(tmpdir(), "publish-"));
  const entry = await publish(root, "demo", { ...base, cards: cards(10) });
  assert.equal(entry.imageUrl, images.imageUrl);
  const manifest = JSON.parse(await readFile(join(root, "catalog/manifest.json"), "utf8"));
  assert.equal(manifest.games.demo.cardCount, 10);
  assert.equal(manifest.games.demo.thumbUrl, images.thumbUrl);
});

test("non pubblica se la sorgente restituisce molte meno carte di prima", async () => {
  const root = await mkdtemp(join(tmpdir(), "publish-"));
  await publish(root, "demo", { ...base, cards: cards(100) });
  await assert.rejects(publish(root, "demo", { ...base, cards: cards(50) }), /sorgente sembra guasta/);
  await assert.rejects(publish(root, "demo", { ...base, cards: [] }), /sorgente sembra guasta/);
  const catalog = JSON.parse(await readFile(join(root, "catalog/demo/index.json"), "utf8"));
  assert.equal(catalog.cards.length, 100, "il catalogo pubblicato resta quello buono");
  // Piccole variazioni (carte rimosse dalla sorgente) sono accettate.
  await publish(root, "demo", { ...base, cards: cards(95) });
});
