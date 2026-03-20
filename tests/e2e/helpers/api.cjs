/**
 * Direct API helpers for E2E tests.
 * Uses the server's REST API with cookie auth.
 */

const API = 'http://localhost:4000'

async function apiCall(request, method, path, data) {
  const opts = {
    headers: { 'Content-Type': 'application/json' },
  }
  if (data) opts.data = data

  const fn = {
    GET: () => request.get(`${API}${path}`, opts),
    POST: () => request.post(`${API}${path}`, opts),
    PATCH: () => request.patch(`${API}${path}`, opts),
    DELETE: () => request.delete(`${API}${path}`, opts),
  }[method]

  const res = await fn()
  return { status: res.status(), body: await res.json().catch(() => null) }
}

async function getRepos(request) {
  return (await apiCall(request, 'GET', '/api/repos')).body
}

async function getIssues(request, owner, repo) {
  return (await apiCall(request, 'GET', `/api/repos/${owner}/${repo}/issues`)).body
}

async function getQueueStats(request, owner, repo) {
  return (await apiCall(request, 'GET', `/api/repos/${owner}/${repo}/queue`)).body
}

async function waitForQueueEmpty(request, owner, repo, timeout = 10_000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const q = await getQueueStats(request, owner, repo)
    const pending = q?.stats?.find(s => s.status === 'pending')?.count || 0
    const processing = q?.stats?.find(s => s.status === 'processing')?.count || 0
    if (pending === 0 && processing === 0) return true
    await new Promise(r => setTimeout(r, 300))
  }
  throw new Error(`Queue did not empty within ${timeout}ms`)
}

module.exports = { apiCall, getRepos, getIssues, getQueueStats, waitForQueueEmpty }
