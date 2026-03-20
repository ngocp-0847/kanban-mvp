import { fetchIssues, normalizeIssue } from './github.js'

const POLL_INTERVAL = 30_000

// repoKey = "owner/repo"
const repoStates = new Map()   // repoKey → normalized[]
const repoClients = new Map()  // repoKey → Set<res>
let allClients = new Set()     // SSE clients subscribed to all repos

// ── SSE client management ────────────────────────────────────────────────────
export function addSSEClient(res, repoKey = null) {
  if (repoKey) {
    if (!repoClients.has(repoKey)) repoClients.set(repoKey, new Set())
    repoClients.get(repoKey).add(res)
    // Send current state immediately
    const state = repoStates.get(repoKey)
    if (state) send(res, { type: 'sync', repo: repoKey, issues: state })
  } else {
    allClients.add(res)
    // Send all known states
    for (const [rk, issues] of repoStates) {
      send(res, { type: 'sync', repo: rk, issues })
    }
  }

  res.on('close', () => {
    allClients.delete(res)
    for (const clients of repoClients.values()) clients.delete(res)
  })
}

function send(res, event) {
  try { res.write(`data: ${JSON.stringify(event)}\n\n`) } catch (_) {}
}

function broadcast(repoKey, event) {
  const data = JSON.stringify(event)
  allClients.forEach(c => { try { c.write(`data: ${data}\n\n`) } catch (_) {} })
  const specific = repoClients.get(repoKey)
  if (specific) specific.forEach(c => { try { c.write(`data: ${data}\n\n`) } catch (_) {} })
}

// ── Poll one repo ─────────────────────────────────────────────────────────────
async function pollRepo(repoKey) {
  const [owner, repo] = repoKey.split('/')
  try {
    const raw = await fetchIssues({ owner, repo })
    const normalized = raw.map(normalizeIssue)
    const prev = JSON.stringify(repoStates.get(repoKey) || [])
    const next = JSON.stringify(normalized)
    if (prev !== next) {
      console.log(`[poller] ${repoKey} changed → ${normalized.length} issues`)
      repoStates.set(repoKey, normalized)
      broadcast(repoKey, { type: 'sync', repo: repoKey, issues: normalized })
    }
  } catch (err) {
    console.error(`[poller] ${repoKey} error:`, err.message)
    broadcast(repoKey, { type: 'error', repo: repoKey, message: err.message })
  }
}

// ── Repo registry ─────────────────────────────────────────────────────────────
const pollTimers = new Map()   // repoKey → intervalId

export function addRepo(repoKey) {
  if (pollTimers.has(repoKey)) return // already polling
  console.log(`[poller] Adding repo: ${repoKey}`)
  pollRepo(repoKey) // immediate first poll
  pollTimers.set(repoKey, setInterval(() => pollRepo(repoKey), POLL_INTERVAL))
}

export function removeRepo(repoKey) {
  const timer = pollTimers.get(repoKey)
  if (timer) clearInterval(timer)
  pollTimers.delete(repoKey)
  repoStates.delete(repoKey)
  repoClients.delete(repoKey)
  console.log(`[poller] Removed repo: ${repoKey}`)
}

export function forceRefresh(repoKey) {
  return pollRepo(repoKey)
}

export function getRepoState(repoKey) {
  return repoStates.get(repoKey) || []
}

export function getActiveRepos() {
  return [...pollTimers.keys()]
}
