import { access, readFile } from 'node:fs/promises'; import path from 'node:path'; import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const dist = path.join(root, 'dist'); const manifest = JSON.parse(await readFile(path.join(dist, 'plugin.json'), 'utf8'))
if (manifest.development) throw new Error('dist manifest must not contain development'); for (const file of [manifest.main, manifest.logo, manifest.preload, 'preload/git-core.cjs']) await access(path.join(dist, file)); console.log('Verified git-worktree-cockpit dist')
