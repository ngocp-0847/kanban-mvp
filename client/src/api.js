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
