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
- In layered (Sugiyama) layouts, rectilinear edges leave their source through the
  node side that faces the next layer and enter their target through the side that
  faces the previous layer: the bottom and the top for top-to-bottom layers
  (`routing/rectilinear/layerSidePorts.ts`, called from `routeEdges` in
  `layout/driver.ts`). Upstream routes every edge from a port at the node's center,
  so edges left and entered nodes through any side. Each edge now gets its own port
  on the node's boundary, spread around the middle of the side in the order of the
  edges' other ends; a port on the boundary only opens outward, so the router
  attaches no edge to another side. With different source and target ports, a
  self-edge is routed as a rectilinear loop out of the bottom and into the top
  instead of `GeomEdge.RouteSelfEdge`'s arc. `RectilinearEdgeRouter.constructorGNAN`
  adds the routed edges' ports to their nodes' shapes, and layered drawings route
  with a node padding of 4 instead of 1, so edges that pass a node keep clear of it.

The focused regressions in `tests/engine.test.ts` protect the obstacle routing,
label placement, fixed layout, color round trip, label line ends, and edge ends on
the bottom and top of nodes. Updates to this snapshot must preserve those fixes
until equivalent fixes are available upstream.
