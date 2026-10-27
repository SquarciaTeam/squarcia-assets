# squarcia-assets

Immagini delle carte e catalogo JSON usati da [Squarcia Manager](https://github.com/SquarciaTeam/Squarcia-Manager),
serviti gratuitamente tramite GitHub Pages: `https://squarciateam.github.io/squarcia-assets/`.

## Struttura

```
catalog/manifest.json          versioni pubblicate per ogni gioco
catalog/<game>/index.json      catalogo del gioco (schema comune)
images/<game>/<imageKey>.webp  immagini delle carte
```

Giochi: `fab` (Flesh and Blood), `pokemon`, `cyberpunk`.

## Aggiornamento

Il catalogo si aggiorna con la GitHub Action `catalog-import`, lanciata dal pannello admin di Squarcia Manager
o a mano da *Actions → catalog-import → Run workflow*. Non modificare a mano i file generati.

## Note

- `.nojekyll` disattiva Jekyll: i file vengono pubblicati così come sono (anche quelli con `_` nel nome).
- Le immagini delle carte sono proprietà dei rispettivi editori e sono ospitate solo per l'uso interno del gruppo.
