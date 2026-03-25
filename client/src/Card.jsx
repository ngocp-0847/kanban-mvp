import React, { useState } from 'react'
import { Draggable } from '@hello-pangea/dnd'

export default function Card({ issue, index, onClose, onOpenDetail, onCreateSubIssue, isChild }) {
  const [confirming, setConfirming] = useState(false)
  const [addingSub, setAddingSub] = useState(false)
  const [subTitle, setSubTitle] = useState('')

  const hasChildren = issue.childrenTotal > 0
  const hasParent = !!issue.parentNumber
  const progressPct = hasChildren && issue.childrenTotal > 0
    ? (issue.childrenDone / issue.childrenTotal) * 100
    : 0
  const allDone = hasChildren && issue.childrenDone === issue.childrenTotal

  const handleSubCreate = (e) => {
    e.preventDefault()
    if (!subTitle.trim() || !onCreateSubIssue) return
    onCreateSubIssue(issue.number, subTitle.trim())
    setSubTitle('')
    setAddingSub(false)
  }

  return (
    <Draggable draggableId={String(issue.id)} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`card ${snapshot.isDragging ? 'card--dragging' : ''} ${isChild ? 'card--child' : ''}`}
        >
          <div className="card__header">
            <span className="card__number">#{issue.number}</span>
            {!confirming ? (
              <button
                className="card__close-btn"
                title="Close issue"
                onClick={(e) => { e.stopPropagation(); setConfirming(true) }}
              >
                ×
              </button>
            ) : (
              <div className="card__confirm">
                <button onClick={(e) => { e.stopPropagation(); setConfirming(false); onClose(issue.id) }}>✓ Close</button>
                <button onClick={(e) => { e.stopPropagation(); setConfirming(false) }}>✗</button>
              </div>
            )}
          </div>
          <div className="card__title" onClick={() => onOpenDetail && onOpenDetail(issue.id)}>
            {issue.title}
          </div>

          {/* Progress bar — below title, above labels */}
          {hasChildren && (
            <div className="card__progress-wrap">
              <div className="card__progress" role="progressbar"
                aria-valuenow={issue.childrenDone} aria-valuemax={issue.childrenTotal}
                aria-label={`${issue.childrenDone} of ${issue.childrenTotal} sub-tasks done`}>
                <div
                  className={`card__progress-fill ${allDone ? 'card__progress-fill--complete' : ''}`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span className="card__progress-text">
                {issue.childrenDone}/{issue.childrenTotal}
              </span>
            </div>
          )}

          {/* Parent breadcrumb */}
          {hasParent && (
            <div className="card__parent" onClick={(e) => {
              e.stopPropagation()
              onOpenDetail && onOpenDetail(issue.parentNumber)
            }}>
              ↑ Parent #{issue.parentNumber}
            </div>
          )}

          <div className="card__footer">
            {issue.labels?.filter(l => !['kanban:todo','kanban:in-progress','kanban:done'].includes(l)).map(l => (
              <span key={l} className="card__label">{l}</span>
            ))}
            {issue.user && <span className="card__meta">@{issue.user}</span>}
          </div>

          {/* "+" add sub-issue button — hidden on sub-issue cards (depth limit) */}
          {!hasParent && onCreateSubIssue && (
            <div className={`card__add-sub-wrap ${hasChildren ? 'card__add-sub-wrap--visible' : ''}`}>
              {!addingSub ? (
                <button
                  className="card__add-sub"
                  onClick={(e) => { e.stopPropagation(); setAddingSub(true) }}
                  aria-label={`Add sub-issue to #${issue.number}`}
                >
                  + Sub-issue
                </button>
              ) : (
                <form onSubmit={handleSubCreate} className="card__add-sub-form" onClick={e => e.stopPropagation()}>
                  <input
                    autoFocus
                    value={subTitle}
                    onChange={e => setSubTitle(e.target.value)}
                    placeholder="Sub-issue title..."
                    className="card__add-sub-input"
                    onBlur={() => { if (!subTitle.trim()) setAddingSub(false) }}
                    onKeyDown={e => { if (e.key === 'Escape') setAddingSub(false) }}
                  />
                </form>
              )}
            </div>
          )}
        </div>
      )}
    </Draggable>
  )
}
