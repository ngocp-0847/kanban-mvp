/**
 * poller.js — Polls GitHub every POLL_INTERVAL, updates SQLite cache, broadcasts SSE.
 *
 * On startup: serve cached data instantly from DB (zero latency).
 * In background: poll GitHub to detect external changes (merged PRs, web edits etc.)
 */

import { fetchIssues, normalizeIssue } from './github.js'
import { upsertIssues, getIssuesFromDb } from './db.js'

const POLL_INTERVAL = 30_000

let clients = new Set()     // all SSE clients
const repoClients = new Map() // repoKey → Set<res>
const pollTimers = new Map()  // repoKey → intervalId

// ── SSE client management ────────────────────────────────────────────────────
export function addSSEClient(res, repoKey = null) {
  clients.add(res)
  if (repoKey) {
    if (!repoClients.has(repoKey)) repoClients.set(repoKey, new Set())
    repoClients.get(repoKey).add(res)
  }

  // Send current cached state immediately (from DB — instant)
  if (repoKey) {
    const issues = getIssuesFromDb(repoKey)
    send(res, { type: 'sync', repo: repoKey, issues })
  } else {
    for (const rk of pollTimers.keys()) {
      const issues = getIssuesFromDb(rk)
      send(res, { type: 'sync', repo: rk, issues })
    }
  }

  res.on('close', () => {
    clients.delete(res)
    for (const set of repoClients.values()) set.delete(res)
  })
}

function send(res, event) {
  try { res.write(`data: ${JSON.stringify(event)}\n\n`) } catch (_) {}
}

export function broadcast(repoKey, event) {
  const data = JSON.stringify(event)
  clients.forEach(c => { try { c.write(`data: ${data}\n\n`) } catch (_) {} })
}

// ── Poll one repo ─────────────────────────────────────────────────────────────
async function pollRepo(repoKey) {
  const [owner, repo] = repoKey.split('/')
  try {
    const raw = await fetchIssues({ owner, repo })
    const normalized = raw.map(normalizeIssue)

    // Upsert into SQLite
    upsertIssues(repoKey, normalized)

    // Broadcast fresh list
    broadcast(repoKey, { type: 'sync', repo: repoKey, issues: normalized })
    console.log(`[poller] ${repoKey}: ${normalized.length} issues`)
  } catch (err) {
    console.error(`[poller] ${repoKey} error:`, err.message)
    broadcast(repoKey, { type: 'error', repo: repoKey, message: err.message })
  }
}

// ── Repo registry ─────────────────────────────────────────────────────────────
export function addRepo(repoKey) {
  if (pollTimers.has(repoKey)) return
  console.log(`[poller] Adding: ${repoKey}`)
  pollRepo(repoKey) // immediate poll in background
  pollTimers.set(repoKey, setInterval(() => pollRepo(repoKey), POLL_INTERVAL))
}

export function removeRepo(repoKey) {
  const t = pollTimers.get(repoKey)
  if (t) clearInterval(t)
  pollTimers.delete(repoKey)
  repoClients.delete(repoKey)
  console.log(`[poller] Removed: ${repoKey}`)
}

export async function forceRefresh(repoKey) {
  await pollRepo(repoKey)
}

// Used by queue to broadcast updates
export { broadcast as broadcastToClients }

// Used by server to serve cached issues (instant, no GitHub call)
export function getRepoState(repoKey) {
  return getIssuesFromDb(repoKey)
}
