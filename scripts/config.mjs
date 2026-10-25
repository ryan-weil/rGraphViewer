import {cp, mkdir, readFile, readdir} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function buildOptions(outdir, production = false) {
  return {
    absWorkingDir: root,
    entryPoints: ['src/app.ts', 'src/worker.ts'],
    bundle: true,
    outdir,
    target: 'es2020',
    minify: production,
    sourcemap: !production,
    legalComments: 'linked',
    logLevel: 'info',
  }
}

export async function copyPublic(outdir) {
  await mkdir(outdir, {recursive: true})
  await cp(path.join(root, 'public'), outdir, {recursive: true})
  await cp(path.join(root, 'vendor/msagl/LICENSE'), path.join(outdir, 'MSAGL-LICENSE.txt'))
  await copyPackageLicenses(outdir)
}

async function copyPackageLicenses(outdir) {
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
  const destination = path.join(outdir, 'licenses')
  await mkdir(destination, {recursive: true})
  for (const location of Object.keys(lock.packages)) {
    if (!location.startsWith('node_modules/')) continue
    const directory = path.join(root, location)
    let entries
    try { entries = await readdir(directory, {withFileTypes: true}) }
    catch (error) { if (error.code === 'ENOENT') continue; throw error }
    for (const entry of entries) {
      if (!entry.isFile() || !/^(license|licence|copying)(?:[.-].*)?$/i.test(entry.name)) continue
      const name = location.slice('node_modules/'.length).replaceAll('/', '__')
      await cp(path.join(directory, entry.name), path.join(destination, `${name}__${entry.name}`))
    }
  }
}
