/**
 * Persistent repo list — stored in repos.json next to this file.
 * Falls back to GITHUB_OWNER/GITHUB_REPO from .env if file is missing.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const REPOS_FILE = join(__dir, 'repos.json')

function load() {
  if (existsSync(REPOS_FILE)) {
    try { return JSON.parse(readFileSync(REPOS_FILE, 'utf8')) } catch (_) {}
  }
  // Seed from env
  const { GITHUB_OWNER, GITHUB_REPO } = process.env
  if (GITHUB_OWNER && GITHUB_REPO) {
    const initial = [{ owner: GITHUB_OWNER, repo: GITHUB_REPO, addedAt: new Date().toISOString() }]
    save(initial)
    return initial
  }
  return []
}

function save(list) {
  writeFileSync(REPOS_FILE, JSON.stringify(list, null, 2))
}

let _repos = load()

export function listRepos() {
  return _repos
}

export function addRepo(owner, repo) {
  const key = `${owner}/${repo}`
  if (_repos.find(r => `${r.owner}/${r.repo}` === key)) {
    return { exists: true }
  }
  _repos.push({ owner, repo, addedAt: new Date().toISOString() })
  save(_repos)
  return { added: true }
}

export function removeRepo(owner, repo) {
  const key = `${owner}/${repo}`
  const before = _repos.length
  _repos = _repos.filter(r => `${r.owner}/${r.repo}` !== key)
  save(_repos)
  return { removed: before !== _repos.length }
}
