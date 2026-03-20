import React, { useState } from 'react'

export default function LoginPage({ onLogin }) {
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!token.trim()) return setError('Please enter your GitHub token')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token: token.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Login failed')
      onLogin(data.user)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">🗂</div>
        <h1 className="login-title">Kanban Board</h1>
        <p className="login-sub">Enter your GitHub Personal Access Token to continue</p>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <label htmlFor="token">GitHub Token</label>
            <input
              id="token"
              type="password"
              value={token}
              onChange={e => { setToken(e.target.value); setError('') }}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {error && <div className="login-error">⚠️ {error}</div>}

          <button type="submit" className="btn btn--primary login-btn" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in with GitHub Token'}
          </button>
        </form>

        <div className="login-help">
          <p>
            Need a token?{' '}
            <a
              href="https://github.com/settings/tokens/new?scopes=repo&description=Kanban+Board"
              target="_blank"
              rel="noreferrer"
            >
              Generate one here ↗
            </a>
          </p>
          <p className="login-note">
            Your token is stored securely server-side and never sent to the browser.
            Issues and comments will be created under your GitHub account.
          </p>
        </div>
      </div>
    </div>
  )
}
