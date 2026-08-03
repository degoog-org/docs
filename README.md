# Official degoog docs

Official docs for the search aggregator [degoog](https://github.io/degoog-org/degoog)

Learn about how everything works here: https://degoog-org.github.io/docs/

## Run

```sh
npm run build
npm run serve
```

The server defaults to `http://127.0.0.1:4173`. Set `PORT=4174 npm run serve` to use another port.

## Editing pages

Add or edit HTML fragments under `src/pages/user/` or `src/pages/developer/`. Keep page chrome, search, sidebar, scripts, and theme controls out of those fragments; the build script adds the shared shell.

When adding a page, add one entry to `src/data/pages.mjs`. The generated cross-document search index uses the combined list, while each generated page renders only the sidebar section for its active docs mode.

Never edit generated root pages by hand. Update `src/pages/`, `src/data/pages.mjs`, or `assets/`, then run `npm run build`.

The build also removes known stale legacy root pages from the previous static docs layout so old generated HTML does not survive a root-served replacement.
