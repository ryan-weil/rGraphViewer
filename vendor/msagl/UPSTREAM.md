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
- Plain-text DOT labels are split into lines as Graphviz splits them
  (`parser/src/label.ts`): `\n`, `\l` and `\r` end a centered, left-justified or
  right-justified line, and a line end at the end of the label adds no empty line.
  A backslash before any other character stands for that character, except
  `\N`, `\G`, `\E`, `\T`, `\H` and `\L`, which are kept as written. Upstream turned
  only `\n` into a line break. `DrawingObject.labelLineJustification` holds each
  line's justification (undefined when every line is centered), `copyValidFields`
  copies it with the label, and `graphToJSON` writes labels back as DOT label
  values, so the layout worker's round trip reads the same lines.

The focused regressions in `tests/engine.test.ts` protect the obstacle routing,
label placement, fixed layout, color round trip, and label line ends. Updates to
this snapshot must preserve those fixes until equivalent fixes are available upstream.
