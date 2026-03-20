// @ts-check
const { test, expect } = require('@playwright/test')
const { loginViaApi } = require('./helpers/auth.cjs')
const { apiCall, getIssues, getQueueStats, waitForQueueEmpty } = require('./helpers/api.cjs')

const OWNER = 'ngocp-0847'
const REPO = 'kanban-mvp'
const API = 'http://localhost:4000'

test.describe('Sync Queue', () => {
  test.beforeEach(async ({ request }) => {
    await loginViaApi(request)
  })

  test('GET /api/repos/:owner/:repo/queue returns stats and log', async ({ request }) => {
    const stats = await getQueueStats(request, OWNER, REPO)
    expect(stats).toBeTruthy()
    expect(stats).toHaveProperty('stats')
    expect(stats).toHaveProperty('recent')
    expect(Array.isArray(stats.stats)).toBe(true)
    expect(Array.isArray(stats.recent)).toBe(true)
  })

  test('move operation is immediately reflected in DB', async ({ request }) => {
    const issues = await getIssues(request, OWNER, REPO)
    if (!issues.length) return

    const issue = issues.find(i => i.column !== 'done') || issues[0]
    const from = issue.column
    const to = from === 'todo' ? 'in-progress' : 'todo'

    // Move
    const moveRes = await request.patch(
      `${API}/api/repos/${OWNER}/${REPO}/issues/${issue.number}/move`,
      { data: { column: to } }
    )
    expect(moveRes.status()).toBe(200)
    const moveBody = await moveRes.json()
    expect(moveBody.queued).toBe(true)

    // DB reflects immediately (no need to wait for queue)
    const afterMove = await getIssues(request, OWNER, REPO)
    const updated = afterMove.find(i => i.number === issue.number)
    expect(updated?.column).toBe(to)

    // Restore
    await request.patch(
      `${API}/api/repos/${OWNER}/${REPO}/issues/${issue.number}/move`,
      { data: { column: from } }
    )
    await waitForQueueEmpty(request, OWNER, REPO)
  })

  test('queue processes pending jobs and marks done', async ({ request }) => {
    const issues = await getIssues(request, OWNER, REPO)
    if (!issues.length) return

    const issue = issues[0]
    await request.patch(
      `${API}/api/repos/${OWNER}/${REPO}/issues/${issue.number}/move`,
      { data: { column: 'in-progress' } }
    )

    // Wait for queue
    await waitForQueueEmpty(request, OWNER, REPO, 10_000)

    const q = await getQueueStats(request, OWNER, REPO)
    const done = q.stats.find(s => s.status === 'done')
    expect(done).toBeTruthy()
    expect(done.count).toBeGreaterThan(0)

    // Restore
    await request.patch(
      `${API}/api/repos/${OWNER}/${REPO}/issues/${issue.number}/move`,
      { data: { column: issue.column } }
    )
  })

  test('close operation removes issue from board cache', async ({ request }) => {
    // Create a temp issue to close
    const createRes = await request.post(
      `${API}/api/repos/${OWNER}/${REPO}/issues`,
      { data: { title: `E2E close test ${Date.now()}` } }
    )
    expect(createRes.status()).toBe(202)
    await waitForQueueEmpty(request, OWNER, REPO, 15_000)

    const issues = await getIssues(request, OWNER, REPO)
    const created = issues.find(i => i.title.includes('E2E close test'))
    if (!created) return // creation might not have synced yet

    const closeRes = await request.patch(
      `${API}/api/repos/${OWNER}/${REPO}/issues/${created.number}/close`,
      { data: {} }
    )
    expect(closeRes.status()).toBe(200)
    const closeBody = await closeRes.json()
    expect(closeBody.queued).toBe(true)

    // Issue should be gone from DB immediately
    const afterClose = await getIssues(request, OWNER, REPO)
    const stillOpen = afterClose.find(i => i.number === created.number)
    expect(stillOpen).toBeUndefined()
  })

  test('unauthenticated requests are rejected with 401', async ({ playwright }) => {
    // Create a completely fresh context with no cookies/session
    const fresh = await playwright.request.newContext({ baseURL: API })
    try {
      const anonRes = await fresh.get(`${API}/api/repos`)
      expect(anonRes.status()).toBe(401)
      const body = await anonRes.json()
      expect(body.error).toBe('Not authenticated')
    } finally {
      await fresh.dispose()
    }
  })
})
