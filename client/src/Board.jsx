import React, { useState, useEffect, useCallback, useRef } from 'react'
import { DragDropContext } from '@hello-pangea/dnd'
import Column from './Column'
import IssueDetail from './IssueDetail'
import QueueIndicator from './QueueIndicator'
import {
  getIssues, createIssue, moveIssue, closeIssue, createSubIssue,
  subscribeToEvents,
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

  // Sub-issues: view mode + auto-close toast
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem(`kanban:${repoKey}:viewMode`) || 'flat' }
    catch { return 'flat' }
  })
  const [autoCloseToast, setAutoCloseToast] = useState(null) // { parentNumber, parentTitle }

  const prevIssuesRef = useRef([])

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

  // Auto-close parent detection: when all sub-issues move to done
  useEffect(() => {
    const prev = prevIssuesRef.current
    prevIssuesRef.current = issues

    if (prev.length === 0) return // skip initial load

    for (const issue of issues) {
      if (issue.childrenTotal > 0 && issue.childrenDone === issue.childrenTotal) {
        const prevIssue = prev.find(p => p.number === issue.number)
        if (prevIssue && prevIssue.childrenDone < prevIssue.childrenTotal) {
          // All sub-issues just became done
          setAutoCloseToast({ parentNumber: issue.number, parentTitle: issue.title })
        }
      }
    }
  }, [issues])

  const handleDragEnd = async (result) => {
    const { destination, source, draggableId } = result
    if (!destination) return
    if (destination.droppableId === source.droppableId && destination.index === source.index) return
    const issueId = Number(draggableId)
    const toColumn = destination.droppableId

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
    } catch (err) {
      setError(`Create failed: ${err.message}`)
      setPendingJobs(p => Math.max(0, p - 1))
    }
  }

  const handleCreateSubIssue = async (parentNumber, title) => {
    setPendingJobs(p => p + 1)
    try {
      await createSubIssue(owner, repo, parentNumber, title)
    } catch (err) {
      setError(`Sub-issue failed: ${err.message}`)
      setPendingJobs(p => Math.max(0, p - 1))
    }
  }

  const handleAutoClose = async () => {
    if (!autoCloseToast) return
    await handleClose(autoCloseToast.parentNumber)
    setAutoCloseToast(null)
  }

  const toggleViewMode = () => {
    const next = viewMode === 'flat' ? 'nested' : 'flat'
    setViewMode(next)
    try { localStorage.setItem(`kanban:${repoKey}:viewMode`, next) } catch {}
  }

  // Build issue list per column, respecting view mode
  const issuesByColumn = (column) => {
    const colIssues = issues.filter(i => i.column === column)
    if (viewMode === 'flat') return colIssues

    // Nested view: parents first, then their children (same-column only)
    const parents = colIssues.filter(i => !i.parentNumber)
    const children = colIssues.filter(i => i.parentNumber)
    const ordered = []

    for (const parent of parents) {
      ordered.push(parent)
      // Add children that are in the same column
      const myChildren = children.filter(c => c.parentNumber === parent.number)
      ordered.push(...myChildren)
    }

    // Add orphan children (parent in different column)
    const placedChildIds = new Set(ordered.filter(i => i.parentNumber).map(i => i.id))
    for (const child of children) {
      if (!placedChildIds.has(child.id)) ordered.push(child)
    }

    return ordered
  }

  if (loading) return <div className="board__loading">Loading issues from {owner}/{repo}...</div>

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
        <button
          onClick={toggleViewMode}
          className={`btn btn--sm ${viewMode === 'nested' ? 'btn--primary' : ''}`}
          aria-pressed={viewMode === 'nested'}
          title={viewMode === 'flat' ? 'Switch to nested view' : 'Switch to flat view'}
        >
          {viewMode === 'flat' ? '☰ Flat' : '⊞ Nested'}
        </button>
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
              onCreateSubIssue={handleCreateSubIssue}
              viewMode={viewMode}
            />
          ))}
        </div>
      </DragDropContext>

      <IssueDetail
        owner={owner}
        repo={repo}
        issueId={detailId}
        onClose={() => setDetailId(null)}
        onOpenDetail={setDetailId}
      />

      {/* Auto-close parent toast */}
      {autoCloseToast && (
        <div className="toast" role="alert" aria-live="polite">
          <span>All sub-tasks for #{autoCloseToast.parentNumber} are done.</span>
          <button className="btn btn--primary btn--sm" onClick={handleAutoClose}>Close</button>
          <button className="btn btn--sm" onClick={() => setAutoCloseToast(null)}>×</button>
        </div>
      )}
    </div>
  )
}
