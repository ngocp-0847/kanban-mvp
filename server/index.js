import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import {
  createIssue, moveIssue, closeIssue, ensureLabels,
  fetchIssueDetail, fetchComments, postComment,
  fetchCollaborators, updateAssignees, updateLabels, fetchRepoLabels
} from './github.js'
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

// ── Issue detail ─────────────────────────────────────────────────────────────
app.get('/api/issues/:id', async (req, res) => {
  try {
    const issue = await fetchIssueDetail(Number(req.params.id))
    res.json(issue)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/issues/:id/comments', async (req, res) => {
  try {
    const comments = await fetchComments(Number(req.params.id))
    res.json(comments)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/issues/:id/comments', async (req, res) => {
  try {
    const { body } = req.body
    if (!body) return res.status(400).json({ error: 'body required' })
    const comment = await postComment(Number(req.params.id), body)
    res.status(201).json(comment)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/issues/:id/assignees', async (req, res) => {
  try {
    const { assignees } = req.body
    const issue = await updateAssignees(Number(req.params.id), assignees)
    res.json(issue)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/issues/:id/labels', async (req, res) => {
  try {
    const { labels } = req.body
    const issue = await updateLabels(Number(req.params.id), labels)
    res.json(issue)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/collaborators', async (req, res) => {
  try { res.json(await fetchCollaborators()) }
  catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/labels', async (req, res) => {
  try { res.json(await fetchRepoLabels()) }
  catch (err) { res.status(500).json({ error: err.message }) }
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
