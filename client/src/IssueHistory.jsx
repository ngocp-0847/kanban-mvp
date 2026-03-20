/**
 * IssueHistory — Version history panel for a GitHub issue.
 *
 * Features:
 *  - Timeline of all edits with editor + timestamp
 *  - Click any version → see unified diff vs previous
 *  - 1-click revert to any past version
 *  - Revert badge to mark auto-reverts
 */
import React, { useState, useEffect } from 'react'
import * as Diff from 'diff'
import { getIssueHistory, revertIssue } from './api'

// ── Diff renderer ─────────────────────────────────────────────────────────────

function DiffLine({ part }) {
  if (part.added) return (
    <div className="diff-line diff-line--add">
      <span className="diff-gutter">+</span>
      <span className="diff-text">{part.value}</span>
    </div>
  )
  if (part.removed) return (
    <div className="diff-line diff-line--remove">
      <span className="diff-gutter">−</span>
      <span className="diff-text">{part.value}</span>
    </div>
  )
  // context lines — show up to 2 lines of context
  const lines = part.value.split('\n').filter((_, i, arr) => i < 2 || i > arr.length - 3)
  return lines.map((line, i) => (
    <div key={i} className="diff-line diff-line--ctx">
      <span className="diff-gutter"> </span>
      <span className="diff-text">{line}</span>
    </div>
  ))
}

function DiffBlock({ label, oldText, newText }) {
  const parts = Diff.diffLines(oldText || '', newText || '')
  const hasChanges = parts.some(p => p.added || p.removed)

  return (
    <div className="diff-block">
      <div className="diff-block__label">{label}</div>
      {hasChanges ? (
        <div className="diff-code">
          {parts.map((part, i) => <DiffLine key={i} part={part} />)}
        </div>
      ) : (
        <div className="diff-unchanged">— unchanged —</div>
      )}
    </div>
  )
}

// ── Timeline entry ────────────────────────────────────────────────────────────

function VersionEntry({ ver, isSelected, isLatest, onClick }) {
  const time = new Date(ver.edited_at).toLocaleString('en', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  return (
    <button
      className={`hist-entry${isSelected ? ' hist-entry--selected' : ''}`}
      onClick={onClick}
    >
      <div className="hist-entry__top">
        <span className="hist-badge">v{ver.version}</span>
        {ver.revert_of && <span className="hist-badge hist-badge--revert">↩ revert</span>}
        {isLatest && <span className="hist-badge hist-badge--current">current</span>}
      </div>
      <div className="hist-entry__who">
        <span className="hist-avatar" style={{ background: stringToHue(ver.edited_by) }}>
          {(ver.edited_by || '?')[0].toUpperCase()}
        </span>
        <span className="hist-login">{ver.edited_by || 'unknown'}</span>
      </div>
      <div className="hist-entry__time">{time}</div>
    </button>
  )
}

function stringToHue(str = '') {
  let h = 0
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h)
  return `hsl(${Math.abs(h) % 360}, 65%, 55%)`
}

// ── Main component ────────────────────────────────────────────────────────────

export default function IssueHistory({ owner, repo, issueId, currentTitle, currentBody, onRevert }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)   // index in history array
  const [reverting, setReverting] = useState(false)
  const [revertError, setRevertError] = useState(null)

  useEffect(() => {
    if (!issueId) return
    setLoading(true)
    getIssueHistory(owner, repo, issueId)
      .then(h => { setHistory(h); setLoading(false) })
      .catch(() => setLoading(false))
  }, [owner, repo, issueId])

  const handleRevert = async (ver) => {
    if (!window.confirm(`Revert to v${ver.version}?\n\nTitle: "${ver.title}"\n\nThis will create a new edit.`)) return
    setReverting(true)
    setRevertError(null)
    try {
      await revertIssue(owner, repo, issueId, ver.version)
      // Refresh history + notify parent
      const h = await getIssueHistory(owner, repo, issueId)
      setHistory(h)
      setSelected(null)
      onRevert?.(ver)
    } catch (err) {
      setRevertError(err.message)
    } finally {
      setReverting(false)
    }
  }

  if (loading) return <div className="hist-loading">Loading history…</div>

  if (!history.length) {
    return (
      <div className="hist-empty">
        <p>No edit history yet.</p>
        <p className="hist-empty__sub">History is captured each time the issue title or body is edited.</p>
      </div>
    )
  }

  // History is sorted newest-first; prev of ver[i] = ver[i+1]
  const selectedVer = selected !== null ? history[selected] : null
  const prevVer = selected !== null ? history[selected + 1] : null

  // "current" is the live issue (not yet snapshotted) shown as comparison for latest ver
  const compareOldTitle = prevVer ? prevVer.title : (selectedVer ? selectedVer.title : '')
  const compareOldBody  = prevVer ? prevVer.body  : (selectedVer ? selectedVer.body  : '')
  const compareNewTitle = selectedVer ? selectedVer.title : currentTitle
  const compareNewBody  = selectedVer ? selectedVer.body  : currentBody

  return (
    <div className="hist-panel">
      <div className="hist-sidebar">
        {/* Current (live) pseudo-entry */}
        <button
          className={`hist-entry${selected === null ? ' hist-entry--selected' : ''} hist-entry--live`}
          onClick={() => setSelected(null)}
        >
          <div className="hist-entry__top">
            <span className="hist-badge hist-badge--live">live</span>
          </div>
          <div className="hist-entry__time">Current version</div>
        </button>

        {history.map((ver, i) => (
          <VersionEntry
            key={ver.id}
            ver={ver}
            isSelected={selected === i}
            isLatest={i === 0}
            onClick={() => setSelected(i)}
          />
        ))}
      </div>

      <div className="hist-detail">
        {selectedVer ? (
          <>
            <div className="hist-detail__header">
              <div>
                <strong>v{selectedVer.version}</strong>
                {selectedVer.revert_of && (
                  <span className="hist-badge hist-badge--revert" style={{ marginLeft: 8 }}>
                    ↩ revert of v{selectedVer.revert_of}
                  </span>
                )}
                <span className="hist-detail__meta">
                  {' '}by <b>{selectedVer.edited_by || 'unknown'}</b>{' '}
                  · {new Date(selectedVer.edited_at).toLocaleString()}
                </span>
              </div>
              <button
                className="btn btn--danger btn--sm hist-revert-btn"
                onClick={() => handleRevert(selectedVer)}
                disabled={reverting}
              >
                {reverting ? '↩ Reverting…' : `↩ Revert to v${selectedVer.version}`}
              </button>
            </div>

            {revertError && (
              <div className="hist-error">⚠ {revertError}</div>
            )}

            <DiffBlock
              label="Title"
              oldText={compareOldTitle}
              newText={compareNewTitle}
            />
            <DiffBlock
              label="Body"
              oldText={compareOldBody}
              newText={compareNewBody}
            />
          </>
        ) : (
          <div className="hist-live-view">
            <div className="hist-detail__header">
              <span className="hist-badge hist-badge--live">live</span>
              <span className="hist-detail__meta"> — current version (not yet snapshotted)</span>
            </div>
            <div className="hist-field">
              <div className="hist-field__label">Title</div>
              <div className="hist-field__val">{currentTitle}</div>
            </div>
            <div className="hist-field">
              <div className="hist-field__label">Body</div>
              <div className="hist-field__val hist-field__val--body">{currentBody || '—'}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
