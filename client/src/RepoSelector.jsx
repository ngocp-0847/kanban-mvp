import React, { useState } from 'react'
import { addRepo, removeRepo } from './api'

export default function RepoSelector({ repos, activeRepo, onSwitch, onAdd, onRemove }) {
  const [adding, setAdding] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleAdd = async (e) => {
    e.preventDefault()
    setError('')
    const parts = input.trim().replace('https://github.com/', '').replace(/\/$/, '').split('/')
    if (parts.length < 2) return setError('Format: owner/repo or GitHub URL')
    const [owner, repo] = parts
    setLoading(true)
    try {
      await addRepo(owner, repo)
      onAdd({ owner, repo })
      setInput('')
      setAdding(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="repo-selector">
      {/* Repo tabs */}
      <div className="repo-tabs">
        {repos.map(r => {
          const key = `${r.owner}/${r.repo}`
          const active = activeRepo && `${activeRepo.owner}/${activeRepo.repo}` === key
          return (
            <div key={key} className={`repo-tab${active ? ' repo-tab--active' : ''}`}>
              <button className="repo-tab__name" onClick={() => onSwitch(r)}>
                <span className="repo-tab__owner">{r.owner}/</span>
                <span className="repo-tab__repo">{r.repo}</span>
              </button>
              <button
                className="repo-tab__remove"
                onClick={(e) => { e.stopPropagation(); onRemove(r) }}
                title="Remove repo"
              >×</button>
            </div>
          )
        })}

        {/* Add button */}
        {adding ? (
          <form className="repo-add-form" onSubmit={handleAdd}>
            <input
              autoFocus
              className="repo-add-input"
              placeholder="owner/repo or GitHub URL"
              value={input}
              onChange={e => { setInput(e.target.value); setError('') }}
            />
            <button type="submit" className="btn btn--primary btn--sm" disabled={loading}>
              {loading ? '…' : 'Add'}
            </button>
            <button type="button" className="btn btn--sm" onClick={() => { setAdding(false); setError('') }}>
              Cancel
            </button>
            {error && <span className="repo-add-error">{error}</span>}
          </form>
        ) : (
          <button className="repo-add-btn" onClick={() => setAdding(true)}>
            + Add repo
          </button>
        )}
      </div>
    </div>
  )
}
