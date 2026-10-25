# rGraphViewer

- Do not define functions inside other functions. Use top-level helpers or class methods.
- Keep layout fixed to Sugiyama top-to-bottom and edge routing fixed to Rectilinear.
- Keep the interactive graph on WebGL. SVG is an export format, not the live renderer.
- Local graph files are private browser inputs. Do not add user graphs to the public sample directory.
- Preserve the routing fixes documented in `vendor/msagl/UPSTREAM.md`.
- Check `npm run typecheck`, `npm test`, and `npm run build` for engine or application changes.
- Performance measurements must use a release build, performance cores only, and the median of about five runs.
