'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const core = require('./git-core.cjs')
const grants = new Map()
let verifiedGit = null
const MAX_SNAPSHOTS = 30
function host() { return typeof window !== 'undefined' && window.ztools ? window.ztools : {} }
function clearSession() { grants.clear(); verifiedGit = null }
function dialogPath(result) { return Array.isArray(result) ? result[0] : typeof result === 'string' ? result : result && Array.isArray(result.filePaths) ? result.filePaths[0] : null }
function grantId() { return crypto.randomBytes(12).toString('hex') }
function getGrant(id) { const grant = grants.get(id); if (!grant || grant.expiresAt < Date.now()) { grants.delete(id); throw new Error('Repository authorization has expired') } return grant }
async function chooseRepository() {
  const api = host(); if (typeof api.showOpenDialog !== 'function') return { ok: false, code: 'DIALOG_UNAVAILABLE' }
  const value = dialogPath(await api.showOpenDialog({ title: '选择 Git 仓库目录', properties: ['openDirectory'] }))
  if (!value) return { ok: false, code: 'CANCELED' }
  const repository = await core.authorizeRepository(value)
  if (grants.size >= MAX_SNAPSHOTS) grants.delete(grants.keys().next().value)
  const identity = await fs.stat(repository)
  const id = grantId(); grants.set(id, { repository, dev: identity.dev, ino: identity.ino, mtimeMs: identity.mtimeMs, expiresAt: Date.now() + 30 * 60 * 1000, snapshot: null })
  return { ok: true, grantId: id, repository: path.basename(repository) || repository }
}
async function inspectGrant(id) {
  const grant = getGrant(id)
  const stable = await core.authorizeRepository(grant.repository)
  const identity = await fs.stat(stable)
  if (stable !== grant.repository || identity.dev !== grant.dev || identity.ino !== grant.ino || identity.mtimeMs !== grant.mtimeMs) { grants.delete(id); throw new Error('Authorized repository changed after selection') }
  if (!verifiedGit) verifiedGit = await core.resolveGit(undefined, process.platform)
  const snapshot = await core.inspect(grant.repository, verifiedGit)
  grant.snapshot = snapshot
  return { repository: path.basename(snapshot.repository) || snapshot.repository, worktrees: snapshot.worktrees }
}
function dryPlan(action) { return Object.freeze({ executable: false, version: '0.1', action: String(action || 'unknown'), message: 'v0.1 只读：不会创建、移除或修改 Git worktree。' }) }
function stringifySnapshot(snapshot, format) { return format === 'json' ? JSON.stringify({ repository: snapshot.repository, worktrees: snapshot.worktrees }, null, 2) + '\n' : snapshot.markdown + '\n' }
async function saveSnapshot(id, format) {
  const grant = getGrant(id); if (!grant.snapshot) throw new Error('Inspect the repository before exporting')
  const kind = format === 'json' ? 'json' : 'markdown'; const api = host()
  if (typeof api.showSaveDialog !== 'function') throw new Error('Save dialog is unavailable')
  const chosen = await api.showSaveDialog({ title: '保存 Worktree 快照', defaultPath: 'worktree-snapshot.' + (kind === 'json' ? 'json' : 'md'), filters: [{ name: kind.toUpperCase(), extensions: [kind === 'json' ? 'json' : 'md'] }] })
  const destination = typeof chosen === 'string' ? chosen : chosen && !chosen.canceled ? chosen.filePath : null
  if (!destination || !path.isAbsolute(destination)) return { canceled: true }
  try { const prior = await fs.lstat(destination); if (prior.isSymbolicLink()) throw new Error('Refusing to overwrite a symlink') } catch (error) { if (error && error.code !== 'ENOENT') throw error }
  const temporary = destination + '.ztools-' + crypto.randomBytes(6).toString('hex') + '.tmp'
  try {
    await fs.writeFile(temporary, stringifySnapshot(grant.snapshot, kind), { encoding: 'utf8', mode: 0o600 })
    await fs.rename(temporary, destination)
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}) }
  return { canceled: false, fileName: path.basename(destination) }
}
async function copySnapshot(id, format) {
  const grant = getGrant(id); if (!grant.snapshot) throw new Error('Inspect the repository before copying')
  const api = host(); if (typeof api.copyText !== 'function') throw new Error('Copy capability is unavailable')
  return api.copyText(stringifySnapshot(grant.snapshot, format === 'json' ? 'json' : 'markdown')) !== false
}
if (typeof host().onPluginOut === 'function') host().onPluginOut(clearSession)
window.gitWorktreeCockpit = Object.freeze({ chooseRepository, inspectGrant, dryPlan, saveSnapshot, copySnapshot })
