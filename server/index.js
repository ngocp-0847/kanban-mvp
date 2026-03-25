import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import session from 'express-session'
import helmet from 'helmet'
import { createRequire } from 'module'

// connect-sqlite3 is CommonJS
const require = createRequire(import.meta.url)
const SQLiteStore = require('connect-sqlite3')(session)

import {
  createIssue, moveIssue, closeIssue, ensureLabels,
  fetchIssueDetail, fetchComments, postComment,
  fetchCollaborators, fetchRepoLabels,
  updateAssignees, updateLabels,
  fetchRepoInfo,
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
  getChildrenForParent, getParentForChild,
  upsertRelation, deleteRelation, recalcParentChildrenDone,
  issueHasParent, getGithubId,
} from './db.js'

import {
  listRepos, addRepo as storeAdd, removeRepo as storeRemove,
} from './repos.js'

import { mountAuthRoutes, requireAuth, getUserToken } from './auth.js'

const app = express()
const PORT = process.env.PORT || 3001
const SESSION_SECRET = process.env.SESSION_SECRET || 'kanban-change-this-secret-' + Math.random()

// ── Security ─────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Vite proxy handles this
}))

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  credentials: true,
}))

app.use(express.json())

// ── Sessions (server-side, token never sent to client) ────────────────────────
app.use(session({
  name: 'kanban.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({ db: 'sessions.db', dir: './server' }),
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}))

// ── Auth routes (public) ──────────────────────────────────────────────────────
mountAuthRoutes(app)

// ── All routes below require auth ─────────────────────────────────────────────
app.use('/api', requireAuth)

