import React, { useMemo } from 'react'
import { Gantt } from 'gantt-task-react'
import 'gantt-task-react/dist/index.css'

const STATUS_COLORS = {
  'New': { bar: '#94a3b8', progress: '#64748b' },
  'Issued Task': { bar: '#94a3b8', progress: '#64748b' },
  'Investigated & Estimated': { bar: '#94a3b8', progress: '#64748b' },
  'Planning': { bar: '#94a3b8', progress: '#64748b' },
  'In Progress': { bar: '#93c5fd', progress: '#3b82f6' },
  'In Review': { bar: '#c4b5fd', progress: '#8b5cf6' },
  'QA Testing': { bar: '#fde68a', progress: '#f59e0b' },
  'UAT In Progress': { bar: '#fde68a', progress: '#f59e0b' },
  'Ready for Delivery': { bar: '#bbf7d0', progress: '#22c55e' },
  'Closed': { bar: '#86efac', progress: '#22c55e' },
}

const DEFAULT_COLOR = { bar: '#cbd5e1', progress: '#94a3b8' }
const SPRINT_COLOR = { bar: '#e2e8f0', progress: '#64748b' }

function getTaskColor(node) {
  if (node.category === 'sprint') return SPRINT_COLOR
  return STATUS_COLORS[node.status] || DEFAULT_COLOR
}

function toDate(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T00:00:00')
  return isNaN(d.getTime()) ? null : d
}

/**
 * Flatten the tree into gantt-task-react Task[] format.
 * Only includes nodes that have valid start/end dates.
 */
function flattenTree(tree, selectedSprint) {
  const tasks = []

  for (const sprint of tree) {
    if (selectedSprint && sprint.name !== selectedSprint && sprint.name !== 'Unscheduled') continue

    const sprintStart = toDate(sprint.start)
    const sprintEnd = toDate(sprint.end)

    // Calculate sprint date range from children if no dates
    const { minDate, maxDate } = getDateRange(sprint.children, sprintStart, sprintEnd)

    if (!minDate || !maxDate) continue // skip sprints with no dates at all

    tasks.push({
      id: sprint.id,
      name: sprint.name,
      start: minDate,
      end: maxDate,
      progress: sprint.progress || 0,
      type: 'project',
      hideChildren: false,
      styles: {
        backgroundColor: SPRINT_COLOR.bar,
        progressColor: SPRINT_COLOR.progress,
        backgroundSelectedColor: SPRINT_COLOR.bar,
        progressSelectedColor: SPRINT_COLOR.progress,
      },
      // store original data for click handler
      _data: sprint,
    })

    flattenChildren(sprint.children, sprint.id, minDate, maxDate, tasks)
  }

  return tasks
}

function flattenChildren(children, parentId, fallbackStart, fallbackEnd, tasks) {
  for (const node of children) {
    const start = toDate(node.start) || fallbackStart
    const end = toDate(node.end) || fallbackEnd
    if (!start || !end) continue

    // Ensure end >= start
    const safeEnd = end < start ? start : end

    const isGroup = node.children && node.children.length > 0
    const color = getTaskColor(node)

    const taskType = (node.category === 'story' || node.category === 'feature') && isGroup
      ? 'project' : 'task'

    tasks.push({
      id: node.id,
      name: formatName(node),
      start,
      end: safeEnd,
      progress: node.progress || 0,
      type: taskType,
      project: parentId,
      hideChildren: false,
      styles: {
        backgroundColor: color.bar,
        progressColor: color.progress,
        backgroundSelectedColor: color.bar,
        progressSelectedColor: color.progress,
      },
      _data: node,
    })

    if (isGroup) {
      flattenChildren(node.children, node.id, start, safeEnd, tasks)
    }
  }
}

function formatName(node) {
  // Shorten the title by removing type prefixes
  let name = node.name || ''
  name = name.replace(/^\[(STORY|story|Feature|feature|DEV FEATURE|DEV TASK|Task|task|devtask|TEST DESIGN|QA BUG|Bug)\]\s*/i, '')
  // Trim to reasonable length
  if (name.length > 60) name = name.slice(0, 57) + '...'
  return name
}

function getDateRange(children, defaultMin, defaultMax) {
  let minDate = defaultMin
  let maxDate = defaultMax

  for (const child of (children || [])) {
    const s = toDate(child.start)
    const e = toDate(child.end)
    if (s && (!minDate || s < minDate)) minDate = s
    if (e && (!maxDate || e > maxDate)) maxDate = e

    // Recurse into grandchildren
    const nested = getDateRange(child.children, null, null)
    if (nested.minDate && (!minDate || nested.minDate < minDate)) minDate = nested.minDate
    if (nested.maxDate && (!maxDate || nested.maxDate > maxDate)) maxDate = nested.maxDate
  }

  return { minDate, maxDate }
}

export default function GanttChart({ tree, viewMode, selectedSprint, onTaskClick }) {
  const tasks = useMemo(
    () => flattenTree(tree || [], selectedSprint),
    [tree, selectedSprint]
  )

  if (tasks.length === 0) {
    return (
      <div className="gantt-chart__empty">
        No tasks with dates found{selectedSprint ? ` in ${selectedSprint}` : ''}.
      </div>
    )
  }

  return (
    <div className="gantt-chart">
      <Gantt
        tasks={tasks}
        viewMode={viewMode}
        listCellWidth="320px"
        columnWidth={viewMode === 'Day' ? 60 : viewMode === 'Week' ? 150 : 300}
        rowHeight={36}
        barCornerRadius={4}
        fontSize="12"
        todayColor="rgba(59, 130, 246, 0.1)"
        onClick={task => {
          if (task._data?.url) {
            window.open(task._data.url, '_blank')
          }
          onTaskClick?.(task._data)
        }}
        TooltipContent={({ task }) => <TaskTooltip task={task} />}
      />
    </div>
  )
}

function TaskTooltip({ task }) {
  const data = task._data || {}
  return (
    <div className="gantt-tooltip">
      <div className="gantt-tooltip__title">{data.name || task.name}</div>
      {data.repo && <div className="gantt-tooltip__repo">{data.repo}#{data.number}</div>}
      {data.status && <div className="gantt-tooltip__status">Status: {data.status}</div>}
      <div className="gantt-tooltip__dates">
        {task.start.toLocaleDateString()} — {task.end.toLocaleDateString()}
      </div>
      <div className="gantt-tooltip__progress">Progress: {Math.round(task.progress)}%</div>
      {data.assignees?.length > 0 && (
        <div className="gantt-tooltip__assignees">
          Assignees: {data.assignees.map(a => a.login).join(', ')}
        </div>
      )}
    </div>
  )
}
