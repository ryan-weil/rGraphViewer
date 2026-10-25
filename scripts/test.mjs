import {build} from 'esbuild'
import {spawnSync} from 'node:child_process'
import path from 'node:path'
import {root} from './config.mjs'

const outdir = path.join(root, '.local/tests')
await build({absWorkingDir: root, entryPoints: ['tests/engine.test.ts', 'tests/camera.test.ts', 'tests/scene.test.ts'], bundle: true, platform: 'node', outdir, outExtension: {'.js': '.cjs'}})
const result = spawnSync(process.execPath, ['--test', path.join(outdir, 'engine.test.cjs'), path.join(outdir, 'camera.test.cjs'), path.join(outdir, 'scene.test.cjs')], {stdio: 'inherit'})
process.exitCode = result.status ?? 1
