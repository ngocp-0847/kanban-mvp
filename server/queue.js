/**
 * queue.js — Background sync worker.
 *
 * Drains pending jobs from sync_queue every TICK_MS.
 * Each job calls the appropriate GitHub API with the stored token,
 * updates the local DB cache, then broadcasts via SSE.
 *
 * Concurrency: 1 job at a time (simple + avoids rate-limit spikes).
 * Retry: up to 3 times with exponential backoff.
 */

import {
  getPendingJobs, markJobProcessing, markJobDone, markJobFailed,
  updateIssueColumn, markIssueClosed, upsertIssues, insertIssue,
  snapshotIssue, getDb,
  upsertRelation, deleteRelation, recalcParentChildrenDone, getGithubId,
  getParentForChild,
} from './db.js'

import {
  moveIssue, closeIssue, createIssue, postComment,
  updateAssignees, updateLabels, updateIssue,
  fetchIssues, normalizeIssue,
  addSubIssue, removeSubIssue, createAndLinkSubIssue,
  fetchIssueDetail,
} from './github.js'

const TICK_MS = 800          // poll queue every 800ms
const RETRY_DELAYS = [2000, 5000, 15000]  // backoff per retry

let _broadcast = null  // injected from poller
let _running = false
let _timer = null

export function initQueue(broadcastFn) {
  _broadcast = broadcastFn
  _timer = setInterval(tick, TICK_MS)
  console.log(`[queue] Worker started (tick=${TICK_MS}ms)`)
}

export function stopQueue() {
  if (_timer) clearInterval(_timer)
}

async function tick() {
  if (_running) return
  const jobs = getPendingJobs(5)
  if (!jobs.length) return

  _running = true
  for (const job of jobs) {
    await processJob(job)
  }
  _running = false
}

async function processJob(job) {
  const payload = JSON.parse(job.payload)
  const [owner, repo] = job.repo_key.split('/')
  const token = payload._token // per-user token stored in payload
  const repoCtx = { owner, repo, token }

  markJobProcessing(job.id)
  console.log(`[queue] processing #${job.id} ${job.operation} for ${job.repo_key}`)

  try {
    let result

    switch (job.operation) {
      case 'move': {
        result = await moveIssue({ ...repoCtx, number: payload.number, toColumn: payload.column })
        updateIssueColumn(job.repo_key, payload.number, payload.column)
        // If this issue is a child, recalculate parent's children_done
        const parentInfo = getParentForChild(job.repo_key, payload.number)
        if (parentInfo) {
          recalcParentChildrenDone(job.repo_key, parentInfo.parent_number)
        }
        break
      }
      case 'close': {
        result = await closeIssue({ ...repoCtx, number: payload.number })
        markIssueClosed(job.repo_key, payload.number)
        break
      }
      case 'create': {
        result = await createIssue({ ...repoCtx, title: payload.title, body: payload.body })
        // Normalize and cache the new issue
        const normalized = normalizeIssue(result)
        insertIssue(job.repo_key, normalized)
        break
      }
      case 'comment': {
        result = await postComment({ ...repoCtx, number: payload.number, body: payload.body })
        break
      }
      case 'assignees': {
        result = await updateAssignees({ ...repoCtx, number: payload.number, assignees: payload.assignees })
        break
      }
      case 'labels': {
        result = await updateLabels({ ...repoCtx, number: payload.number, labels: payload.labels })
        break
      }
      case 'update': {
        // Snapshot BEFORE applying (history already saved by server route)
        result = await updateIssue({
          ...repoCtx,
          number: payload.number,
          title: payload.title,
          body: payload.body,
        })
        // Update local cache
        getDb().prepare(`
          UPDATE issues SET title = ?, body = ?, updated_at = datetime('now')
          WHERE repo_key = ? AND number = ?
        `).run(payload.title, payload.body ?? '', job.repo_key, payload.number)
        break
      }
      case 'create-sub-issue': {
        // Atomic: create issue + link as sub-issue
        result = await createAndLinkSubIssue({
          ...repoCtx,
          parentNumber: payload.parentNumber,
          title: payload.title,
          body: payload.body || '',
        })
        const newNormalized = normalizeIssue(result)
        insertIssue(job.repo_key, newNormalized)
        upsertRelation(job.repo_key, payload.parentNumber, result.number, 'local')
        recalcParentChildrenDone(job.repo_key, payload.parentNumber)
        if (result._linkFailed) {
          // Partial failure — issue created but not linked on GitHub
          console.warn(`[queue] #${job.id} create-sub-issue: issue created but link failed`)
        }
        break
      }
      case 'add-sub-issue': {
        // Fetch github_id on demand if not available
        let subIssueId = payload.subIssueGithubId
        if (!subIssueId) {
          subIssueId = getGithubId(job.repo_key, payload.childNumber)
        }
        if (!subIssueId) {
          // Last resort: fetch from GitHub
          const detail = await fetchIssueDetail({
            ...repoCtx, number: payload.childNumber,
          })
          subIssueId = detail.id
          // Cache it
          getDb().prepare('UPDATE issues SET github_id = ? WHERE repo_key = ? AND number = ?')
            .run(subIssueId, job.repo_key, payload.childNumber)
        }
        result = await addSubIssue({
          ...repoCtx, number: payload.parentNumber, subIssueId,
        })
        upsertRelation(job.repo_key, payload.parentNumber, payload.childNumber, 'local')
        recalcParentChildrenDone(job.repo_key, payload.parentNumber)
        break
      }
      case 'remove-sub-issue': {
        let subIssueId = payload.subIssueGithubId
        if (!subIssueId) {
          subIssueId = getGithubId(job.repo_key, payload.childNumber)
        }
        if (!subIssueId) {
          const detail = await fetchIssueDetail({
            ...repoCtx, number: payload.childNumber,
          })
          subIssueId = detail.id
        }
        result = await removeSubIssue({
          ...repoCtx, number: payload.parentNumber, subIssueId,
        })
        deleteRelation(job.repo_key, payload.parentNumber, payload.childNumber)
        recalcParentChildrenDone(job.repo_key, payload.parentNumber)
        break
      }
      default:
        throw new Error(`Unknown operation: ${job.operation}`)
    }

    markJobDone(job.id, result)

    // Broadcast updated issues list to SSE clients
    if (_broadcast) {
      const { getIssuesFromDb } = await import('./db.js')
      const issues = getIssuesFromDb(job.repo_key)
      _broadcast(job.repo_key, { type: 'sync', repo: job.repo_key, issues })
      // Also broadcast queue status update
      _broadcast(job.repo_key, {
        type: 'queue_update',
        repo: job.repo_key,
        job: { id: job.id, operation: job.operation, status: 'done' },
      })
    }

    console.log(`[queue] #${job.id} done`)
  } catch (err) {
    console.error(`[queue] #${job.id} failed (retry ${job.retries + 1}/3):`, err.message)
    markJobFailed(job.id, err.message)

    // Broadcast failure so UI can show error
    if (_broadcast) {
      const delay = RETRY_DELAYS[job.retries] || RETRY_DELAYS.at(-1)
      _broadcast(job.repo_key, {
        type: 'queue_error',
        repo: job.repo_key,
        job: { id: job.id, operation: job.operation, error: err.message, retryIn: delay },
      })
    }
  }
}
