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
- Top-to-bottom layered (Sugiyama) layouts with rectilinear routing route their edges
  inside `LayeredLayout.run()` with `layout/layered/orthogonalRouting.ts`, while the
  layout's own vertices still exist. Upstream left these edges to the rectilinear
  router, which routes every edge on its own and ignores the order the layout chose
  to keep crossings down, so edges crossed far more often than the layer order makes
  them (on IR3's control-flow dumps: 58 crossings instead of 8 on a 292-edge graph).
  Every edge leaves its source at the bottom and enters its target at the top. A
  downward edge passes the layers between its ends through the layout's vertices for
  it. An edge drawn upward closes a loop (the vertices below its target that reach
  its source); it leaves its source at the bottom, goes up around the loop just
  outside its outermost vertex of every layer, on the side where it crosses fewer
  edges, and enters its target at the top; inner loops are placed first so outer
  ones go around them. A self-edge goes around its node. Once the ends are placed, the
  layout's vertices of downward edges and the columns of upward edges slide sideways
  inside the room their layers leave them, to the places where the edge bends least
  (dynamic programming over candidate places: fewest bends, then the shortest sideways
  runs, then the smallest moves). A downward edge lines up under its start or over its
  end where the room allows, so that it turns once and goes straight down into its
  target instead of going sideways and back, and a loop goes up in one column. Nothing
  passes another vertex or column of its layer, so the layer order and the crossings it
  makes stay, and nothing comes within 12 of where another edge meets a neighboring
  layer. Between two layers, every horizontal segment gets its own track: of two
  segments, the one whose order makes them cross fewer times runs above the other, two
  that cross as often in either order demand nothing of each other, and a vertical
  coming down close to one going on down turns above it. Layers move apart when a
  channel needs more tracks, and vertices of a layer move apart when the columns
  beside them need room. Ends on one node side are ordered by where their edges go.
  Flat edges and graphs with clusters keep the rectilinear router below.
- In layered (Sugiyama) layouts, the rectilinear router (used for the edges the
  router above does not route, and for other layer directions) makes edges leave
  their source through the node side that faces the next layer and enter their
  target through the side that faces the previous layer: the bottom and the top for top-to-bottom layers
  (`routing/rectilinear/layerSidePorts.ts`, called from `routeEdges` in
  `layout/driver.ts`). Upstream routes every edge from a port at the node's center,
  so edges left and entered nodes through any side. Each edge now gets its own port
  on the node's boundary, spread around the middle of the side in the order of the
  edges' other ends; a port on the boundary only opens outward, so the router
  attaches no edge to another side. With different source and target ports, a
  self-edge is routed as a rectilinear loop out of the bottom and into the top
  instead of `GeomEdge.RouteSelfEdge`'s arc. `RectilinearEdgeRouter.constructorGNAN`
  adds the routed edges' ports to their nodes' shapes.
- Layered drawings keep edges apart. `routeEdges` routes them with a node padding
  of up to 8 (a quarter of the node separation at most; upstream used 1) and keeps
  parallel segments 12 apart (upstream 6). Note that the nudger keeps parallel
  segments twice its edge separation argument apart, so the router is passed 6.
  `LayoutOptions` in renderer-common gained `layerSeparation` and `nodeSeparation`
  for layered layouts, which `diffLayoutSettings` also compares;
  `SugiyamaLayoutSettings.NodeSeparation` has only a getter, so the value is set on
  `commonSettings`. The viewer uses 60 and 40 (upstream defaults 30 and 10) to make
  room for edges between rows and between neighboring nodes.
- `Nudger.NudgePaths` runs one more East and North pass after its usual North, East,
  North. Moving vertical segments in the last North pass lengthens horizontal
  segments, which could stretch one alongside another it was never separated from
  and leave the two on top of each other.

The focused regressions in `tests/engine.test.ts` protect the obstacle routing,
label placement, fixed layout, color round trip, label line ends, edge ends on the
bottom and top of nodes, edges kept apart, loops that go around instead of crossing,
and edges that go straight where their rows leave room. Updates to this snapshot must
preserve those fixes until equivalent fixes are available upstream.
