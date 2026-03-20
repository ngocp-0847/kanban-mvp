import React, { useState } from 'react'
import { Draggable } from '@hello-pangea/dnd'

export default function Card({ issue, index, onClose }) {
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
                onClick={() => setConfirming(true)}
              >
                ×
              </button>
            ) : (
              <div className="card__confirm">
                <button onClick={() => { setConfirming(false); onClose(issue.id) }}>✓ Close</button>
                <button onClick={() => setConfirming(false)}>✗</button>
              </div>
            )}
          </div>
          <div className="card__title">
            <a href={issue.url} target="_blank" rel="noreferrer">{issue.title}</a>
          </div>
          {issue.user && (
            <div className="card__meta">@{issue.user}</div>
          )}
        </div>
      )}
    </Draggable>
  )
}
