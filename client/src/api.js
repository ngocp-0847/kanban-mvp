const BASE = '/api'

// ── Auth ─────────────────────────────────────────────────────────────────────
export async function getMe() {
  const res = await fetch('/api/auth/me', { credentials: 'include' })
  if (res.status === 401) return null
  const data = await res.json()
  return data.user || null
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
}

// ── Repo management ──────────────────────────────────────────────────────────
export async function getRepos() {
  const res = await fetch(`${BASE}/repos`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch repos')
  return res.json()
}

export async function addRepo(owner, repo) {
  const res = await fetch(`${
    credentials: 'include',BASE}/repos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner, repo }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to add repo')
  return data
}

export async function removeRepo(owner, repo) {
  const res = await fetch(`${
    credentials: 'include',BASE}/repos/${owner}/${repo}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to remove repo')
  return res.json()
}

export async function refreshRepo(owner, repo) {
  await fetch(`${BASE}/repos/${owner}/${repo}/refresh`, { method: 'POST' })
}

// ── Issues ───────────────────────────────────────────────────────────────────
export async function getIssues(owner, repo) {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/issues`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch issues')
  return res.json()
}

export async function createIssue(owner, repo, title, body = '') {
  const res = await fetch(`${
    credentials: 'include',BASE}/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body }),
  })
  if (!res.ok) throw new Error('Failed to create issue')
  return res.json()
}

export async function moveIssue(owner, repo, id, column) {
  const res = await fetch(`${
    credentials: 'include',BASE}/repos/${owner}/${repo}/issues/${id}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ column }),
  })
  if (!res.ok) throw new Error('Failed to move issue')
  return res.json()
}

export async function closeIssue(owner, repo, id) {
  const res = await fetch(`${
    credentials: 'include',BASE}/repos/${owner}/${repo}/issues/${id}/close`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error('Failed to close issue')
  return res.json()
}

export async function getIssueDetail(owner, repo, id) {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/issues/${id}`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch issue detail')
  return res.json()
}

export async function getComments(owner, repo, id) {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/issues/${id}/comments`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch comments')
  return res.json()
}

export async function postComment(owner, repo, id, body) {
  const res = await fetch(`${
    credentials: 'include',BASE}/repos/${owner}/${repo}/issues/${id}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  })
  if (!res.ok) throw new Error('Failed to post comment')
  return res.json()
}

export async function updateAssignees(owner, repo, id, assignees) {
  const res = await fetch(`${
    credentials: 'include',BASE}/repos/${owner}/${repo}/issues/${id}/assignees`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignees }),
  })
  if (!res.ok) throw new Error('Failed to update assignees')
  return res.json()
}

export async function updateLabels(owner, repo, id, labels) {
  const res = await fetch(`${
    credentials: 'include',BASE}/repos/${owner}/${repo}/issues/${id}/labels`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ labels }),
  })
  if (!res.ok) throw new Error('Failed to update labels')
  return res.json()
}

export async function getCollaborators(owner, repo) {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/collaborators`, { credentials: 'include' })
  if (!res.ok) return []
  return res.json()
}

export async function getRepoLabels(owner, repo) {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/labels`, { credentials: 'include' })
  if (!res.ok) return []
  return res.json()
}

// ── SSE ──────────────────────────────────────────────────────────────────────
export function subscribeToEvents(onMessage, repoKey = null) {
  const url = repoKey ? `/api/events?repo=${encodeURIComponent(repoKey)}` : '/api/events'

  let es
  let reconnectTimer

  function connect() {
    es = new EventSource(url, { withCredentials: true })
    es.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data)) } catch (_) {}
    }
    es.onerror = () => {
      es.close()
      reconnectTimer = setTimeout(connect, 3000) // auto-reconnect
    }
  }

  connect()
  return () => {
    clearTimeout(reconnectTimer)
    es?.close()
  }
}

// ── Issue edit + history ─────────────────────────────────────────────────────

export async function updateIssue(owner, repo, id, title, body) {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/issues/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body }),
  })
  if (!res.ok) throw new Error('Failed to update issue')
  return res.json()
}

export async function getIssueHistory(owner, repo, id) {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/issues/${id}/history`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to fetch history')
  return res.json()
}

export async function revertIssue(owner, repo, id, version) {
  const res = await fetch(
    `${BASE}/repos/${owner}/${repo}/issues/${id}/history/${version}/revert`,
    { method: 'POST', credentials: 'include' }
  )
  if (!res.ok) throw new Error('Failed to revert')
  return res.json()
}

export async function getQueueStatus(owner, repo) {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/queue`, { credentials: 'include' })
  if (!res.ok) return null
  return res.json()
}

// ── Sub-issues ──────────────────────────────────────────────────────────────

export async function getSubIssues(owner, repo, id) {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/issues/${id}/sub-issues`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch sub-issues')
  return res.json()
}

export async function createSubIssue(owner, repo, parentId, title, body = '') {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/issues/${parentId}/sub-issues`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to create sub-issue')
  }
  return res.json()
}

export async function linkSubIssue(owner, repo, parentId, childNumber) {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/issues/${parentId}/sub-issues/link`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ childNumber }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to link sub-issue')
  }
  return res.json()
}

export async function unlinkSubIssue(owner, repo, parentId, childNumber) {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/issues/${parentId}/sub-issues/${childNumber}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Failed to unlink sub-issue')
  return res.json()
}

export async function getIssueParent(owner, repo, id) {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/issues/${id}/parent`, { credentials: 'include' })
  if (!res.ok) return null
  return res.json()
}
