/**
 * auth.js — Authentication via gh CLI.
 *
 * The server uses the machine-level `gh auth login` credential.
 * No per-user tokens needed — single-user model.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

let _ghUser = null

export async function initAuth() {
  // Verify gh is authenticated
  try {
    await execFileAsync('gh', ['auth', 'status'])
  } catch (err) {
    console.error('[auth] gh CLI is not authenticated. Run: gh auth login')
    process.exit(1)
  }

  // Cache the authenticated user
  const { stdout } = await execFileAsync('gh', ['api', '/user'])
  _ghUser = JSON.parse(stdout)
  console.log(`[auth] Authenticated as ${_ghUser.login}`)
  return _ghUser
}

export function getGhUser() {
  return _ghUser
}

// Simplified middleware — just check server is authenticated
export function requireAuth(req, res, next) {
  if (!_ghUser) return res.status(503).json({ error: 'Server not authenticated' })
  next()
}

// Mount auth routes
export function mountAuthRoutes(app) {
  app.get('/api/auth/me', (req, res) => {
    if (!_ghUser) return res.status(401).json({ error: 'Not authenticated' })
    res.json({
      user: {
        login: _ghUser.login,
        name: _ghUser.name,
        avatar_url: _ghUser.avatar_url,
        email: _ghUser.email,
        html_url: _ghUser.html_url,
      }
    })
  })

  app.post('/api/auth/login', (req, res) => {
    if (!_ghUser) return res.status(503).json({ error: 'gh not authenticated' })
    res.json({
      user: {
        login: _ghUser.login,
        name: _ghUser.name,
        avatar_url: _ghUser.avatar_url,
        email: _ghUser.email,
        html_url: _ghUser.html_url,
      }
    })
  })

  app.post('/api/auth/logout', (req, res) => {
    res.json({ ok: true })
  })
}
