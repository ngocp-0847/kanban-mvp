import React, { useEffect, useState } from 'react'

export default function LoginPage({ onLogin }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (data.user) onLogin(data.user)
        else setError('Server not authenticated. Ensure `gh auth login` has been run.')
      })
      .catch(() => setError('Cannot reach server'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">🗂</div>
        <h1 className="login-title">Kanban Board</h1>
        {loading ? (
          <p className="login-sub">Connecting…</p>
        ) : error ? (
          <>
            <div className="login-error">⚠️ {error}</div>
            <div className="login-help">
              <p className="login-note">
                This app uses the <code>gh</code> CLI for authentication.
                Run <code>gh auth login</code> on the server, then restart.
              </p>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
