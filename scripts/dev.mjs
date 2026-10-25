import {context} from 'esbuild'
import {watch} from 'node:fs'
import {cp, access} from 'node:fs/promises'
import path from 'node:path'
import {root, buildOptions, copyPublic} from './config.mjs'

const outdir = path.join(root, '.local/site')
await copyPublic(outdir)
try {
  await access(path.join(root, '.local/graphs'))
  await cp(path.join(root, '.local/graphs'), path.join(outdir, 'graphs'), {recursive: true})
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const ctx = await context(buildOptions(outdir))
await ctx.watch()
watch(path.join(root, 'public'), {recursive: true}, refreshPublic)
const server = await ctx.serve({host: '127.0.0.1', port: Number(process.env.PORT || 5174), servedir: outdir})
console.log(`rGraphViewer: http://127.0.0.1:${server.port}/`)

function refreshPublic() {
  copyPublic(outdir).catch(reportError)
}
function reportError(error) {
  console.error(error)
}
