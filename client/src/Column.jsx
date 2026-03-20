import React, { useState } from 'react'
import { Droppable } from '@hello-pangea/dnd'
import Card from './Card'

export default function Column({ column, issues, onClose, onAddCard, onOpenDetail }) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')

  const handleAdd = (e) => {
    e.preventDefault()
    if (!title.trim()) return
    onAddCard(title.trim())
    setTitle('')
    setAdding(false)
  }

  const COLUMN_LABELS = {
    todo: '📋 Todo',
    'in-progress': '🔄 In Progress',
    done: '✅ Done',
  }

  return (
    <div className="column">
      <div className="column__header">
        <h2>{COLUMN_LABELS[column] || column}</h2>
        <span className="column__count">{issues.length}</span>
      </div>

      <Droppable droppableId={column}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`column__cards ${snapshot.isDraggingOver ? 'column__cards--over' : ''}`}
          >
            {issues.map((issue, index) => (
              <Card
                key={issue.id}
                issue={issue}
                index={index}
                onClose={onClose}
                onOpenDetail={onOpenDetail}
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>

      {column === 'todo' && (
        <div className="column__add">
          {adding ? (
            <form onSubmit={handleAdd} className="add-form">
              <input
                autoFocus
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Issue title..."
                className="add-form__input"
              />
              <div className="add-form__actions">
                <button type="submit" className="btn btn--primary">Add</button>
                <button type="button" onClick={() => setAdding(false)} className="btn">Cancel</button>
              </div>
            </form>
          ) : (
            <button className="add-btn" onClick={() => setAdding(true)}>
              + Add card
            </button>
          )}
        </div>
      )}
    </div>
  )
}
