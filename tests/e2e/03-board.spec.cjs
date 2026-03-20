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

async function waitForQueue(request, ms = 10_000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    const res = await request.get(`${API}/api/repos/${OWNER}/${REPO}/queue`)
    const q = await res.json()
    const pending = q?.stats?.find(s => s.status === 'pending')?.count || 0
    const processing = q?.stats?.find(s => s.status === 'processing')?.count || 0
    if (pending === 0 && processing === 0) return
    await new Promise(r => setTimeout(r, 400))
  }
  throw new Error('Queue timeout')
}

test.describe('Issues API', () => {
  test.beforeEach(async ({ request }) => { await login(request) })

  test('GET /api/repos/:o/:r/issues returns array', async ({ request }) => {
    const res = await request.get(`${API}/api/repos/${OWNER}/${REPO}/issues`)
    expect(res.status()).toBe(200)
    const issues = await res.json()
    expect(Array.isArray(issues)).toBe(true)
  })

  test('issues have required fields', async ({ request }) => {
    const res = await request.get(`${API}/api/repos/${OWNER}/${REPO}/issues`)
    const issues = await res.json()
    if (!issues.length) return
    const i = issues[0]
    expect(i).toHaveProperty('number')
    expect(i).toHaveProperty('title')
    expect(i).toHaveProperty('column')
    expect(i).toHaveProperty('url')
    expect(['todo', 'in-progress', 'done']).toContain(i.column)
  })

  test('issues are cached in SQLite (fast response)', async ({ request }) => {
    const t0 = Date.now()
    const res = await request.get(`${API}/api/repos/${OWNER}/${REPO}/issues`)
    const elapsed = Date.now() - t0
    expect(res.status()).toBe(200)
    expect(elapsed).toBeLessThan(500) // SQLite read should be < 500ms
  })
})

test.describe('Issue CRUD', () => {
  let testIssueNumber

  test.beforeEach(async ({ request }) => { await login(request) })

  test.afterEach(async ({ request }) => {
    if (testIssueNumber) {
      await request.patch(`${API}/api/repos/${OWNER}/${REPO}/issues/${testIssueNumber}/close`, { data: {} })
      await waitForQueue(request)
      testIssueNumber = null
    }
  })

  test('POST creates issue and enqueues job', async ({ request }) => {
    const title = `E2E create test ${Date.now()}`
    const res = await request.post(`${API}/api/repos/${OWNER}/${REPO}/issues`, {
      data: { title, body: 'Created by Playwright E2E' },
    })
    expect(res.status()).toBe(202)
    const body = await res.json()
    expect(body.queued).toBe(true)
    expect(body.jobId).toBeTruthy()
    expect(body.column).toBe('todo')

    // Wait for queue to create on GitHub
    await waitForQueue(request, 15_000)

    const issues = await request.get(`${API}/api/repos/${OWNER}/${REPO}/issues`)
    const all = await issues.json()
    const created = all.find(i => i.title === title)
    expect(created).toBeTruthy()
    testIssueNumber = created?.number
  })

  test('PATCH /move updates column immediately in DB', async ({ request }) => {
    const issues = await request.get(`${API}/api/repos/${OWNER}/${REPO}/issues`)
    const all = await issues.json()
    const issue = all.find(i => i.column === 'todo') || all[0]
    if (!issue) return

    const from = issue.column
    const to = from === 'todo' ? 'in-progress' : 'todo'

    const res = await request.patch(`${API}/api/repos/${OWNER}/${REPO}/issues/${issue.number}/move`, {
      data: { column: to },
    })
    expect(res.status()).toBe(200)
    expect((await res.json()).queued).toBe(true)

    // Immediate DB read
    const after = await request.get(`${API}/api/repos/${OWNER}/${REPO}/issues`)
    const updated = (await after.json()).find(i => i.number === issue.number)
    expect(updated?.column).toBe(to)

    // Restore
    await request.patch(`${API}/api/repos/${OWNER}/${REPO}/issues/${issue.number}/move`, {
      data: { column: from },
    })
    await waitForQueue(request)
  })

  test('PATCH /close removes issue from board immediately', async ({ request }) => {
    // Create temp issue
    await request.post(`${API}/api/repos/${OWNER}/${REPO}/issues`, {
      data: { title: `E2E close ${Date.now()}` },
    })
    await waitForQueue(request, 15_000)

    const issues = await request.get(`${API}/api/repos/${OWNER}/${REPO}/issues`)
    const all = await issues.json()
    const latest = all.find(i => i.title?.includes('E2E close'))
    if (!latest) return

    const res = await request.patch(`${API}/api/repos/${OWNER}/${REPO}/issues/${latest.number}/close`, {
      data: {},
    })
    expect(res.status()).toBe(200)
    expect((await res.json()).queued).toBe(true)

    // Should be gone from board immediately
    const afterClose = await request.get(`${API}/api/repos/${OWNER}/${REPO}/issues`)
    const stillOpen = (await afterClose.json()).find(i => i.number === latest.number)
    expect(stillOpen).toBeUndefined()
  })
})

test.describe('Issue Detail', () => {
  test.beforeEach(async ({ request }) => { await login(request) })

  test('GET /issues/:id returns full issue', async ({ request }) => {
    const res = await request.get(`${API}/api/repos/${OWNER}/${REPO}/issues`)
    const issues = await res.json()
    if (!issues.length) return

    const issue = issues[0]
    const detail = await request.get(`${API}/api/repos/${OWNER}/${REPO}/issues/${issue.number}`)
    expect(detail.status()).toBe(200)
    const d = await detail.json()
    expect(d.number).toBe(issue.number)
    expect(d).toHaveProperty('body')
    expect(d).toHaveProperty('labels')
    expect(d).toHaveProperty('assignees')
  })

  test('GET /issues/:id/comments returns array', async ({ request }) => {
    const res = await request.get(`${API}/api/repos/${OWNER}/${REPO}/issues`)
    const issues = await res.json()
    if (!issues.length) return

    const commentsRes = await request.get(
      `${API}/api/repos/${OWNER}/${REPO}/issues/${issues[0].number}/comments`
    )
    expect(commentsRes.status()).toBe(200)
    expect(Array.isArray(await commentsRes.json())).toBe(true)
  })

  test('POST comment is queued', async ({ request }) => {
    const issues = await (await request.get(`${API}/api/repos/${OWNER}/${REPO}/issues`)).json()
    if (!issues.length) return

    const res = await request.post(
      `${API}/api/repos/${OWNER}/${REPO}/issues/${issues[0].number}/comments`,
      { data: { body: `E2E comment ${Date.now()}` } }
    )
    expect(res.status()).toBe(202)
    expect((await res.json()).queued).toBe(true)
  })
})
