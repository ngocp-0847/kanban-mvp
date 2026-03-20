import fetch from 'node-fetch'

const BASE = 'https://api.github.com'
const TOKEN = process.env.GITHUB_TOKEN

const headers = () => ({
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
})

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
      await fetch(`${BASE}/repos/${owner}/${repo}/labels`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ name, color }),
      })
    } catch (_) {}
  }
}

// ── Issues ───────────────────────────────────────────────────────────────────
export async function fetchIssues({ owner, repo }) {
  let page = 1
  const results = []
  while (true) {
    const res = await fetch(
      `${BASE}/repos/${owner}/${repo}/issues?state=open&per_page=100&page=${page}`,
      { headers: headers() }
    )
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${owner}/${repo}`)
    const issues = await res.json()
    if (!issues.length) break
    results.push(...issues.filter(i => !i.pull_request))
    if (issues.length < 100) break
    page++
  }
  return results
}

export async function fetchIssueDetail({ owner, repo, number }) {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/issues/${number}`, { headers: headers() })
  if (!res.ok) throw new Error(`Fetch issue failed: ${res.status}`)
  return res.json()
}

export async function createIssue({ owner, repo, title, body = '' }) {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/issues`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ title, body, labels: ['kanban:todo'] }),
  })
  if (!res.ok) throw new Error(`Create issue failed: ${res.status}`)
  return res.json()
}

export async function moveIssue({ owner, repo, number, toColumn }) {
  const newLabel = COLUMN_LABEL[toColumn]
  if (!newLabel) throw new Error(`Unknown column: ${toColumn}`)
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/issues/${number}`, { headers: headers() })
  const issue = await res.json()
  const currentLabels = issue.labels.map(l => l.name)
  const newLabels = [...currentLabels.filter(l => !KANBAN_LABELS.includes(l)), newLabel]
  const updateRes = await fetch(`${BASE}/repos/${owner}/${repo}/issues/${number}`, {
    method: 'PATCH', headers: headers(),
    body: JSON.stringify({ labels: newLabels }),
  })
  if (!updateRes.ok) throw new Error(`Move issue failed: ${updateRes.status}`)
  return updateRes.json()
}

export async function closeIssue({ owner, repo, number }) {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/issues/${number}`, {
    method: 'PATCH', headers: headers(),
    body: JSON.stringify({ state: 'closed' }),
  })
  if (!res.ok) throw new Error(`Close issue failed: ${res.status}`)
  return res.json()
}

// ── Comments ─────────────────────────────────────────────────────────────────
export async function fetchComments({ owner, repo, number }) {
  const res = await fetch(
    `${BASE}/repos/${owner}/${repo}/issues/${number}/comments?per_page=50`,
    { headers: headers() }
  )
  if (!res.ok) throw new Error(`Fetch comments failed: ${res.status}`)
  return res.json()
}

export async function postComment({ owner, repo, number, body }) {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/issues/${number}/comments`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ body }),
  })
  if (!res.ok) throw new Error(`Post comment failed: ${res.status}`)
  return res.json()
}

// ── Collaborators / Labels ────────────────────────────────────────────────────
export async function fetchCollaborators({ owner, repo }) {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/collaborators?per_page=50`, { headers: headers() })
  if (!res.ok) return []
  return res.json()
}

export async function fetchRepoLabels({ owner, repo }) {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/labels?per_page=100`, { headers: headers() })
  if (!res.ok) return []
  return res.json()
}

export async function updateAssignees({ owner, repo, number, assignees }) {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/issues/${number}`, {
    method: 'PATCH', headers: headers(), body: JSON.stringify({ assignees }),
  })
  if (!res.ok) throw new Error(`Update assignees failed: ${res.status}`)
  return res.json()
}

export async function updateLabels({ owner, repo, number, labels }) {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}/issues/${number}`, {
    method: 'PATCH', headers: headers(), body: JSON.stringify({ labels }),
  })
  if (!res.ok) throw new Error(`Update labels failed: ${res.status}`)
  return res.json()
}

// ── Repo info ─────────────────────────────────────────────────────────────────
export async function fetchRepoInfo({ owner, repo }) {
  const res = await fetch(`${BASE}/repos/${owner}/${repo}`, { headers: headers() })
  if (!res.ok) throw new Error(`Repo not found: ${owner}/${repo} (${res.status})`)
  return res.json()
}

// ── Helpers ───────────────────────────────────────────────────────────────────
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
    labels: issue.labels || [],
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
  }
}
