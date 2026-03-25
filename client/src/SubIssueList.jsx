import React, { useState, useEffect } from 'react'
import { getSubIssues, createSubIssue, linkSubIssue, unlinkSubIssue, getIssueParent } from './api'

export default function SubIssueList({ owner, repo, issueId, onOpenDetail }) {
  const [subIssues, setSubIssues] = useState([])
  const [parent, setParent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [linking, setLinking] = useState(false)
  const [linkNumber, setLinkNumber] = useState('')
  const [actionError, setActionError] = useState(null)

  useEffect(() => {
    if (!issueId) return
    setLoading(true)
    setError(null)
    Promise.all([
      getSubIssues(owner, repo, issueId),
      getIssueParent(owner, repo, issueId),
    ]).then(([subs, par]) => {
      setSubIssues(subs)
      setParent(par)
      setLoading(false)
    }).catch(err => {
      setError(err.message)
      setLoading(false)
    })
  }, [owner, repo, issueId])

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!newTitle.trim()) return
    setActionError(null)
    try {
      await createSubIssue(owner, repo, issueId, newTitle.trim())
      setNewTitle('')
      setCreating(false)
      // Refresh list
      const subs = await getSubIssues(owner, repo, issueId)
      setSubIssues(subs)
    } catch (err) {
      setActionError(err.message)
    }
  }

  const handleLink = async (e) => {
    e.preventDefault()
    const num = Number(linkNumber)
    if (!num) return
    setActionError(null)
    try {
      await linkSubIssue(owner, repo, issueId, num)
      setLinkNumber('')
      setLinking(false)
      const subs = await getSubIssues(owner, repo, issueId)
      setSubIssues(subs)
    } catch (err) {
      setActionError(err.message)
    }
  }

  const handleUnlink = async (childNumber) => {
    setActionError(null)
    try {
      await unlinkSubIssue(owner, repo, issueId, childNumber)
      setSubIssues(prev => prev.filter(s => s.number !== childNumber))
    } catch (err) {
      setActionError(err.message)
    }
  }

  if (loading) {
    return (
      <div className="sub-issues-tab">
        <div className="sub-issues__skeleton">
          <div className="sub-issues__skeleton-row" />
          <div className="sub-issues__skeleton-row" />
          <div className="sub-issues__skeleton-row" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="sub-issues-tab">
        <div className="sub-issues__error">Could not load sub-issues: {error}</div>
      </div>
    )
  }

  return (
    <div className="sub-issues-tab">
      {/* Parent link */}
      {parent && (
        <div className="sub-issues__parent">
          <span className="sub-issues__parent-label">Parent issue:</span>
          <button
            className="sub-issues__parent-link"
            onClick={() => onOpenDetail && onOpenDetail(parent.number)}
          >
            #{parent.number} {parent.title}
          </button>
        </div>
      )}

      {/* Sub-issue list */}
      {subIssues.length === 0 && !creating && !linking ? (
        <div className="sub-issues__empty">
          <p>No sub-issues yet.</p>
          <div className="sub-issues__empty-actions">
            <button className="btn btn--primary btn--sm" onClick={() => setCreating(true)}>
              + Create new
            </button>
            <button className="btn btn--sm" onClick={() => setLinking(true)}>
              Link existing
            </button>
          </div>
        </div>
      ) : (
        <div className="sub-issues__list">
          {subIssues.map(sub => (
            <div key={sub.number} className="sub-issue-item">
              <span className={`sub-issue-item__state sub-issue-item__state--${sub.column === 'done' ? 'done' : 'open'}`}>
                {sub.column === 'done' ? '✓' : '○'}
              </span>
              <span
                className="sub-issue-item__title"
                onClick={() => onOpenDetail && onOpenDetail(sub.number)}
              >
                #{sub.number} {sub.title}
              </span>
              {sub.user && <span className="sub-issue-item__user">@{sub.user}</span>}
              <button
                className="sub-issue-item__unlink"
                onClick={() => handleUnlink(sub.number)}
                title="Unlink sub-issue"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {actionError && (
        <div className="sub-issues__action-error">{actionError}</div>
      )}

      {/* Action buttons */}
      {subIssues.length > 0 && !creating && !linking && (
        <div className="sub-issues__actions">
          <button className="btn btn--primary btn--sm" onClick={() => setCreating(true)}>
            + Create new
          </button>
          <button className="btn btn--sm" onClick={() => setLinking(true)}>
            Link existing
          </button>
        </div>
      )}

      {/* Create form */}
      {creating && (
        <form onSubmit={handleCreate} className="sub-issues__form">
          <input
            autoFocus
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder="Sub-issue title..."
            className="sub-issues__input"
          />
          <div className="sub-issues__form-actions">
            <button type="submit" className="btn btn--primary btn--sm" disabled={!newTitle.trim()}>
              Create
            </button>
            <button type="button" className="btn btn--sm" onClick={() => { setCreating(false); setActionError(null) }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Link form */}
      {linking && (
        <form onSubmit={handleLink} className="sub-issues__form">
          <input
            autoFocus
            type="number"
            value={linkNumber}
            onChange={e => setLinkNumber(e.target.value)}
            placeholder="Issue number (e.g. 42)"
            className="sub-issues__input"
          />
          <div className="sub-issues__form-actions">
            <button type="submit" className="btn btn--primary btn--sm" disabled={!linkNumber}>
              Link
            </button>
            <button type="button" className="btn btn--sm" onClick={() => { setLinking(false); setActionError(null) }}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
