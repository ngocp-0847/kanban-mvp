import React, { useState } from 'react'
import { Draggable } from '@hello-pangea/dnd'

export default function Card({ issue, index, onClose, onOpenDetail }) {
  const [confirming, setConfirming] = useState(false)

  return (
    <Draggable draggableId={String(issue.id)} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`card ${snapshot.isDragging ? 'card--dragging' : ''}`}
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
          <div className="card__footer">
            {issue.labels?.filter(l => !['kanban:todo','kanban:in-progress','kanban:done'].includes(l)).map(l => (
              <span key={l} className="card__label">{l}</span>
            ))}
            {issue.user && <span className="card__meta">@{issue.user}</span>}
          </div>
        </div>
      )}
    </Draggable>
  )
}
