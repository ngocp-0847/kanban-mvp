import React, { useEffect, useState } from 'react'
import Board from './Board'
import RepoSelector from './RepoSelector'
import { getRepos, removeRepo } from './api'

const ACTIVE_REPO_KEY = 'kanban_active_repo'

export default function App() {
  const [repos, setRepos] = useState([])
  const [activeRepo, setActiveRepo] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getRepos().then(list => {
      setRepos(list)
      // Restore last active repo from localStorage
      const saved = localStorage.getItem(ACTIVE_REPO_KEY)
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          const found = list.find(r => r.owner === parsed.owner && r.repo === parsed.repo)
          if (found) { setActiveRepo(found); setLoading(false); return }
        } catch (_) {}
      }
      if (list.length > 0) setActiveRepo(list[0])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

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
      setRepos(prev => prev.filter(r => !(r.owner === repo.owner && r.repo === repo.repo)))
      if (activeRepo?.owner === repo.owner && activeRepo?.repo === repo.repo) {
        const remaining = repos.filter(r => !(r.owner === repo.owner && r.repo === repo.repo))
        setActiveRepo(remaining[0] || null)
      }
    } catch (err) {
      console.error('Remove failed:', err)
    }
  }

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
      </header>

      <RepoSelector
        repos={repos}
        activeRepo={activeRepo}
        onSwitch={handleSwitch}
        onAdd={handleAdd}
        onRemove={handleRemove}
      />

      {loading ? (
        <div className="board__loading">Loading…</div>
      ) : !activeRepo ? (
        <div className="board__loading">
          No repos added. Click <strong>+ Add repo</strong> to get started.
        </div>
      ) : (
        <Board key={`${activeRepo.owner}/${activeRepo.repo}`} owner={activeRepo.owner} repo={activeRepo.repo} />
      )}
    </div>
  )
}
