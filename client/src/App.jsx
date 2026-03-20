import React, { useEffect, useState } from 'react'
import Board from './Board'
import RepoSelector from './RepoSelector'
import LoginPage from './LoginPage'
import { getRepos, removeRepo, getMe, logout } from './api'

const ACTIVE_REPO_KEY = 'kanban_active_repo'

export default function App() {
  const [user, setUser] = useState(undefined) // undefined = loading, null = not auth
  const [repos, setRepos] = useState([])
  const [activeRepo, setActiveRepo] = useState(null)
  const [reposLoading, setReposLoading] = useState(true)

  // Check session on mount
  useEffect(() => {
    getMe().then(u => {
      setUser(u)
      if (u) loadRepos()
    })
  }, [])

  async function loadRepos() {
    setReposLoading(true)
    try {
      const list = await getRepos()
      setRepos(list)
      const saved = localStorage.getItem(ACTIVE_REPO_KEY)
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          const found = list.find(r => r.owner === parsed.owner && r.repo === parsed.repo)
          if (found) { setActiveRepo(found); return }
        } catch (_) {}
      }
      if (list.length > 0) setActiveRepo(list[0])
    } finally {
      setReposLoading(false)
    }
  }

  const handleLogin = (u) => {
    setUser(u)
    loadRepos()
  }

  const handleLogout = async () => {
    await logout()
    setUser(null)
    setRepos([])
    setActiveRepo(null)
    localStorage.removeItem(ACTIVE_REPO_KEY)
  }

  const handleSwitch = (repo) => {
    setActiveRepo(repo)
    localStorage.setItem(ACTIVE_REPO_KEY, JSON.stringify(repo))
  }

  const handleAdd = (repo) => {
    setRepos(prev => {
      const next = [...prev.filter(r => !(r.owner === repo.owner && r.repo === repo.repo)), repo]
      return next
    })
    handleSwitch(repo)
  }

  const handleRemove = async (repo) => {
    try {
      await removeRepo(repo.owner, repo.repo)
      const next = repos.filter(r => !(r.owner === repo.owner && r.repo === repo.repo))
      setRepos(next)
      if (activeRepo?.owner === repo.owner && activeRepo?.repo === repo.repo) {
        setActiveRepo(next[0] || null)
      }
    } catch (err) { console.error('Remove failed:', err) }
  }

  // Loading session check
  if (user === undefined) {
    return <div className="app-loading"><div className="spinner" />Checking session…</div>
  }

  // Not authenticated
  if (!user) {
    return <LoginPage onLogin={handleLogin} />
  }

  // Authenticated
  return (
    <div className="app">
      <header className="app__header">
        <h1>🗂 Kanban</h1>
        {activeRepo && (
          <a
            href={`https://github.com/${activeRepo.owner}/${activeRepo.repo}/issues`}
            target="_blank"
            rel="noreferrer"
            className="app__repo-link"
          >
            {activeRepo.owner}/{activeRepo.repo} ↗
          </a>
        )}
        <div className="app__user">
          <img src={user.avatar_url} alt={user.login} className="app__avatar" />
          <span className="app__username">{user.name || user.login}</span>
          <button className="app__logout" onClick={handleLogout} title="Sign out">
            Sign out
          </button>
        </div>
      </header>

      <RepoSelector
        repos={repos}
        activeRepo={activeRepo}
        onSwitch={handleSwitch}
        onAdd={handleAdd}
        onRemove={handleRemove}
      />

      {reposLoading ? (
        <div className="board__loading">Loading…</div>
      ) : !activeRepo ? (
        <div className="board__loading">
          No repos added yet. Click <strong>+ Add repo</strong> to get started.
        </div>
      ) : (
        <Board
          key={`${activeRepo.owner}/${activeRepo.repo}`}
          owner={activeRepo.owner}
          repo={activeRepo.repo}
        />
      )}
    </div>
  )
}
