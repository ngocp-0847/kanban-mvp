/**
 * poller.js — Polls GitHub every POLL_INTERVAL, updates SQLite cache, broadcasts SSE.
 *
 * On startup: serve cached data instantly from DB (zero latency).
 * In background: poll GitHub to detect external changes (merged PRs, web edits etc.)
 */

import { fetchIssues, normalizeIssue, fetchSubIssues } from './github.js'
import {
  upsertIssues, getIssuesFromDb,
  upsertRelation, reconcileRelations,
  refreshDenormalizedSubIssueData, hasPendingJobs,
} from './db.js'

const POLL_INTERVAL = 30_000
const SUB_ISSUE_HYDRATION_CAP = 15  // max parents to hydrate per cycle
const FULL_REHYDRATE_EVERY = 10     // full re-hydration every N cycles

let _hydrationRunning = false
let _pollCycleCount = new Map()  // repoKey → cycle count

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

    // Hydrate sub-issue relationships
    await hydrateSubIssues(repoKey, owner, repo, normalized)

    // Broadcast fresh list (re-read from DB to include denormalized fields)
    const issues = getIssuesFromDb(repoKey)
    broadcast(repoKey, { type: 'sync', repo: repoKey, issues })
    console.log(`[poller] ${repoKey}: ${issues.length} issues`)
  } catch (err) {
    console.error(`[poller] ${repoKey} error:`, err.message)
    broadcast(repoKey, { type: 'error', repo: repoKey, message: err.message })
  }
}

/**
 * Hydrate sub-issue relationships from GitHub.
 * - Fetches sub-issues for parents with sub_issues_summary.total > 0
 * - Capped at SUB_ISSUE_HYDRATION_CAP per cycle
 * - Full re-hydration every FULL_REHYDRATE_EVERY cycles
 * - Skips if previous hydration still running
 * - Skips denormalized overwrite if queue has pending jobs
 */
async function hydrateSubIssues(repoKey, owner, repo, normalized) {
  if (_hydrationRunning) return
  _hydrationRunning = true

  try {
    const cycleNum = (_pollCycleCount.get(repoKey) || 0) + 1
    _pollCycleCount.set(repoKey, cycleNum)
    const isFullCycle = cycleNum % FULL_REHYDRATE_EVERY === 0

    // Find parents that have sub-issues (from sub_issues_summary beta field)
    let parents = normalized.filter(i =>
      i.subIssuesSummary && i.subIssuesSummary.total > 0
    )

    // On full re-hydrate cycles, also include parents we know about from DB
    if (isFullCycle && parents.length === 0) {
      // Even without summary field, re-hydrate from existing relations
      parents = normalized.slice(0, SUB_ISSUE_HYDRATION_CAP)
    }

    // Cap per cycle
    parents = parents.slice(0, SUB_ISSUE_HYDRATION_CAP)

    for (const parent of parents) {
      try {
        const subIssues = await fetchSubIssues({ owner, repo, number: parent.number })
        if (subIssues === null) {
          // Sub-issues API not available for this repo
          if (cycleNum === 1) console.warn(`[poller] sub-issues API not available for ${repoKey}`)
          break
        }

        // Upsert relations
        const childNumbers = []
        for (const sub of subIssues) {
          upsertRelation(repoKey, parent.number, sub.number, 'github')
          childNumbers.push(sub.number)
          // Also cache sub-issue data if not already in DB
          const subNormalized = normalizeIssue(sub)
          upsertIssues(repoKey, [subNormalized])
        }

        // Reconcile: remove stale relations not in GitHub response
        reconcileRelations(repoKey, parent.number, childNumbers)
      } catch (err) {
        console.error(`[poller] sub-issue hydration failed for #${parent.number}:`, err.message)
      }
    }

    // Refresh denormalized columns — but skip if queue has pending jobs
    // to avoid overwriting optimistic local updates
    if (!hasPendingJobs(repoKey)) {
      refreshDenormalizedSubIssueData(repoKey)
    }
  } finally {
    _hydrationRunning = false
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
