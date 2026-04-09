import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'

import {
  fetchIssueDetail, fetchComments,
  fetchCollaborators, fetchRepoLabels,
  ensureLabels, fetchRepoInfo,
} from './github.js'

import {
  addSSEClient, addRepo as pollerAdd, removeRepo as pollerRemove,
  forceRefresh, getRepoState, broadcastToClients,
} from './poller.js'

import { initQueue } from './queue.js'
import {
  getIssuesFromDb, enqueue, getQueueStats, getRecentLog,
  updateIssueColumn, markIssueClosed,
  snapshotIssue, getIssueHistory, getHistoryVersion, getDb,
} from './db.js'

import {
  listRepos, addRepo as storeAdd, removeRepo as storeRemove,
} from './repos.js'

import { mountAuthRoutes, requireAuth, initAuth, getGhUser } from './auth.js'
import { getGanttData } from './gantt.js'

const app = express()
const PORT = process.env.PORT || 3001

// ── Security ─────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Vite proxy handles this
}))

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  credentials: true,
}))

app.use(express.json())

// ── Auth routes (public) ──────────────────────────────────────────────────────
mountAuthRoutes(app)

// ── All routes below require auth ─────────────────────────────────────────────
app.use('/api', requireAuth)

// ── Helpers ───────────────────────────────────────────────────────────────────
const repoParam = (req) => ({
  owner: req.params.owner,
  repo: req.params.repo,
})

// ── SSE ───────────────────────────────────────────────────────────────────────
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  const hb = setInterval(() => res.write(': heartbeat\n\n'), 15_000)
  res.on('close', () => clearInterval(hb))
  addSSEClient(res, req.query.repo || null)
})

// ── Repo management ────────────────────────────────────────────────────────────
app.get('/api/repos', (req, res) => res.json(listRepos()))

app.post('/api/repos', async (req, res) => {
  try {
    const { owner, repo } = req.body
    if (!owner || !repo) return res.status(400).json({ error: 'owner and repo required' })
    await fetchRepoInfo({ owner, repo })
    const result = storeAdd(owner, repo)
    if (result.exists) return res.status(409).json({ error: 'Repo already added' })
    await ensureLabels({ owner, repo })
    pollerAdd(`${owner}/${repo}`)
    res.status(201).json({ owner, repo })
  } catch (err) {
    res.status(422).json({ error: err.message })
  }
})

app.delete('/api/repos/:owner/:repo', (req, res) => {
  pollerRemove(`${req.params.owner}/${req.params.repo}`)
  storeRemove(req.params.owner, req.params.repo)
  res.json({ removed: true })
})

app.post('/api/repos/:owner/:repo/refresh', async (req, res) => {
  await forceRefresh(`${req.params.owner}/${req.params.repo}`)
  res.json({ ok: true })
})

// ── Issues ─────────────────────────────────────────────────────────────────────
app.get('/api/repos/:owner/:repo/issues', (req, res) => {
  res.json(getRepoState(`${req.params.owner}/${req.params.repo}`))
})

