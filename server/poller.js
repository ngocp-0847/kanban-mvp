import { fetchIssues, getIssueColumn } from './github.js'

const POLL_INTERVAL = 30_000 // 30 seconds

let clients = [] // SSE clients
let lastState = null // serialized last known state

export function addSSEClient(res) {
  clients.push(res)
  // Send current state immediately on connect
  if (lastState) {
    res.write(`data: ${JSON.stringify({ type: 'sync', issues: lastState })}\n\n`)
  }
  // Remove on disconnect
  res.on('close', () => {
    clients = clients.filter(c => c !== res)
  })
}

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`
  clients.forEach(c => {
    try { c.write(data) } catch (_) {}
  })
}

function normalizeIssues(issues) {
  return issues.map(issue => ({
    id: issue.number,
    number: issue.number,
    title: issue.title,
    body: issue.body || '',
    column: getIssueColumn(issue),
    url: issue.html_url,
    user: issue.user?.login,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    labels: issue.labels.map(l => l.name),
  }))
}

export async function startPoller() {
  console.log(`[poller] Starting — polling GitHub every ${POLL_INTERVAL / 1000}s`)

  async function poll() {
    try {
      const raw = await fetchIssues()
      const normalized = normalizeIssues(raw)
      const stateStr = JSON.stringify(normalized)

      if (stateStr !== JSON.stringify(lastState)) {
        console.log(`[poller] State changed — broadcasting to ${clients.length} clients`)
        lastState = normalized
        broadcast({ type: 'sync', issues: normalized })
      }
    } catch (err) {
      console.error('[poller] Error:', err.message)
    }
  }

  await poll() // immediate first poll
  setInterval(poll, POLL_INTERVAL)
}

export function getCurrentState() {
  return lastState || []
}
