/**
 * gantt.js — GitHub Projects v2 GraphQL client + Gantt tree builder.
 *
 * Fetches project items with custom fields (Status, Sprint, Start/Due Date)
 * and builds a hierarchical tree: Sprint → Story → Feature → Task.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { getDb } from './db.js'

const execFileAsync = promisify(execFile)

// ── GraphQL helpers ──────────────────────────────────────────────────────────

async function execGraphQL(query, variables = {}) {
  const args = ['api', 'graphql', '-f', `query=${query}`]
  for (const [key, val] of Object.entries(variables)) {
    if (val === null || val === undefined) continue
    // -F for non-string types (numbers, booleans), -f for strings
    const flag = typeof val === 'number' || typeof val === 'boolean' ? '-F' : '-f'
    args.push(flag, `${key}=${val}`)
  }
  try {
    const { stdout } = await execFileAsync('gh', args, {
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    })
    const result = JSON.parse(stdout)
    if (result.errors) {
      throw new Error(result.errors.map(e => e.message).join('; '))
    }
    return result.data
  } catch (err) {
    const msg = err.stderr?.trim() || err.message
    throw new Error(`graphql: ${msg}`)
  }
}

// ── Queries ──────────────────────────────────────────────────────────────────

const META_QUERY = `
query($org: String!, $num: Int!) {
  organization(login: $org) {
    projectV2(number: $num) {
      id
      title
      fields(first: 30) {
        nodes {
          ... on ProjectV2Field { id name dataType }
          ... on ProjectV2SingleSelectField {
            id name dataType
            options { id name }
          }
          ... on ProjectV2IterationField {
            id name dataType
            configuration {
              iterations { id title startDate duration }
              completedIterations { id title startDate duration }
            }
          }
        }
      }
    }
  }
}
`

const ITEMS_QUERY = `
query($org: String!, $num: Int!, $cursor: String) {
  organization(login: $org) {
    projectV2(number: $num) {
      items(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        totalCount
        nodes {
          id
          type
          content {
            ... on Issue {
              number
              title
              state
              url
              repository { nameWithOwner }
              assignees(first: 5) {
                nodes { login avatarUrl }
              }
              parent {
                number
                title
                repository { nameWithOwner }
              }
            }
            ... on DraftIssue { title }
          }
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldTextValue {
                text
                field { ... on ProjectV2Field { name } }
              }
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field { ... on ProjectV2SingleSelectField { name } }
              }
              ... on ProjectV2ItemFieldIterationValue {
                title startDate duration
                field { ... on ProjectV2IterationField { name } }
              }
              ... on ProjectV2ItemFieldDateValue {
                date
                field { ... on ProjectV2Field { name } }
              }
              ... on ProjectV2ItemFieldNumberValue {
                number
                field { ... on ProjectV2Field { name } }
              }
            }
          }
        }
      }
    }
  }
}
`

// ── Fetch project metadata ──────────────────────────────────────────────────

export async function fetchProjectMeta(org, projectNumber) {
  const data = await execGraphQL(META_QUERY, { org, num: projectNumber })
  const project = data.organization.projectV2
  const meta = { id: project.id, title: project.title, iterations: [], statusOptions: [] }

  for (const field of project.fields.nodes) {
    if (field.name === 'Status' && field.options) {
      meta.statusOptions = field.options
    }
    if (field.name === 'Target version' && field.configuration) {
      const cfg = field.configuration
      meta.iterations = [
        ...cfg.iterations.map(it => ({
          ...it,
          endDate: addDays(it.startDate, it.duration),
          completed: false,
        })),
        ...cfg.completedIterations.map(it => ({
          ...it,
          endDate: addDays(it.startDate, it.duration),
          completed: true,
        })),
      ]
    }
  }
  return meta
}

// ── Fetch all project items (paginated) ─────────────────────────────────────

export async function fetchAllProjectItems(org, projectNumber) {
  const allItems = []
  let cursor = null
  const seen = new Set()

  for (let page = 0; page < 10; page++) {
    const vars = { org, num: projectNumber }
    if (cursor) vars.cursor = cursor
    const data = await execGraphQL(ITEMS_QUERY, vars)
    const itemsData = data.organization.projectV2.items
    for (const node of itemsData.nodes) {
      if (!seen.has(node.id)) {
        seen.add(node.id)
        allItems.push(node)
      }
    }
    if (!itemsData.pageInfo.hasNextPage) break
    cursor = itemsData.pageInfo.endCursor
  }

  return allItems.map(normalizeItem).filter(Boolean)
}

// ── Normalize a single project item ─────────────────────────────────────────

function normalizeItem(node) {
  const content = node.content || {}
  if (!content.number && !content.title) return null // skip empty

  const fields = {}
  for (const fv of (node.fieldValues?.nodes || [])) {
    if (!fv.field) continue
    const name = fv.field.name
    if (name === 'Status') fields.status = fv.name
    else if (name === 'Target version') {
      fields.sprint = fv.title
      fields.sprintStart = fv.startDate
      fields.sprintDuration = fv.duration
    }
    else if (name === 'Start Date') fields.startDate = fv.date
    else if (name === 'Due Date') fields.dueDate = fv.date
    else if (name === 'Priority') fields.priority = fv.name
    else if (name === 'Estimated time') fields.estimatedTime = fv.number
    else if (name === 'Spent time') fields.spentTime = fv.number
  }

  const repo = content.repository?.nameWithOwner || null
  const number = content.number || null
  const key = repo && number ? `${repo}#${number}` : `draft-${node.id}`

  return {
    key,
    projectItemId: node.id,
    type: node.type, // ISSUE or DRAFT_ISSUE
    repo,
    number,
    title: content.title || '(untitled)',
    state: content.state || null,
    url: content.url || null,
    assignees: content.assignees?.nodes || [],
    parentKey: content.parent
      ? `${content.parent.repository.nameWithOwner}#${content.parent.number}`
      : null,
    ...fields,
  }
}

// ── Infer item category from title ──────────────────────────────────────────

function inferCategory(title) {
  const t = title.toLowerCase()
  if (/^\[story\]/.test(t)) return 'story'
  if (/^\[test design\]/.test(t)) return 'task'
  if (/^\[qa bug\]/.test(t) || /^\[bug\]/.test(t)) return 'task'
  if (/^\[(dev )?feature\]/.test(t) || /^\[feature\]/.test(t)) return 'feature'
  if (/^\[(dev )?task\]/.test(t) || /^\[task\]/.test(t) || /^\[devtask\]/.test(t)) return 'task'
  return null
}

// ── Status → progress mapping ───────────────────────────────────────────────

const STATUS_PROGRESS = {
  'New': 0,
  'Issued Task': 0,
  'Investigated & Estimated': 0,
  'Planning': 0,
  'In Progress': 30,
  'In Review': 60,
  'QA Testing': 75,
  'UAT In Progress': 85,
  'Ready for Delivery': 95,
  'Closed': 100,
}

function statusToProgress(status) {
  return STATUS_PROGRESS[status] ?? 0
}

// ── Build Gantt tree ────────────────────────────────────────────────────────

export function buildGanttTree(items, meta) {
  // Index items by key
  const byKey = new Map()
  for (const item of items) {
    byKey.set(item.key, { ...item, children: [] })
  }

  // Build parent-child relationships
  const roots = []
  for (const item of byKey.values()) {
    if (item.parentKey && byKey.has(item.parentKey)) {
      byKey.get(item.parentKey).children.push(item)
    } else if (!item.parentKey) {
      roots.push(item)
    } else {
      // Parent not in project — treat as root
      roots.push(item)
    }
  }

  // Assign categories
  for (const item of byKey.values()) {
    const inferred = inferCategory(item.title)
    if (inferred) {
      item.category = inferred
    } else if (item.children.length > 0) {
      item.category = 'feature'
    } else {
      item.category = 'task'
    }
  }

  // Group roots by sprint
  const sprintMap = new Map()
  const unscheduled = []

  for (const item of roots) {
    const sprintName = item.sprint || findSprintInChildren(item)
    if (sprintName) {
      if (!sprintMap.has(sprintName)) sprintMap.set(sprintName, [])
      sprintMap.get(sprintName).push(item)
    } else {
      unscheduled.push(item)
    }
  }

  // Build sprint nodes using iteration metadata
  const iterationMap = new Map()
  for (const it of meta.iterations) {
    iterationMap.set(it.title, it)
  }

  const tree = []

  // Sort iterations: active first (by startDate), then completed
  const sortedSprints = [...sprintMap.keys()].sort((a, b) => {
    const ia = iterationMap.get(a)
    const ib = iterationMap.get(b)
    if (!ia) return 1
    if (!ib) return -1
    return ia.startDate.localeCompare(ib.startDate)
  })

  for (const sprintName of sortedSprints) {
    const iteration = iterationMap.get(sprintName)
    const children = sprintMap.get(sprintName)

    tree.push({
      id: `sprint-${iteration?.id || sprintName}`,
      name: sprintName,
      category: 'sprint',
      start: iteration?.startDate || null,
      end: iteration?.endDate || null,
      duration: iteration?.duration || null,
      progress: calcGroupProgress(children),
      children: children.map(item => buildNode(item, iteration)),
    })
  }

  if (unscheduled.length > 0) {
    tree.push({
      id: 'sprint-unscheduled',
      name: 'Unscheduled',
      category: 'sprint',
      start: null,
      end: null,
      duration: null,
      progress: calcGroupProgress(unscheduled),
      children: unscheduled.map(item => buildNode(item, null)),
    })
  }

  return tree
}

function buildNode(item, iteration) {
  // Inherit dates: item dates → sprint dates
  const start = item.startDate || item.sprintStart || iteration?.startDate || null
  const end = item.dueDate || (item.sprintStart && item.sprintDuration
    ? addDays(item.sprintStart, item.sprintDuration) : null) || iteration?.endDate || null

  const children = item.children.map(child => buildNode(child, iteration))
  const progress = children.length > 0
    ? calcGroupProgress(item.children)
    : statusToProgress(item.status)

  return {
    id: item.key,
    name: item.title,
    category: item.category,
    repo: item.repo,
    number: item.number,
    url: item.url,
    status: item.status || null,
    priority: item.priority || null,
    assignees: item.assignees,
    start,
    end,
    progress,
    estimatedTime: item.estimatedTime || null,
    spentTime: item.spentTime || null,
    children,
  }
}

function findSprintInChildren(item) {
  if (item.sprint) return item.sprint
  for (const child of (item.children || [])) {
    const found = findSprintInChildren(child)
    if (found) return found
  }
  return null
}

function calcGroupProgress(items) {
  if (!items || items.length === 0) return 0
  const total = items.reduce((sum, item) => {
    const p = item.children?.length > 0
      ? calcGroupProgress(item.children)
      : statusToProgress(item.status)
    return sum + p
  }, 0)
  return Math.round(total / items.length)
}

// ── Cache ───────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export function getCachedGantt(projectKey) {
  const db = getDb()
  const row = db.prepare(`
    SELECT * FROM gantt_project_cache WHERE project_key = ?
  `).get(projectKey)
  if (!row) return null
  const age = Date.now() - new Date(row.fetched_at + 'Z').getTime()
  if (age > CACHE_TTL_MS) return null
  return {
    meta: JSON.parse(row.meta_json),
    items: JSON.parse(row.items_json),
    tree: JSON.parse(row.tree_json),
  }
}

export function setCachedGantt(projectKey, meta, items, tree) {
  const db = getDb()
  db.prepare(`
    INSERT OR REPLACE INTO gantt_project_cache
      (project_key, meta_json, items_json, tree_json, fetched_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(projectKey, JSON.stringify(meta), JSON.stringify(items), JSON.stringify(tree))
}

// ── Main fetch + build ──────────────────────────────────────────────────────

export async function getGanttData(org, projectNumber, forceRefresh = false) {
  const projectKey = `${org}/${projectNumber}`

  if (!forceRefresh) {
    const cached = getCachedGantt(projectKey)
    if (cached) return cached
  }

  const [meta, items] = await Promise.all([
    fetchProjectMeta(org, projectNumber),
    fetchAllProjectItems(org, projectNumber),
  ])

  const tree = buildGanttTree(items, meta)
  setCachedGantt(projectKey, meta, items, tree)

  return { meta, items, tree }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function addDays(dateStr, days) {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