app.post('/api/repos/:owner/:repo/issues', async (req, res) => {
  try {
    const { title, body } = req.body
    if (!title) return res.status(400).json({ error: 'title required' })
    const repoKey = `${req.params.owner}/${req.params.repo}`
    const userLogin = getGhUser()?.login
    const jobId = enqueue(repoKey, 'create', { title, body }, userLogin)
    res.status(202).json({ queued: true, jobId, title, column: 'todo' })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/repos/:owner/:repo/issues/:id', async (req, res) => {
  try {
    res.json(await fetchIssueDetail({ ...repoParam(req), number: Number(req.params.id) }))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/repos/:owner/:repo/issues/:id/move', (req, res) => {
  try {
    const { column } = req.body
    if (!column) return res.status(400).json({ error: 'column required' })
    const repoKey = `${req.params.owner}/${req.params.repo}`
    const number = Number(req.params.id)
    const userLogin = getGhUser()?.login

    // Optimistic update in DB immediately (board shows change instantly)
    updateIssueColumn(repoKey, number, column)

    // Broadcast optimistic state
    const issues = getIssuesFromDb(repoKey)
    broadcastToClients(repoKey, { type: 'sync', repo: repoKey, issues })

    // Enqueue actual GitHub write
    const jobId = enqueue(repoKey, 'move', { number, column }, userLogin)

    res.json({ queued: true, jobId, number, column })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/repos/:owner/:repo/issues/:id/close', (req, res) => {
  try {
    const repoKey = `${req.params.owner}/${req.params.repo}`
    const number = Number(req.params.id)
    const userLogin = getGhUser()?.login

    // Optimistic: remove from cache immediately
    markIssueClosed(repoKey, number)
    const issues = getIssuesFromDb(repoKey)
    broadcastToClients(repoKey, { type: 'sync', repo: repoKey, issues })

    const jobId = enqueue(repoKey, 'close', { number }, userLogin)
    res.json({ queued: true, jobId, number })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/repos/:owner/:repo/issues/:id/comments', async (req, res) => {
  try { res.json(await fetchComments({ ...repoParam(req), number: Number(req.params.id) })) }
  catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/repos/:owner/:repo/issues/:id/comments', (req, res) => {
  try {
    const { body } = req.body
    if (!body) return res.status(400).json({ error: 'body required' })
    const repoKey = `${req.params.owner}/${req.params.repo}`
    const number = Number(req.params.id)
    const userLogin = getGhUser()?.login
    const jobId = enqueue(repoKey, 'comment', { number, body }, userLogin)
    res.status(202).json({ queued: true, jobId })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/repos/:owner/:repo/issues/:id/assignees', (req, res) => {
  try {
    const repoKey = `${req.params.owner}/${req.params.repo}`
    const number = Number(req.params.id)
    const userLogin = getGhUser()?.login
    const jobId = enqueue(repoKey, 'assignees', { number, assignees: req.body.assignees }, userLogin)
    res.json({ queued: true, jobId })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/repos/:owner/:repo/issues/:id/labels', (req, res) => {
  try {
    const repoKey = `${req.params.owner}/${req.params.repo}`
    const number = Number(req.params.id)
    const userLogin = getGhUser()?.login
    const jobId = enqueue(repoKey, 'labels', { number, labels: req.body.labels }, userLogin)
    res.json({ queued: true, jobId })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/repos/:owner/:repo/collaborators', async (req, res) => {
  try { res.json(await fetchCollaborators(repoParam(req))) }
  catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/repos/:owner/:repo/labels', async (req, res) => {
  try { res.json(await fetchRepoLabels(repoParam(req))) }
  catch (err) { res.status(500).json({ error: err.message }) }
})

// ── Issue edit + history ──────────────────────────────────────────────────────

app.patch('/api/repos/:owner/:repo/issues/:id', (req, res) => {
  try {
    const { title, body } = req.body
    if (!title) return res.status(400).json({ error: 'title required' })

    const repoKey = `${req.params.owner}/${req.params.repo}`
    const number = Number(req.params.id)
    const userLogin = getGhUser()?.login

    // Get current state from DB for snapshot
    const current = getDb().prepare(
      'SELECT title, body FROM issues WHERE repo_key = ? AND number = ?'
    ).get(repoKey, number)

    // Snapshot CURRENT version before overwriting
    const version = snapshotIssue(repoKey, number, {
      title: current?.title || title,
      body: current?.body || '',
      editedBy: userLogin,
    })

    // Optimistic DB update
    getDb().prepare(
      `UPDATE issues SET title = ?, body = ?, updated_at = datetime('now') WHERE repo_key = ? AND number = ?`
    ).run(title, body ?? '', repoKey, number)

    // Broadcast optimistic
    const issues = getIssuesFromDb(repoKey)
    broadcastToClients(repoKey, { type: 'sync', repo: repoKey, issues })

    // Enqueue GitHub write
    const jobId = enqueue(repoKey, 'update', { number, title, body }, userLogin)

    res.json({ queued: true, jobId, version })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/repos/:owner/:repo/issues/:id/history', requireAuth, (req, res) => {
  const repoKey = `${req.params.owner}/${req.params.repo}`
  const number = Number(req.params.id)
  const history = getIssueHistory(repoKey, number)
  res.json(history)
})

app.post('/api/repos/:owner/:repo/issues/:id/history/:version/revert', (req, res) => {
  try {
    const repoKey = `${req.params.owner}/${req.params.repo}`
    const number = Number(req.params.id)
    const targetVersion = Number(req.params.version)
    const userLogin = getGhUser()?.login

    // Find target version
    const target = getHistoryVersion(repoKey, number, targetVersion)
    if (!target) return res.status(404).json({ error: `Version ${targetVersion} not found` })

    // Snapshot current state before reverting
    const current = getDb().prepare(
      'SELECT title, body FROM issues WHERE repo_key = ? AND number = ?'
    ).get(repoKey, number)

    snapshotIssue(repoKey, number, {
      title: current?.title || '',
      body: current?.body || '',
      editedBy: userLogin,
    })

    // Save new snapshot flagged as revert
    const newVersion = snapshotIssue(repoKey, number, {
      title: target.title,
      body: target.body,
      editedBy: userLogin,
      revertOf: target.id,
    })

    // Optimistic cache update
    getDb().prepare(
      `UPDATE issues SET title = ?, body = ?, updated_at = datetime('now') WHERE repo_key = ? AND number = ?`
    ).run(target.title, target.body, repoKey, number)

    const issues = getIssuesFromDb(repoKey)
    broadcastToClients(repoKey, { type: 'sync', repo: repoKey, issues })

    // Enqueue GitHub write
    const jobId = enqueue(repoKey, 'update', {
      number, title: target.title, body: target.body,
    }, userLogin)

    res.json({ queued: true, jobId, revertedTo: targetVersion, newVersion })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ── Gantt (GitHub Projects v2) ───────────────────────────────────────────────
app.get('/api/gantt/projects/:org/:number', async (req, res) => {
  try {
    const { meta } = await getGanttData(req.params.org, Number(req.params.number))
    res.json(meta)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/gantt/projects/:org/:number/items', async (req, res) => {
  try {
    const data = await getGanttData(req.params.org, Number(req.params.number))
    res.json({
      project: { org: req.params.org, number: Number(req.params.number), title: data.meta.title },
      iterations: data.meta.iterations,
      statusOptions: data.meta.statusOptions,
      tree: data.tree,
      flatItems: data.items,
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/gantt/projects/:org/:number/refresh', async (req, res) => {
  try {
    const data = await getGanttData(req.params.org, Number(req.params.number), true)
    res.json({ ok: true, itemCount: data.items.length })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ── Queue status / log endpoints ──────────────────────────────────────────────
app.get('/api/repos/:owner/:repo/queue', requireAuth, (req, res) => {
  const repoKey = `${req.params.owner}/${req.params.repo}`
  res.json({
    stats: getQueueStats(repoKey),
    recent: getRecentLog(repoKey, 30),
  })
})

// ── Start ──────────────────────────────────────────────────────────────────────
async function start() {
  // Verify gh CLI is authenticated (replaces GITHUB_TOKEN check)
  await initAuth()

  // Init sync queue worker
  initQueue(broadcastToClients)

  const repos = listRepos()
  console.log(`[server] Starting with ${repos.length} repo(s)`)
  for (const { owner, repo } of repos) {
    await ensureLabels({ owner, repo })
    pollerAdd(`${owner}/${repo}`)
  }
  app.listen(PORT, () => console.log(`[server] http://localhost:${PORT}`))
}

start()
