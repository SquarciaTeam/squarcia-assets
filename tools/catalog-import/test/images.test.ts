import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyState, pendingKeys, syncImages, type SyncDeps } from "../src/images.ts";

const bytes = (s: string) => new TextEncoder().encode(s);

function fakeDeps(source: Record<string, string | null>, failing: string[] = []) {
  const written: Record<string, string> = {};
  const downloads: string[] = [];
  const deps: SyncDeps = {
    async download(key) {
      downloads.push(key);
      if (failing.includes(key)) throw new Error("rete");
      const content = source[key];
      return content == null ? null : bytes(content);
    },
    async transform(data) {
      return data;
    },
    async write(key, data) {
      written[key] = new TextDecoder().decode(data);
    },
  };
  return { deps, written, downloads };
}

test("i file con lo stesso contenuto diventano alias della prima chiave", async () => {
  const { deps, written } = fakeDeps({ "MST095-MV": "img-a", MST095_V2: "img-a", SEN031: "img-b" });
  const state = emptyState();
  const result = await syncImages(["MST095-MV", "SEN031", "MST095_V2"], state, deps, { concurrency: 1 });

  assert.deepEqual(Object.keys(written).sort(), ["MST095-MV", "SEN031"]);
  assert.deepEqual(state.aliases, { MST095_V2: "MST095-MV" });
  assert.deepEqual(result.aliased, ["MST095_V2"]);
});

test("i duplicati scaricati in parallelo non vengono scritti due volte", async () => {
  const { deps, written } = fakeDeps({ A: "same", B: "same", C: "same", D: "other" });
  const state = emptyState();
  await syncImages(["A", "B", "C", "D"], state, deps, { concurrency: 4 });

  assert.equal(Object.keys(written).length, 2);
  assert.equal(Object.keys(state.aliases).length, 2);
});

test("un nuovo run scarica solo le chiavi mancanti e riconosce i duplicati di file già pubblicati", async () => {
  const state = emptyState();
  await syncImages(["A"], state, fakeDeps({ A: "x" }).deps);

  const second = fakeDeps({ A: "x", B: "x", C: "y" });
  await syncImages(["A", "B", "C"], state, second.deps);

  assert.deepEqual(second.downloads.sort(), ["B", "C"]);
  assert.deepEqual(state.aliases, { B: "A" });
  assert.deepEqual(pendingKeys(["A", "B", "C"], state), []);
});

test("le chiavi assenti alla sorgente sono registrate e ritentate al run successivo", async () => {
  const state = emptyState();
  await syncImages(["A", "Z"], state, fakeDeps({ A: "x", Z: null }).deps);
  assert.deepEqual(state.missing, ["Z"]);

  const retry = fakeDeps({ Z: "z" });
  await syncImages(["A", "Z"], state, retry.deps);
  assert.deepEqual(retry.downloads, ["Z"]);
  assert.deepEqual(state.missing, []);
  assert.ok("Z" in state.files);
});

test("gli errori di rete non bloccano le altre immagini e restano da riscaricare", async () => {
  const state = emptyState();
  const { deps } = fakeDeps({ A: "x", B: "y" }, ["B"]);
  const result = await syncImages(["A", "B"], state, deps);

  assert.deepEqual(result.failed.map((f) => f.key), ["B"]);
  assert.deepEqual(pendingKeys(["A", "B"], state), ["B"]);
});

test("limit riduce il numero di download", async () => {
  const { deps, downloads } = fakeDeps({ A: "1", B: "2", C: "3" });
  await syncImages(["A", "B", "C"], emptyState(), deps, { limit: 2, concurrency: 1 });
  assert.deepEqual(downloads, ["A", "B"]);
});
