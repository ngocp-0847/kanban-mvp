import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createIssue, moveIssue, closeIssue, ensureLabels } from './github.js'
import { startPoller, addSSEClient, getCurrentState } from './poller.js'

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

// ── Config ──────────────────────────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json({
    owner: process.env.GITHUB_OWNER,
    repo: process.env.GITHUB_REPO,
  })
})

// ── SSE — real-time updates from poller ────────────────────────────────────
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n')
  }, 15_000)

  res.on('close', () => clearInterval(heartbeat))
  addSSEClient(res)
})

// ── Issues ──────────────────────────────────────────────────────────────────
app.get('/api/issues', (req, res) => {
  res.json(getCurrentState())
})

app.post('/api/issues', async (req, res) => {
  try {
    const { title, body } = req.body
    if (!title) return res.status(400).json({ error: 'title required' })
    const issue = await createIssue(title, body)
    res.status(201).json(issue)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.patch('/api/issues/:id/move', async (req, res) => {
  try {
    const { column } = req.body
    if (!column) return res.status(400).json({ error: 'column required' })
    const issue = await moveIssue(Number(req.params.id), column)
    res.json(issue)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.patch('/api/issues/:id/close', async (req, res) => {
  try {
    const issue = await closeIssue(Number(req.params.id))
    res.json(issue)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Start ───────────────────────────────────────────────────────────────────
async function start() {
  // Validate env
  const required = ['GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO']
  const missing = required.filter(k => !process.env[k])
  if (missing.length) {
    console.error(`[server] Missing env vars: ${missing.join(', ')}`)
    console.error('[server] Copy .env.example to .env and fill in values')
    process.exit(1)
  }

  // Ensure kanban labels exist on GitHub
  await ensureLabels()

  // Start poller
  await startPoller()

  app.listen(PORT, () => {
    console.log(`[server] Running at http://localhost:${PORT}`)
  })
}

start()
