// @ts-check
const { test, expect } = require('@playwright/test')

const API = 'http://localhost:4000'
const OWNER = 'ngocp-0847'
const REPO = 'kanban-mvp'

function getToken() {
  const fs = require('fs'), path = require('path')
  return fs.readFileSync(path.join(__dirname, '../../.env'), 'utf8')
    .match(/^GITHUB_TOKEN=(.+)$/m)[1].trim()
}

async function login(request) {
  await request.post(`${API}/api/auth/login`, { data: { token: getToken() } })
}

async function waitForQueue(request, ms = 15_000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    const res = await request.get(`${API}/api/repos/${OWNER}/${REPO}/queue`)
    const q = await res.json()
    const pending = q?.stats?.find(s => s.status === 'pending')?.count || 0
    const processing = q?.stats?.find(s => s.status === 'processing')?.count || 0
    if (pending === 0 && processing === 0) return
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('Queue timeout')
}

test.describe('Sub-Issues API', () => {
  test.beforeEach(async ({ request }) => { await login(request) })

  // ── Route: GET sub-issues ────────────────────────────────────────────────

  test('GET /sub-issues returns array for any issue', async ({ request }) => {
    // Get an existing issue first
    const res = await request.get(`${API}/api/repos/${OWNER}/${REPO}/issues`)
    const issues = await res.json()
    if (!issues.length) return test.skip()

    const subRes = await request.get(
      `${API}/api/repos/${OWNER}/${REPO}/issues/${issues[0].number}/sub-issues`
    )
    expect(subRes.status()).toBe(200)
    const subs = await subRes.json()
    expect(Array.isArray(subs)).toBe(true)
  })

  test('GET /sub-issues for non-parent returns empty array', async ({ request }) => {
    const res = await request.get(`${API}/api/repos/${OWNER}/${REPO}/issues`)
    const issues = await res.json()
    // Find an issue with no children
    const standalone = issues.find(i => (i.childrenTotal || 0) === 0)
    if (!standalone) return test.skip()

    const subRes = await request.get(
      `${API}/api/repos/${OWNER}/${REPO}/issues/${standalone.number}/sub-issues`
    )
    expect(subRes.status()).toBe(200)
    const subs = await subRes.json()
    expect(subs).toEqual([])
  })

  // ── Route: GET parent ─────────────────────────────────────────────────

  test('GET /parent returns null for standalone issue', async ({ request }) => {
    const res = await request.get(`${API}/api/repos/${OWNER}/${REPO}/issues`)
    const issues = await res.json()
    const standalone = issues.find(i => !i.parentNumber)
    if (!standalone) return test.skip()

    const parentRes = await request.get(
      `${API}/api/repos/${OWNER}/${REPO}/issues/${standalone.number}/parent`
    )
    expect(parentRes.status()).toBe(200)
    const parent = await parentRes.json()
    expect(parent).toBeNull()
  })

  // ── Route: POST create sub-issue ──────────────────────────────────────

  test('POST /sub-issues creates and links sub-issue', async ({ request }) => {
    const res = await request.get(`${API}/api/repos/${OWNER}/${REPO}/issues`)
    const issues = await res.json()
    // Find a non-child issue to be the parent
    const parent = issues.find(i => !i.parentNumber)
    if (!parent) return test.skip()

    const createRes = await request.post(
      `${API}/api/repos/${OWNER}/${REPO}/issues/${parent.number}/sub-issues`,
      { data: { title: `E2E sub-issue test ${Date.now()}` } }
    )
    expect(createRes.status()).toBe(202)
    const body = await createRes.json()
    expect(body.queued).toBe(true)
    expect(body.parentNumber).toBe(parent.number)

    await waitForQueue(request)

    // Verify sub-issue appears in list
    const subRes = await request.get(
      `${API}/api/repos/${OWNER}/${REPO}/issues/${parent.number}/sub-issues`
    )
    const subs = await subRes.json()
    expect(subs.length).toBeGreaterThanOrEqual(1)
  })

  test('POST /sub-issues rejects empty title', async ({ request }) => {
    const res = await request.get(`${API}/api/repos/${OWNER}/${REPO}/issues`)
    const issues = await res.json()
    if (!issues.length) return test.skip()

    const createRes = await request.post(
      `${API}/api/repos/${OWNER}/${REPO}/issues/${issues[0].number}/sub-issues`,
      { data: { title: '' } }
    )
    expect(createRes.status()).toBe(400)
  })

  // ── Route: POST link existing ──────────────────────────────────────────

  test('POST /sub-issues/link links existing issue', async ({ request }) => {
    const res = await request.get(`${API}/api/repos/${OWNER}/${REPO}/issues`)
    const issues = await res.json()
    // Need at least 2 standalone issues
    const standalone = issues.filter(i => !i.parentNumber && (i.childrenTotal || 0) === 0)
    if (standalone.length < 2) return test.skip()

    const [parent, child] = standalone

    const linkRes = await request.post(
      `${API}/api/repos/${OWNER}/${REPO}/issues/${parent.number}/sub-issues/link`,
      { data: { childNumber: child.number } }
    )
    expect(linkRes.status()).toBe(200)
    const body = await linkRes.json()
    expect(body.queued).toBe(true)
  })

  test('POST /sub-issues/link rejects depth violation', async ({ request }) => {
    const res = await request.get(`${API}/api/repos/${OWNER}/${REPO}/issues`)
    const issues = await res.json()
    // Find a child issue (has parentNumber)
    const child = issues.find(i => i.parentNumber)
    if (!child) return test.skip()

    // Try to add a sub-issue to a child — should fail
    const linkRes = await request.post(
      `${API}/api/repos/${OWNER}/${REPO}/issues/${child.number}/sub-issues/link`,
      { data: { childNumber: 999999 } }
    )
    expect(linkRes.status()).toBe(422)
  })

  // ── Route: DELETE unlink ──────────────────────────────────────────────

  test('DELETE /sub-issues/:childId unlinks sub-issue', async ({ request }) => {
    const res = await request.get(`${API}/api/repos/${OWNER}/${REPO}/issues`)
    const issues = await res.json()
    // Find a parent with children
    const parent = issues.find(i => (i.childrenTotal || 0) > 0)
    if (!parent) return test.skip()

    const subsRes = await request.get(
      `${API}/api/repos/${OWNER}/${REPO}/issues/${parent.number}/sub-issues`
    )
    const subs = await subsRes.json()
    if (!subs.length) return test.skip()

    const unlinkRes = await request.delete(
      `${API}/api/repos/${OWNER}/${REPO}/issues/${parent.number}/sub-issues/${subs[0].number}`
    )
    expect(unlinkRes.status()).toBe(200)
    const body = await unlinkRes.json()
    expect(body.queued).toBe(true)
  })

  // ── Issues list includes sub-issue fields ──────────────────────────────

  test('issues list includes sub-issue fields', async ({ request }) => {
    const res = await request.get(`${API}/api/repos/${OWNER}/${REPO}/issues`)
    const issues = await res.json()
    if (!issues.length) return test.skip()

    const issue = issues[0]
    expect(issue).toHaveProperty('childrenTotal')
    expect(issue).toHaveProperty('childrenDone')
    expect(typeof issue.childrenTotal).toBe('number')
    expect(typeof issue.childrenDone).toBe('number')
  })

  // ── Progress tracking ──────────────────────────────────────────────────

  test('parent childrenTotal reflects linked sub-issues', async ({ request }) => {
    const res = await request.get(`${API}/api/repos/${OWNER}/${REPO}/issues`)
    const issues = await res.json()
    const parent = issues.find(i => (i.childrenTotal || 0) > 0)
    if (!parent) return test.skip()

    // childrenTotal should match the sub-issues list length
    const subsRes = await request.get(
      `${API}/api/repos/${OWNER}/${REPO}/issues/${parent.number}/sub-issues`
    )
    const subs = await subsRes.json()
    expect(parent.childrenTotal).toBe(subs.length)
  })

  test('childrenDone counts sub-issues in done column', async ({ request }) => {
    const res = await request.get(`${API}/api/repos/${OWNER}/${REPO}/issues`)
    const issues = await res.json()
    const parent = issues.find(i => (i.childrenTotal || 0) > 0)
    if (!parent) return test.skip()

    const subsRes = await request.get(
      `${API}/api/repos/${OWNER}/${REPO}/issues/${parent.number}/sub-issues`
    )
    const subs = await subsRes.json()
    const doneCount = subs.filter(s => s.column === 'done').length
    expect(parent.childrenDone).toBe(doneCount)
  })
})
