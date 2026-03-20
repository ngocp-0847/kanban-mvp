/**
 * auth.js — Session-based authentication using GitHub Personal Access Token.
 *
 * Flow:
 *   POST /api/auth/login  { token }
 *     → validate token via GET /user on GitHub API
 *     → store { token, user } in server-side session
 *     → return user info (no token sent to client)
 *
 *   GET  /api/auth/me     → return session user or 401
 *   POST /api/auth/logout → destroy session
 *
 * The token lives ONLY in the server-side session (httpOnly cookie).
 * Client JS never sees the raw token.
 */

import fetch from 'node-fetch'

export async function validateToken(token) {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  })
  if (!res.ok) throw new Error(`GitHub rejected token: ${res.status}`)
  return res.json() // returns GitHub user object
}

// Express middleware — rejects unauthenticated requests
export function requireAuth(req, res, next) {
  if (req.session?.user) return next()
  res.status(401).json({ error: 'Not authenticated' })
}

// Get the per-user token from session (for GitHub API calls)
export function getUserToken(req) {
  return req.session?.token
}

// Mount auth routes on the app
export function mountAuthRoutes(app) {
  // Login — validate token + create session
  app.post('/api/auth/login', async (req, res) => {
    const { token } = req.body
    if (!token) return res.status(400).json({ error: 'token required' })
    try {
      const user = await validateToken(token)
      req.session.token = token
      req.session.user = {
        login: user.login,
        name: user.name,
        avatar_url: user.avatar_url,
        email: user.email,
        html_url: user.html_url,
      }
      res.json({ user: req.session.user })
    } catch (err) {
      res.status(401).json({ error: err.message })
    }
  })

  // Get current user
  app.get('/api/auth/me', (req, res) => {
    if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' })
    res.json({ user: req.session.user })
  })

  // Logout
  app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('kanban.sid')
      res.json({ ok: true })
    })
  })
}
