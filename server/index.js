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
  forceRefresh, getRepoState,
} from './poller.js'

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
    const issue = await createIssue({ ...repoParam(req), title, body })
    res.status(201).json(issue)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/repos/:owner/:repo/issues/:id', async (req, res) => {
  try {
    res.json(await fetchIssueDetail({ ...repoParam(req), number: Number(req.params.id) }))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/repos/:owner/:repo/issues/:id/move', async (req, res) => {
  try {
    const { column } = req.body
    if (!column) return res.status(400).json({ error: 'column required' })
    const issue = await moveIssue({ ...repoParam(req), number: Number(req.params.id), toColumn: column })
    forceRefresh(`${req.params.owner}/${req.params.repo}`)
    res.json(issue)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/repos/:owner/:repo/issues/:id/close', async (req, res) => {
  try {
    const issue = await closeIssue({ ...repoParam(req), number: Number(req.params.id) })
    forceRefresh(`${req.params.owner}/${req.params.repo}`)
    res.json(issue)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/repos/:owner/:repo/issues/:id/comments', async (req, res) => {
  try { res.json(await fetchComments({ ...repoParam(req), number: Number(req.params.id) })) }
  catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/repos/:owner/:repo/issues/:id/comments', async (req, res) => {
  try {
    const { body } = req.body
    if (!body) return res.status(400).json({ error: 'body required' })
    res.status(201).json(await postComment({ ...repoParam(req), number: Number(req.params.id), body }))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/repos/:owner/:repo/issues/:id/assignees', async (req, res) => {
  try {
    res.json(await updateAssignees({ ...repoParam(req), number: Number(req.params.id), assignees: req.body.assignees }))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/repos/:owner/:repo/issues/:id/labels', async (req, res) => {
  try {
    res.json(await updateLabels({ ...repoParam(req), number: Number(req.params.id), labels: req.body.labels }))
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

// ── Start ──────────────────────────────────────────────────────────────────────
async function start() {
  if (!process.env.GITHUB_TOKEN) {
    console.error('[server] GITHUB_TOKEN missing in .env (used for polling/label creation)')
    process.exit(1)
  }
  const repos = listRepos()
  console.log(`[server] Starting with ${repos.length} repo(s)`)
  for (const { owner, repo } of repos) {
    await ensureLabels({ owner, repo })
    pollerAdd(`${owner}/${repo}`)
  }
  app.listen(PORT, () => console.log(`[server] http://localhost:${PORT}`))
}

start()
