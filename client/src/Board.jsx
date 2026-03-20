import React, { useState, useEffect, useCallback, useRef } from 'react'
import { DragDropContext } from '@hello-pangea/dnd'
import Column from './Column'
import IssueDetail from './IssueDetail'
import QueueIndicator from './QueueIndicator'
import {
  getIssues, createIssue, moveIssue, closeIssue, subscribeToEvents,
} from './api'

const COLUMNS = ['todo', 'in-progress', 'done']

export default function Board({ owner, repo }) {
  const repoKey = `${owner}/${repo}`
  const [issues, setIssues] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastSync, setLastSync] = useState(null)
  const [detailId, setDetailId] = useState(null)
  const [pendingJobs, setPendingJobs] = useState(0)
  const [lastSyncedOp, setLastSyncedOp] = useState(null)
  const [syncError, setSyncError] = useState(null)
  const syncErrorTimer = useRef(null)

  const loadIssues = useCallback(async () => {
    try {
      const data = await getIssues(owner, repo)
      setIssues(data)
      setLastSync(new Date())
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [owner, repo])

  useEffect(() => {
    setLoading(true)
    loadIssues()
    const unsubscribe = subscribeToEvents((event) => {
      if (event.repo !== repoKey) return

      if (event.type === 'sync') {
        setIssues(event.issues)
        setLastSync(new Date())
        setLoading(false)
      }
      if (event.type === 'error') {
        setError(event.message)
      }
      if (event.type === 'queue_update') {
        const { job } = event
        if (job.status === 'done') {
          setPendingJobs(p => Math.max(0, p - 1))
          setLastSyncedOp(job.operation)
          setSyncError(null)
          // Auto-clear "Synced" after 3s
          setTimeout(() => setLastSyncedOp(null), 3000)
        }
      }
      if (event.type === 'queue_error') {
        setPendingJobs(p => Math.max(0, p - 1))
        setSyncError(event.job.error)
        clearTimeout(syncErrorTimer.current)
        syncErrorTimer.current = setTimeout(() => setSyncError(null), 8000)
      }
    })
    return unsubscribe
  }, [owner, repo, loadIssues, repoKey])

  const handleDragEnd = async (result) => {
    const { destination, source, draggableId } = result
    if (!destination) return
    if (destination.droppableId === source.droppableId && destination.index === source.index) return
    const issueId = Number(draggableId)
    const toColumn = destination.droppableId

    // Optimistic UI update
    setIssues(prev => prev.map(i => i.id === issueId ? { ...i, column: toColumn } : i))
    setPendingJobs(p => p + 1)

    try {
      await moveIssue(owner, repo, issueId, toColumn)
    } catch (err) {
      setError(`Move failed: ${err.message}`)
      setPendingJobs(p => Math.max(0, p - 1))
      loadIssues()
    }
  }

  const handleClose = async (issueId) => {
    setIssues(prev => prev.filter(i => i.id !== issueId))
    setPendingJobs(p => p + 1)
    try {
      await closeIssue(owner, repo, issueId)
    } catch (err) {
      setError(`Close failed: ${err.message}`)
      setPendingJobs(p => Math.max(0, p - 1))
      loadIssues()
    }
  }

  const handleAddCard = async (title) => {
    setPendingJobs(p => p + 1)
    try {
      await createIssue(owner, repo, title)
      // Board will update via SSE when queue processes the create job
    } catch (err) {
      setError(`Create failed: ${err.message}`)
      setPendingJobs(p => Math.max(0, p - 1))
    }
  }

  const issuesByColumn = (column) => issues.filter(i => i.column === column)

  if (loading) return <div className="board__loading">Loading issues from {owner}/{repo}…</div>

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
        <QueueIndicator pending={pendingJobs} lastError={syncError} lastOp={lastSyncedOp} />
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
              onOpenDetail={setDetailId}
            />
          ))}
        </div>
      </DragDropContext>

      <IssueDetail
        owner={owner}
        repo={repo}
        issueId={detailId}
        onClose={() => setDetailId(null)}
      />
    </div>
  )
}
