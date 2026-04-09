import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// ── gh CLI wrapper ──────────────────────────────────────────────────────────
async function execGh(args, opts = {}) {
  try {
    const { stdout } = await execFileAsync('gh', args, {
      timeout: opts.timeout || 15000,
      maxBuffer: 10 * 1024 * 1024,
    })
    return stdout
  } catch (err) {
    const msg = err.stderr?.trim() || err.message
    throw new Error(`gh: ${msg}`)
  }
}

async function execGhJson(args, opts) {
  const stdout = await execGh(args, opts)
  return JSON.parse(stdout || '[]')
}

// ── Constants ───────────────────────────────────────────────────────────────
export const KANBAN_LABELS = ['kanban:todo', 'kanban:in-progress', 'kanban:done']
const LABEL_COLORS = {
  'kanban:todo': 'e4e669',
  'kanban:in-progress': '0075ca',
  'kanban:done': '0e8a16',
}

export const COLUMN_LABEL = {
  todo: 'kanban:todo',
  'in-progress': 'kanban:in-progress',
  done: 'kanban:done',
}

// ── Label bootstrap ──────────────────────────────────────────────────────────
export async function ensureLabels({ owner, repo }) {
  for (const [name, color] of Object.entries(LABEL_COLORS)) {
    try {
      await execGh([
        'api', '-X', 'POST', `repos/${owner}/${repo}/labels`,
        '-f', `name=${name}`,
        '-f', `color=${color}`,
      ])
    } catch (_) {} // 422 = already exists, ignore
  }
}

// ── Issues ───────────────────────────────────────────────────────────────────
export async function fetchIssues({ owner, repo }) {
  const stdout = await execGh([
    'api', `repos/${owner}/${repo}/issues?state=open&per_page=100`,
    '--paginate',
  ], { timeout: 30000 })

  if (!stdout.trim()) return []
  // --paginate concatenates JSON arrays: [...][ ...] → merge into one
  const merged = stdout.replace(/\]\s*\[/g, ',')
  const results = JSON.parse(merged)
  return results.filter(i => !i.pull_request)
}

export async function fetchIssueDetail({ owner, repo, number }) {
  return execGhJson(['api', `repos/${owner}/${repo}/issues/${number}`])
}

export async function createIssue({ owner, repo, title, body = '' }) {
  return execGhJson([
    'api', '-X', 'POST', `repos/${owner}/${repo}/issues`,
    '-f', `title=${title}`,
    '-f', `body=${body}`,
    '-f', 'labels[]=kanban:todo',
  ])
}

export async function moveIssue({ owner, repo, number, toColumn }) {
  const newLabel = COLUMN_LABEL[toColumn]
  if (!newLabel) throw new Error(`Unknown column: ${toColumn}`)

  // Get current issue to read labels
  const issue = await execGhJson(['api', `repos/${owner}/${repo}/issues/${number}`])
  const currentLabels = issue.labels.map(l => l.name)
  const newLabels = [...currentLabels.filter(l => !KANBAN_LABELS.includes(l)), newLabel]

  // Build -f flags for labels array
  const labelArgs = newLabels.flatMap(l => ['-f', `labels[]=${l}`])
  return execGhJson([
    'api', '-X', 'PATCH', `repos/${owner}/${repo}/issues/${number}`,
    ...labelArgs,
  ])
}

export async function closeIssue({ owner, repo, number }) {
  return execGhJson([
    'api', '-X', 'PATCH', `repos/${owner}/${repo}/issues/${number}`,
    '-f', 'state=closed',
  ])
}

// ── Comments ─────────────────────────────────────────────────────────────────
export async function fetchComments({ owner, repo, number }) {
  return execGhJson([
    'api', `repos/${owner}/${repo}/issues/${number}/comments?per_page=50`,
  ])
}

export async function updateIssue({ owner, repo, number, title, body }) {
  const args = [
    'api', '-X', 'PATCH', `repos/${owner}/${repo}/issues/${number}`,
    '-f', `title=${title}`,
  ]
  if (body !== undefined) args.push('-f', `body=${body}`)
  return execGhJson(args)
}

export async function postComment({ owner, repo, number, body }) {
  return execGhJson([
    'api', '-X', 'POST', `repos/${owner}/${repo}/issues/${number}/comments`,
    '-f', `body=${body}`,
  ])
}

// ── Collaborators / Labels ────────────────────────────────────────────────────
export async function fetchCollaborators({ owner, repo }) {
  try {
    return await execGhJson([
      'api', `repos/${owner}/${repo}/collaborators?per_page=50`,
    ])
  } catch (_) { return [] }
}

export async function fetchRepoLabels({ owner, repo }) {
  try {
    return await execGhJson([
      'api', `repos/${owner}/${repo}/labels?per_page=100`,
    ])
  } catch (_) { return [] }
}

export async function updateAssignees({ owner, repo, number, assignees }) {
  const args = [
    'api', '-X', 'PATCH', `repos/${owner}/${repo}/issues/${number}`,
    ...assignees.flatMap(a => ['-f', `assignees[]=${a}`]),
  ]
  return execGhJson(args)
}

export async function updateLabels({ owner, repo, number, labels }) {
  const args = [
    'api', '-X', 'PATCH', `repos/${owner}/${repo}/issues/${number}`,
    ...labels.flatMap(l => ['-f', `labels[]=${l}`]),
  ]
  return execGhJson(args)
}

// ── Repo info ─────────────────────────────────────────────────────────────────
export async function fetchRepoInfo({ owner, repo }) {
  return execGhJson(['api', `repos/${owner}/${repo}`])
}

// ── Helpers (unchanged) ──────────────────────────────────────────────────────
export function getIssueColumn(issue) {
  const labels = issue.labels.map(l => l.name)
  if (labels.includes('kanban:done')) return 'done'
  if (labels.includes('kanban:in-progress')) return 'in-progress'
  return 'todo'
}

export function normalizeIssue(issue) {
  return {
    id: issue.number,
    number: issue.number,
    title: issue.title,
    body: issue.body || '',
    column: getIssueColumn(issue),
    url: issue.html_url,
    user: issue.user?.login,
    assignees: issue.assignees || [],
    labels: (issue.labels || []).map(l => typeof l === 'string' ? l : l.name),
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
  }
}
