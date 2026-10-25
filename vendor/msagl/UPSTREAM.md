# MSAGL engine snapshot

Source: https://github.com/microsoft/msagljs

Base commit: `c19cc2a75ee5f343d8e4fce658dce6f52ec54358`.
The original MIT license is retained in `LICENSE`. Only the core, drawing,
parser, and renderer-common source modules are included. The rGraphViewer
interface and WebGL canvas live separately in `src/`. The canvas uses deck.gl,
the rendering library used by MSAGL's WebGL renderer, with the full routed geometry.

Local corrections carried into this snapshot:

- Preserve normal layered routing and label placement for elongated graphs.
- Decrement obstacle nesting depth when the rectilinear sweep leaves an obstacle.
- Preserve orthogonal edge geometry when building coarse tiles (available to
  consumers of the engine; this viewer draws the complete routed graph).
- The base commit includes DOT color parsing and serialization corrections.
- Removed an unused `yargs` import from the projection solver; the browser engine
  does not require a command-line argument parser.
- DOT parse failures throw an error with the source location so the editor can
  display a useful message and preserve the last successfully loaded graph.

The focused regressions in `tests/engine.test.ts` protect the obstacle routing,
label placement, fixed layout, and color round trip. Updates to this snapshot
must preserve those fixes until equivalent fixes are available upstream.
