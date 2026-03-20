import React, { useState, useEffect, useCallback } from 'react'
import { DragDropContext } from '@hello-pangea/dnd'
import Column from './Column'
import { getIssues, createIssue, moveIssue, closeIssue, subscribeToEvents } from './api'

const COLUMNS = ['todo', 'in-progress', 'done']

export default function Board() {
  const [issues, setIssues] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastSync, setLastSync] = useState(null)

  const loadIssues = useCallback(async () => {
    try {
      const data = await getIssues()
      setIssues(data)
      setLastSync(new Date())
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadIssues()
    // Subscribe to SSE for real-time updates
    const unsubscribe = subscribeToEvents((event) => {
      if (event.type === 'sync') {
        setIssues(event.issues)
        setLastSync(new Date())
      }
    })
    return unsubscribe
  }, [loadIssues])

  const handleDragEnd = async (result) => {
    const { destination, source, draggableId } = result
    if (!destination) return
    if (destination.droppableId === source.droppableId && destination.index === source.index) return

    const issueId = Number(draggableId)
    const toColumn = destination.droppableId

    // Optimistic update
    setIssues(prev =>
      prev.map(i => i.id === issueId ? { ...i, column: toColumn } : i)
    )

    try {
      await moveIssue(issueId, toColumn)
    } catch (err) {
      setError(`Move failed: ${err.message}`)
      loadIssues() // rollback
    }
  }

  const handleClose = async (issueId) => {
    // Optimistic remove
    setIssues(prev => prev.filter(i => i.id !== issueId))
    try {
      await closeIssue(issueId)
    } catch (err) {
      setError(`Close failed: ${err.message}`)
      loadIssues()
    }
  }

  const handleAddCard = async (title) => {
    try {
      await createIssue(title)
      // Poller will pick up the new issue, but refresh immediately too
      setTimeout(loadIssues, 1000)
    } catch (err) {
      setError(`Create failed: ${err.message}`)
    }
  }

  const issuesByColumn = (column) =>
    issues.filter(i => i.column === column)

  if (loading) return <div className="board__loading">Loading issues from GitHub...</div>

  return (
    <div className="board">
      {error && (
        <div className="board__error">
          ⚠️ {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}
      <div className="board__meta">
        {lastSync && <span>Last sync: {lastSync.toLocaleTimeString()}</span>}
        <button onClick={loadIssues} className="btn btn--sm">↻ Refresh</button>
      </div>
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="board__columns">
          {COLUMNS.map(col => (
            <Column
              key={col}
              column={col}
              issues={issuesByColumn(col)}
              onClose={handleClose}
              onAddCard={handleAddCard}
            />
          ))}
        </div>
      </DragDropContext>
    </div>
  )
}
