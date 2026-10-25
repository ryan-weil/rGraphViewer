# rGraphViewer

A focused DOT graph viewer with a modern light/dark interface, searchable nodes,
connection details, and clean orthogonal routing. Graph files are parsed and
laid out in your browser; opening a local file does not upload it.

## Run locally

Requires Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5174/**. The server binds to loopback only.
Set `PORT` to choose a different port.

## Features

- Open or drop DOT, GV, and supported MSAGL/JSON Graph Format JSON files.
- Paste DOT, load a direct file URL, or edit the current source.
- Search labels, node IDs, and addresses; follow incoming/outgoing connections.
- Pan, zoom around the pointer, fit the graph, or navigate with the overview.
- Compare scrolling live with the **Scroll improvements** switch above the zoom controls:
  on uses smooth, gentler zoom; off restores the original immediate zoom and wheel sensitivity.
- WebGL rendering for nodes, edges, arrowheads, shadows, and text using deck.gl.
- Light/dark mode with a saved preference and theme-aware graph colors.
- Download a standalone SVG or the original graph source.
- One layout: layered top-to-bottom. One routing mode: right-angle edges.

Keyboard: `/` searches, `Ctrl/Cmd+O` opens a graph, `F` fits, `+`/`-` zoom, and
`Escape` clears the selection. Select a node for details; double-click to focus it.

URLs can preselect a graph and node:

```text
?url=https%3A%2F%2Fexample.com%2Fgraph.dot&node=n172
```

Remote graph servers must allow CORS. Theme preference is the only data saved
to browser storage. Reloading a locally opened file requires opening it again.

## GitHub Pages

This repository contains a complete Pages workflow in `.github/workflows/pages.yml`.

1. Create a GitHub repository named `rGraphViewer` and push this repository to it.
2. In **Settings → Pages → Build and deployment**, select **GitHub Actions**.
3. Push to `main` or run **Build and deploy rGraphViewer** from the Actions tab.

The workflow checks types, runs routing regressions, builds `dist/`, and deploys
that directory. Relative asset and worker URLs support a project URL such as
`https://YOUR-USERNAME.github.io/rGraphViewer/` without build-time configuration.
See the [GitHub Pages custom workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

To publish the initial local branch as `main` in your new remote repository:

```sh
git remote add origin https://github.com/YOUR-USERNAME/rGraphViewer.git
git push -u origin HEAD:main
```

```sh
npm run typecheck
npm test
npm run build
```

`dist/` is a standalone static site. It has no application server, accounts,
external scripts, or CDN fonts. Rendering dependencies are bundled locally.

## Project structure

- `src/app.ts` — application state, file loading, search, dialogs, and inspector.
- `src/canvas.ts` — WebGL layers, camera, GPU picking, and minimap.
- `src/scene.ts` — geometry and theme data shared by WebGL and export.
- `src/svg-export.ts` — standalone vector export, generated only on request.
- `src/camera.ts` — frame-independent zoom with cursor anchoring.
- `src/graph.ts` — fixed layout configuration and measured geometry preparation.
- `public/` — app shell and a small public example graph.
- `vendor/msagl/` — the patched MIT-licensed layout engine source.
- `tests/engine.test.ts` — routing and serialization regression tests.

The engine snapshot and corrections are documented in
[`vendor/msagl/UPSTREAM.md`](vendor/msagl/UPSTREAM.md). The new viewer is a separate
repository; it does not depend on an adjacent MSAGL checkout or local absolute paths.

For private development samples, place files in `.local/graphs/`. The dev server
exposes them at `graphs/`; they are ignored by Git and excluded from production
builds. Only the public demonstration in `public/samples/` is deployed.

## Limits

Layout quality depends on graph structure; the covered routing regressions are
fixed, but this is not a guarantee that every possible DOT construct or graph
is supported. HTML-like labels and Graphviz-specific styling are limited by
the MSAGL parser. The interactive canvas requires WebGL and draws the complete
routed graph without changing geometry at zoom boundaries. Layout still runs
on the CPU in a worker; very large graphs can be expensive to lay out or display.
Touch supports dragging; pinch zoom is
not implemented in this first version (the on-screen zoom controls work on touch).

## License

MIT. MSAGL's original Microsoft copyright and license are retained in
`vendor/msagl/LICENSE` and included in the static distribution.
deck.gl and its rendering dependencies are installed through npm; bundled
package licenses are copied to `dist/licenses/` during builds.
