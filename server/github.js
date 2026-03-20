import fetch from 'node-fetch'

const BASE = 'https://api.github.com'
const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = process.env

const headers = () => ({
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
})

const KANBAN_LABELS = ['kanban:todo', 'kanban:in-progress', 'kanban:done']
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

// Ensure kanban labels exist on the repo
export async function ensureLabels() {
  for (const [name, color] of Object.entries(LABEL_COLORS)) {
    try {
      await fetch(`${BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/labels`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ name, color }),
      })
    } catch (_) {
      // Label may already exist — ignore
    }
  }
}

// Fetch all open issues — with OR without kanban labels
// Issues without kanban labels are treated as "todo"
export async function fetchIssues() {
  let page = 1
  const results = []
  while (true) {
    const res = await fetch(
      `${BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues?state=open&per_page=100&page=${page}`,
      { headers: headers() }
    )
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)
    const issues = await res.json()
    if (!issues.length) break
    // Exclude pull requests (GitHub returns PRs in issues endpoint)
    results.push(...issues.filter(i => !i.pull_request))
    if (issues.length < 100) break
    page++
  }
  return results
}

// Create a new issue + assign kanban:todo label
export async function createIssue(title, body = '') {
  const res = await fetch(
    `${BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`,
    {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ title, body, labels: ['kanban:todo'] }),
    }
  )
  if (!res.ok) throw new Error(`Create issue failed: ${res.status}`)
  return res.json()
}

// Move issue to a column by swapping kanban labels
export async function moveIssue(issueNumber, toColumn) {
  const newLabel = COLUMN_LABEL[toColumn]
  if (!newLabel) throw new Error(`Unknown column: ${toColumn}`)

  // Get current labels
  const res = await fetch(
    `${BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}`,
    { headers: headers() }
  )
  const issue = await res.json()
  const currentLabels = issue.labels.map(l => l.name)

  // Remove old kanban labels, add new one
  const filteredLabels = currentLabels.filter(l => !KANBAN_LABELS.includes(l))
  const newLabels = [...filteredLabels, newLabel]

  const updateRes = await fetch(
    `${BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}`,
    {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ labels: newLabels }),
    }
  )
  if (!updateRes.ok) throw new Error(`Move issue failed: ${updateRes.status}`)
  return updateRes.json()
}

// Close an issue
export async function closeIssue(issueNumber) {
  const res = await fetch(
    `${BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}`,
    {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ state: 'closed' }),
    }
  )
  if (!res.ok) throw new Error(`Close issue failed: ${res.status}`)
  return res.json()
}

// Fetch full issue detail (body + labels + assignees)
export async function fetchIssueDetail(issueNumber) {
  const res = await fetch(
    `${BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}`,
    { headers: headers() }
  )
  if (!res.ok) throw new Error(`Fetch issue failed: ${res.status}`)
  return res.json()
}

// Fetch comments for an issue
export async function fetchComments(issueNumber) {
  const res = await fetch(
    `${BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}/comments?per_page=50`,
    { headers: headers() }
  )
  if (!res.ok) throw new Error(`Fetch comments failed: ${res.status}`)
  return res.json()
}

// Post a comment
export async function postComment(issueNumber, body) {
  const res = await fetch(
    `${BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}/comments`,
    { method: 'POST', headers: headers(), body: JSON.stringify({ body }) }
  )
  if (!res.ok) throw new Error(`Post comment failed: ${res.status}`)
  return res.json()
}

// Fetch repo collaborators (for assignee dropdown)
export async function fetchCollaborators() {
  const res = await fetch(
    `${BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/collaborators?per_page=50`,
    { headers: headers() }
  )
  if (!res.ok) return [] // 404 if no push access — return empty
  return res.json()
}

// Update assignees
export async function updateAssignees(issueNumber, assignees) {
  const res = await fetch(
    `${BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}`,
    { method: 'PATCH', headers: headers(), body: JSON.stringify({ assignees }) }
  )
  if (!res.ok) throw new Error(`Update assignees failed: ${res.status}`)
  return res.json()
}

// Update labels (non-kanban ones preserved, kanban ones managed separately)
export async function updateLabels(issueNumber, labels) {
  const res = await fetch(
    `${BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issueNumber}`,
    { method: 'PATCH', headers: headers(), body: JSON.stringify({ labels }) }
  )
  if (!res.ok) throw new Error(`Update labels failed: ${res.status}`)
  return res.json()
}

// Fetch all repo labels
export async function fetchRepoLabels() {
  const res = await fetch(
    `${BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/labels?per_page=100`,
    { headers: headers() }
  )
  if (!res.ok) return []
  return res.json()
}

// Detect which column an issue belongs to
// Issues without kanban labels default to "todo"
export function getIssueColumn(issue) {
  const labels = issue.labels.map(l => l.name)
  if (labels.includes('kanban:done')) return 'done'
  if (labels.includes('kanban:in-progress')) return 'in-progress'
  return 'todo' // kanban:todo or no kanban label → todo
}
