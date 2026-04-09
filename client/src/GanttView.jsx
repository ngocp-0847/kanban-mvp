import React, { useEffect, useState } from 'react'
import { ViewMode } from 'gantt-task-react'
import GanttToolbar from './GanttToolbar'
import GanttChart from './GanttChart'
import { getGanttData, refreshGanttData } from './api'
import './gantt.css'

export default function GanttView({ org, projectNumber }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [viewMode, setViewMode] = useState(ViewMode.Week)
  const [selectedSprint, setSelectedSprint] = useState(null)

  useEffect(() => {
    loadData()
  }, [org, projectNumber])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const result = await getGanttData(org, projectNumber)
      setData(result)
      // Auto-select first active sprint on initial load
      if (!selectedSprint && result?.iterations) {
        const active = result.iterations.find(it => !it.completed)
        if (active) setSelectedSprint(active.title)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleRefresh() {
    setLoading(true)
    setError(null)
    try {
      await refreshGanttData(org, projectNumber)
      const result = await getGanttData(org, projectNumber)
      setData(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (loading && !data) {
    return <div className="gantt-view__loading"><div className="spinner" />Loading Gantt chart...</div>
  }

  if (error && !data) {
    return (
      <div className="gantt-view__error">
        <p>Failed to load Gantt data: {error}</p>
        <button onClick={loadData}>Retry</button>
      </div>
    )
  }

  return (
    <div className="gantt-view">
      <div className="gantt-view__header">
        <h2>{data?.project?.title || 'Project'}</h2>
        <span className="gantt-view__meta">
          {data?.flatItems?.length || 0} items
        </span>
      </div>

      <GanttToolbar
        iterations={data?.iterations}
        selectedSprint={selectedSprint}
        onSprintChange={setSelectedSprint}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onRefresh={handleRefresh}
        loading={loading}
      />

      {error && (
        <div className="gantt-view__error-bar">
          Refresh failed: {error}
          <button onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      <GanttChart
        tree={data?.tree}
        viewMode={viewMode}
        selectedSprint={selectedSprint}
      />
    </div>
  )
}
