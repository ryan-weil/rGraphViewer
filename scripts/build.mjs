import {build} from 'esbuild'
import path from 'node:path'
import {root, buildOptions, copyPublic} from './config.mjs'

const outdir = path.join(root, 'dist')
await copyPublic(outdir)
await build(buildOptions(outdir, true))