// ── Helpers ───────────────────────────────────────────────────────────────────
const repoParam = (req) => ({
  owner: req.params.owner,
  repo: req.params.repo,
  token: getUserToken(req),
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
    await fetchRepoInfo({ owner, repo, token: getUserToken(req) })
    const result = storeAdd(owner, repo)
    if (result.exists) return res.status(409).json({ error: 'Repo already added' })
    await ensureLabels({ owner, repo }) // uses POLLER_TOKEN (env)
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
    const token = getUserToken(req)
    const jobId = enqueue(repoKey, 'create', { title, body, _token: token }, req.session.user?.login)
    // Optimistic placeholder shown immediately
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
    const token = getUserToken(req)

    // Optimistic update in DB immediately (board shows change instantly)
    updateIssueColumn(repoKey, number, column)

    // Broadcast optimistic state
    const issues = getIssuesFromDb(repoKey)
    broadcastToClients(repoKey, { type: 'sync', repo: repoKey, issues })

    // Enqueue actual GitHub write
    const jobId = enqueue(repoKey, 'move', { number, column, _token: token }, req.session.user?.login)

    res.json({ queued: true, jobId, number, column })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/repos/:owner/:repo/issues/:id/close', (req, res) => {
  try {
    const repoKey = `${req.params.owner}/${req.params.repo}`
    const number = Number(req.params.id)
    const token = getUserToken(req)

    // Optimistic: remove from cache immediately
    markIssueClosed(repoKey, number)
    const issues = getIssuesFromDb(repoKey)
    broadcastToClients(repoKey, { type: 'sync', repo: repoKey, issues })

    const jobId = enqueue(repoKey, 'close', { number, _token: token }, req.session.user?.login)
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
    const token = getUserToken(req)
    const jobId = enqueue(repoKey, 'comment', { number, body, _token: token }, req.session.user?.login)
    res.status(202).json({ queued: true, jobId })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/repos/:owner/:repo/issues/:id/assignees', (req, res) => {
  try {
    const repoKey = `${req.params.owner}/${req.params.repo}`
    const number = Number(req.params.id)
    const token = getUserToken(req)
    const jobId = enqueue(repoKey, 'assignees', { number, assignees: req.body.assignees, _token: token }, req.session.user?.login)
    res.json({ queued: true, jobId })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/repos/:owner/:repo/issues/:id/labels', (req, res) => {
  try {
    const repoKey = `${req.params.owner}/${req.params.repo}`
    const number = Number(req.params.id)
    const token = getUserToken(req)
    const jobId = enqueue(repoKey, 'labels', { number, labels: req.body.labels, _token: token }, req.session.user?.login)
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

/**
 * PATCH /api/repos/:owner/:repo/issues/:id
 * Body: { title, body }
 * 1. Snapshot current version to history
 * 2. Update cache optimistically
 * 3. Enqueue GitHub write
 */
app.patch('/api/repos/:owner/:repo/issues/:id', (req, res) => {
  try {
    const { title, body } = req.body
    if (!title) return res.status(400).json({ error: 'title required' })

    const repoKey = `${req.params.owner}/${req.params.repo}`
    const number = Number(req.params.id)
    const token = getUserToken(req)
    const userLogin = req.session.user?.login

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
    const jobId = enqueue(repoKey, 'update', { number, title, body, _token: token }, userLogin)

    res.json({ queued: true, jobId, version })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

/**
 * GET /api/repos/:owner/:repo/issues/:id/history
 * Returns version list (newest first), without full body (use /history/:ver for diff)
 */
app.get('/api/repos/:owner/:repo/issues/:id/history', requireAuth, (req, res) => {
  const repoKey = `${req.params.owner}/${req.params.repo}`
  const number = Number(req.params.id)
  const history = getIssueHistory(repoKey, number)
  res.json(history)
})

/**
 * POST /api/repos/:owner/:repo/issues/:id/history/:version/revert
 * Reverts to a specific version (creates new edit, snapshots current first)
 */
app.post('/api/repos/:owner/:repo/issues/:id/history/:version/revert', (req, res) => {
  try {
    const repoKey = `${req.params.owner}/${req.params.repo}`
    const number = Number(req.params.id)
    const targetVersion = Number(req.params.version)
    const token = getUserToken(req)
    const userLogin = req.session.user?.login

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
      number, title: target.title, body: target.body, _token: token,
    }, userLogin)

    res.json({ queued: true, jobId, revertedTo: targetVersion, newVersion })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ── Sub-issues ──────────────────────────────────────────────────────────────────

// GET sub-issues for a parent
app.get('/api/repos/:owner/:repo/issues/:id/sub-issues', (req, res) => {
  const repoKey = `${req.params.owner}/${req.params.repo}`
  const number = Number(req.params.id)
  const children = getChildrenForParent(repoKey, number)
  res.json(children.map(c => ({
    number: c.child_number,
    title: c.title,
    state: c.state,
    column: c.column_name,
    user: c.user_login,
    githubId: c.github_id,
    assignees: JSON.parse(c.assignees || '[]'),
  })))
})

// POST create new issue + link as sub-issue (atomic via queue)
app.post('/api/repos/:owner/:repo/issues/:id/sub-issues', (req, res) => {
  try {
    const { title, body } = req.body
    if (!title) return res.status(400).json({ error: 'title required' })
    const repoKey = `${req.params.owner}/${req.params.repo}`
    const parentNumber = Number(req.params.id)
    const token = getUserToken(req)
    const userLogin = req.session.user?.login

    // Depth check: parent must not itself be a child
    if (issueHasParent(repoKey, parentNumber)) {
      return res.status(422).json({ error: 'Cannot add sub-issues to an issue that is itself a sub-issue (max depth = 1)' })
    }

    const jobId = enqueue(repoKey, 'create-sub-issue', {
      parentNumber, title, body, _token: token,
    }, userLogin)
    res.status(202).json({ queued: true, jobId, parentNumber, title })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// POST link existing issue as sub-issue
app.post('/api/repos/:owner/:repo/issues/:id/sub-issues/link', (req, res) => {
  try {
    const { childNumber } = req.body
    if (!childNumber) return res.status(400).json({ error: 'childNumber required' })
    const repoKey = `${req.params.owner}/${req.params.repo}`
    const parentNumber = Number(req.params.id)
    const childNum = Number(childNumber)
    const token = getUserToken(req)
    const userLogin = req.session.user?.login

    // Depth checks
    if (issueHasParent(repoKey, parentNumber)) {
      return res.status(422).json({ error: 'Parent is itself a sub-issue (max depth = 1)' })
    }
    if (issueHasParent(repoKey, childNum)) {
      return res.status(422).json({ error: 'Issue already has a parent' })
    }

    // Optimistic: insert relation locally
    upsertRelation(repoKey, parentNumber, childNum, 'local')
    recalcParentChildrenDone(repoKey, parentNumber)

    // Broadcast optimistic state
    const issues = getIssuesFromDb(repoKey)
    broadcastToClients(repoKey, { type: 'sync', repo: repoKey, issues })

    const subIssueGithubId = getGithubId(repoKey, childNum)
    const jobId = enqueue(repoKey, 'add-sub-issue', {
      parentNumber, childNumber: childNum, subIssueGithubId, _token: token,
    }, userLogin)
    res.json({ queued: true, jobId, parentNumber, childNumber: childNum })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// DELETE unlink sub-issue
app.delete('/api/repos/:owner/:repo/issues/:id/sub-issues/:childId', (req, res) => {
  try {
    const repoKey = `${req.params.owner}/${req.params.repo}`
    const parentNumber = Number(req.params.id)
    const childNum = Number(req.params.childId)
    const token = getUserToken(req)
    const userLogin = req.session.user?.login

    // Optimistic: remove relation locally
    deleteRelation(repoKey, parentNumber, childNum)
    recalcParentChildrenDone(repoKey, parentNumber)

    const issues = getIssuesFromDb(repoKey)
    broadcastToClients(repoKey, { type: 'sync', repo: repoKey, issues })

    const subIssueGithubId = getGithubId(repoKey, childNum)
    const jobId = enqueue(repoKey, 'remove-sub-issue', {
      parentNumber, childNumber: childNum, subIssueGithubId, _token: token,
    }, userLogin)
    res.json({ queued: true, jobId, parentNumber, childNumber: childNum })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// GET parent issue
app.get('/api/repos/:owner/:repo/issues/:id/parent', (req, res) => {
  const repoKey = `${req.params.owner}/${req.params.repo}`
  const number = Number(req.params.id)
  const parent = getParentForChild(repoKey, number)
  res.json(parent ? { number: parent.parent_number, title: parent.title } : null)
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
  if (!process.env.GITHUB_TOKEN) {
    console.error('[server] GITHUB_TOKEN missing in .env (used for polling/label creation)')
    process.exit(1)
  }

  // Init sync queue worker (passes broadcast fn so it can push SSE on job completion)
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
