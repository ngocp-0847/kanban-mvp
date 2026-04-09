import React from 'react'
import { ViewMode } from 'gantt-task-react'

const VIEW_MODES = [
  { label: 'Day', value: ViewMode.Day },
  { label: 'Week', value: ViewMode.Week },
  { label: 'Month', value: ViewMode.Month },
]

const STATUS_COLORS = {
  'New': '#94a3b8',
  'In Progress': '#3b82f6',
  'In Review': '#8b5cf6',
  'QA Testing': '#f59e0b',
  'Closed': '#22c55e',
}

export default function GanttToolbar({
  iterations,
  selectedSprint,
  onSprintChange,
  viewMode,
  onViewModeChange,
  onRefresh,
  loading,
}) {
  const activeIterations = (iterations || []).filter(it => !it.completed)

  return (
    <div className="gantt-toolbar">
      <div className="gantt-toolbar__left">
        <select
          className="gantt-toolbar__select"
          value={selectedSprint || ''}
          onChange={e => onSprintChange(e.target.value || null)}
        >
          <option value="">All Sprints</option>
          {activeIterations.map(it => (
            <option key={it.id} value={it.title}>{it.title}</option>
          ))}
        </select>

        <div className="gantt-toolbar__zoom">
          {VIEW_MODES.map(vm => (
            <button
              key={vm.label}
              className={`gantt-toolbar__zoom-btn ${viewMode === vm.value ? 'gantt-toolbar__zoom-btn--active' : ''}`}
              onClick={() => onViewModeChange(vm.value)}
            >
              {vm.label}
            </button>
          ))}
        </div>
      </div>

      <div className="gantt-toolbar__right">
        <div className="gantt-toolbar__legend">
          {Object.entries(STATUS_COLORS).map(([status, color]) => (
            <span key={status} className="gantt-toolbar__legend-item">
              <span className="gantt-toolbar__legend-dot" style={{ background: color }} />
              {status}
            </span>
          ))}
        </div>

        <button
          className="gantt-toolbar__refresh"
          onClick={onRefresh}
          disabled={loading}
          title="Refresh from GitHub"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
    </div>
  )
}
