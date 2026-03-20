const BASE = '/api'

export async function getIssues() {
  const res = await fetch(`${BASE}/issues`)
  if (!res.ok) throw new Error('Failed to fetch issues')
  return res.json()
}

export async function createIssue(title, body = '') {
  const res = await fetch(`${BASE}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body }),
  })
  if (!res.ok) throw new Error('Failed to create issue')
  return res.json()
}

export async function moveIssue(id, column) {
  const res = await fetch(`${BASE}/issues/${id}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ column }),
  })
  if (!res.ok) throw new Error('Failed to move issue')
  return res.json()
}

export async function closeIssue(id) {
  const res = await fetch(`${BASE}/issues/${id}/close`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error('Failed to close issue')
  return res.json()
}

export async function getIssueDetail(id) {
  const res = await fetch(`${BASE}/issues/${id}`)
  if (!res.ok) throw new Error('Failed to fetch issue detail')
  return res.json()
}

export async function getComments(id) {
  const res = await fetch(`${BASE}/issues/${id}/comments`)
  if (!res.ok) throw new Error('Failed to fetch comments')
  return res.json()
}

export async function postComment(id, body) {
  const res = await fetch(`${BASE}/issues/${id}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  })
  if (!res.ok) throw new Error('Failed to post comment')
  return res.json()
}

export async function updateAssignees(id, assignees) {
  const res = await fetch(`${BASE}/issues/${id}/assignees`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignees }),
  })
  if (!res.ok) throw new Error('Failed to update assignees')
  return res.json()
}

export async function updateLabels(id, labels) {
  const res = await fetch(`${BASE}/issues/${id}/labels`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ labels }),
  })
  if (!res.ok) throw new Error('Failed to update labels')
  return res.json()
}

export async function getCollaborators() {
  const res = await fetch(`${BASE}/collaborators`)
  if (!res.ok) return []
  return res.json()
}

export async function getRepoLabels() {
  const res = await fetch(`${BASE}/labels`)
  if (!res.ok) return []
  return res.json()
}

export function subscribeToEvents(onMessage) {
  const es = new EventSource('/api/events')
  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      onMessage(data)
    } catch (_) {}
  }
  es.onerror = () => {
    console.warn('[SSE] connection error — will retry')
  }
  return () => es.close()
}
