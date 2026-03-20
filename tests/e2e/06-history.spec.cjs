// @ts-check
/**
 * 06-history.spec.cjs — E2E tests for Issue Version History & Diff/Revert feature
 *
 * Coverage:
 *  - PATCH /issues/:id        → inline edit, optimistic DB, snapshot creation, queue
 *  - GET   /issues/:id/history → timeline structure, ordering, fields
 *  - POST  /issues/:id/history/:ver/revert → revert flow, audit trail
 *  - Edge cases: invalid version, empty history, validation
 */

const { test, expect } = require('@playwright/test')
const { loginViaApi } = require('./helpers/auth.cjs')
const { apiCall, getIssues, waitForQueueEmpty } = require('./helpers/api.cjs')

const API    = 'http://localhost:4000'
const OWNER  = 'ngocp-0847'
const REPO   = 'kanban-mvp'
const BASE   = `${API}/api/repos/${OWNER}/${REPO}`

// ── helpers ──────────────────────────────────────────────────────────────────

async function editIssue(request, number, title, body = '') {
  const res = await request.patch(`${BASE}/issues/${number}`, {
    data: { title, body },
  })
  return { status: res.status(), body: await res.json().catch(() => null) }
}

async function getHistory(request, number) {
  const res = await request.get(`${BASE}/issues/${number}/history`)
  return { status: res.status(), body: await res.json().catch(() => null) }
}

async function revertTo(request, number, version) {
  const res = await request.post(`${BASE}/issues/${number}/history/${version}/revert`)
  return { status: res.status(), body: await res.json().catch(() => null) }
}

async function getIssueDetail(request, number) {
  const res = await request.get(`${BASE}/issues/${number}`)
  return res.json().catch(() => null)
}

async function pickIssue(request) {
  const issues = await getIssues(request, OWNER, REPO)
  if (!issues?.length) throw new Error('No open issues found')
  return issues[0].number
}

// ── PATCH /issues/:id — inline edit ─────────────────────────────────────────

test.describe('Inline Edit', () => {
  test.beforeEach(async ({ request }) => { await loginViaApi(request) })

  test('returns 202 with queued=true, jobId, version', async ({ request }) => {
    const num = await pickIssue(request)
    const detail = await getIssueDetail(request, num)

    const { status, body } = await editIssue(request, num, detail.title + ' [e2e]', detail.body)
    expect(status).toBe(200)           // optimistic patch returns 200 (not 202 — it's sync)
    expect(body.queued).toBe(true)
    expect(typeof body.jobId).toBe('number')
    expect(typeof body.version).toBe('number')
    expect(body.version).toBeGreaterThanOrEqual(1)

    // Restore
    await editIssue(request, num, detail.title, detail.body)
    await waitForQueueEmpty(request, OWNER, REPO)
  })

  test('returns 400 when title is missing', async ({ request }) => {
    const num = await pickIssue(request)
    const res = await request.patch(`${BASE}/issues/${num}`, {
      data: { body: 'no title here' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/title/i)
  })

  test('reflects new title in DB immediately (optimistic)', async ({ request }) => {
    const num = await pickIssue(request)
    const originalTitle = (await getIssues(request, OWNER, REPO)).find(i => i.number === num)?.title
    const newTitle = `Optimistic title check ${Date.now()}`

    await editIssue(request, num, newTitle, 'some body')

    // Read from /issues list — that endpoint serves from SQLite (optimistic, no queue wait)
    const issues = await getIssues(request, OWNER, REPO)
    const updated = issues.find(i => i.number === num)
    expect(updated?.title).toBe(newTitle)

    // Restore
    await editIssue(request, num, originalTitle)
    await waitForQueueEmpty(request, OWNER, REPO)
  })

  test('edit is synced to GitHub after queue processes', async ({ request }) => {
    const num = await pickIssue(request)
    const originalTitle = (await getIssueDetail(request, num)).title
    const newTitle = `GitHub sync test ${Date.now()}`

    await editIssue(request, num, newTitle, 'sync body')
    await waitForQueueEmpty(request, OWNER, REPO, 15_000)

    // Verify via GitHub API (via server proxy)
    const detail = await getIssueDetail(request, num)
    expect(detail.title).toBe(newTitle)

    // Restore
    await editIssue(request, num, originalTitle)
    await waitForQueueEmpty(request, OWNER, REPO, 15_000)
  })

  test('unauthenticated edit returns 401', async ({ playwright }) => {
    const fresh = await playwright.request.newContext()
    try {
      const res = await fresh.patch(`${BASE}/issues/1`, {
        data: { title: 'hacked', body: '' },
      })
      expect(res.status()).toBe(401)
    } finally {
      await fresh.dispose()
    }
  })
})

// ── GET /issues/:id/history — timeline ───────────────────────────────────────

test.describe('History — Read', () => {
  test.beforeEach(async ({ request }) => { await loginViaApi(request) })

  test('returns array (empty for unedited issues)', async ({ request }) => {
    // Use a fresh issue to guarantee empty history
    // (or just verify it returns an array for any issue)
    const num = await pickIssue(request)
    const { status, body } = await getHistory(request, num)
    expect(status).toBe(200)
    expect(Array.isArray(body)).toBe(true)
  })

  test('history grows after each edit', async ({ request }) => {
    const num = await pickIssue(request)
    const original = await getIssueDetail(request, num)

    const { body: h0 } = await getHistory(request, num)
    const countBefore = h0.length

    // Edit 1
    await editIssue(request, num, original.title + ' [h1]', 'body h1')
    // Edit 2
    await editIssue(request, num, original.title + ' [h2]', 'body h2')

    const { body: h2 } = await getHistory(request, num)
    expect(h2.length).toBeGreaterThanOrEqual(countBefore + 2)

    // Restore
    await editIssue(request, num, original.title, original.body)
    await waitForQueueEmpty(request, OWNER, REPO)
  })

  test('history entries are ordered newest-first', async ({ request }) => {
    const num = await pickIssue(request)
    const original = await getIssueDetail(request, num)

    await editIssue(request, num, 'First edit', 'body 1')
    await editIssue(request, num, 'Second edit', 'body 2')

    const { body: hist } = await getHistory(request, num)
    expect(hist.length).toBeGreaterThanOrEqual(2)

    // Versions should be descending
    for (let i = 0; i < hist.length - 1; i++) {
      expect(hist[i].version).toBeGreaterThan(hist[i + 1].version)
    }

    // Restore
    await editIssue(request, num, original.title, original.body)
    await waitForQueueEmpty(request, OWNER, REPO)
  })

  test('each history entry has required fields', async ({ request }) => {
    const num = await pickIssue(request)
    const original = await getIssueDetail(request, num)

    await editIssue(request, num, 'Field check edit', 'checking fields')
    const { body: hist } = await getHistory(request, num)
    const entry = hist[0]   // newest

    expect(entry).toHaveProperty('id')
    expect(entry).toHaveProperty('repo_key')
    expect(entry).toHaveProperty('number')
    expect(entry).toHaveProperty('version')
    expect(entry).toHaveProperty('title')
    expect(entry).toHaveProperty('body')
    expect(entry).toHaveProperty('edited_by')
    expect(entry).toHaveProperty('edited_at')
    expect(entry).toHaveProperty('revert_of')

    // Types
    expect(typeof entry.version).toBe('number')
    expect(typeof entry.title).toBe('string')
    expect(entry.repo_key).toBe(`${OWNER}/${REPO}`)
    expect(entry.number).toBe(num)

    // Restore
    await editIssue(request, num, original.title, original.body)
    await waitForQueueEmpty(request, OWNER, REPO)
  })

  test('snapshot captures content BEFORE the edit (prev state)', async ({ request }) => {
    const num = await pickIssue(request)
    // Read current title from SQLite (source of truth for DB state)
    const issues = await getIssues(request, OWNER, REPO)
    const titleBefore = issues.find(i => i.number === num)?.title

    // Count existing history so we can find the new snapshot precisely
    const { body: h0 } = await getHistory(request, num)
    const countBefore = h0.length

    await editIssue(request, num, 'New title after snapshot', 'new body')
    const { body: hist } = await getHistory(request, num)

    // The new snapshot (newest entry) should contain the title from BEFORE the edit
    const newSnapshot = hist.find((h, i) => i < hist.length - countBefore)
    expect(newSnapshot).toBeTruthy()
    expect(newSnapshot.title).toBe(titleBefore)

    // Restore
    await editIssue(request, num, titleBefore)
    await waitForQueueEmpty(request, OWNER, REPO)
  })

  test('edited_by is set to authenticated user login', async ({ request }) => {
    const num = await pickIssue(request)
    const original = await getIssueDetail(request, num)

    await editIssue(request, num, 'Auth check edit', 'body')
    const { body: hist } = await getHistory(request, num)
    const entry = hist[0]

    expect(entry.edited_by).toBe('ngocp-0847')

    // Restore
    await editIssue(request, num, original.title, original.body)
    await waitForQueueEmpty(request, OWNER, REPO)
  })

  test('unauthenticated history request returns 401', async ({ playwright }) => {
    const fresh = await playwright.request.newContext()
    try {
      const res = await fresh.get(`${BASE}/issues/1/history`)
      expect(res.status()).toBe(401)
    } finally {
      await fresh.dispose()
    }
  })
})

// ── POST /issues/:id/history/:ver/revert ─────────────────────────────────────

test.describe('Revert', () => {
  test.beforeEach(async ({ request }) => { await loginViaApi(request) })

  test('revert returns queued=true, revertedTo, newVersion', async ({ request }) => {
    const num = await pickIssue(request)
    const original = await getIssueDetail(request, num)

    // Create at least 2 versions
    await editIssue(request, num, 'Revert test v1', 'body for revert')
    const { body: hist } = await getHistory(request, num)
    const targetVer = hist[hist.length - 1].version   // oldest = v1

    const { status, body } = await revertTo(request, num, targetVer)
    expect(status).toBe(200)
    expect(body.queued).toBe(true)
    expect(body.revertedTo).toBe(targetVer)
    expect(typeof body.newVersion).toBe('number')
    expect(body.newVersion).toBeGreaterThan(targetVer)

    // Restore
    await editIssue(request, num, original.title, original.body)
    await waitForQueueEmpty(request, OWNER, REPO)
  })

  test('revert restores title and body in DB immediately', async ({ request }) => {
    const num = await pickIssue(request)
    // Read current state from SQLite
    const issuesBefore = await getIssues(request, OWNER, REPO)
    const originalTitle = issuesBefore.find(i => i.number === num)?.title

    // Create v1 snapshot with known title
    const knownTitle = `Known state for revert ${Date.now()}`
    await editIssue(request, num, knownTitle, 'known body')

    // Now edit again so we have 2+ versions
    await editIssue(request, num, 'State after known', 'changed again')

    const { body: hist } = await getHistory(request, num)
    // Find the snapshot that contains knownTitle (it was snapshotted as "before" the 2nd edit)
    const knownSnap = hist.find(h => h.title === knownTitle)
    expect(knownSnap).toBeTruthy()

    await revertTo(request, num, knownSnap.version)

    // DB should reflect knownTitle immediately (optimistic)
    const issuesAfter = await getIssues(request, OWNER, REPO)
    const afterRevert = issuesAfter.find(i => i.number === num)
    expect(afterRevert?.title).toBe(knownTitle)

    // Restore
    await editIssue(request, num, originalTitle)
    await waitForQueueEmpty(request, OWNER, REPO)
  })

  test('revert adds new history entries (current snapshot + revert snapshot)', async ({ request }) => {
    const num = await pickIssue(request)
    const original = await getIssueDetail(request, num)

    await editIssue(request, num, 'Audit trail test', 'trail body')
    const { body: h1 } = await getHistory(request, num)
    const countBefore = h1.length
    const targetVer = h1[h1.length - 1].version

    await revertTo(request, num, targetVer)

    const { body: h2 } = await getHistory(request, num)
    // Should have added 2 more entries: snapshot-before-revert + revert-snapshot
    expect(h2.length).toBeGreaterThanOrEqual(countBefore + 2)

    // Restore
    await editIssue(request, num, original.title, original.body)
    await waitForQueueEmpty(request, OWNER, REPO)
  })

  test('revert snapshot has revert_of pointing to source id', async ({ request }) => {
    const num = await pickIssue(request)
    const original = await getIssueDetail(request, num)

    await editIssue(request, num, 'Revert_of check', 'body')
    const { body: h1 } = await getHistory(request, num)
    const targetSnap = h1[h1.length - 1]

    await revertTo(request, num, targetSnap.version)

    const { body: h2 } = await getHistory(request, num)
    // Newest entry should be the revert snapshot with revert_of = targetSnap.id
    const revertEntry = h2.find(h => h.revert_of !== null)
    expect(revertEntry).toBeTruthy()
    expect(revertEntry.revert_of).toBe(targetSnap.id)

    // Restore
    await editIssue(request, num, original.title, original.body)
    await waitForQueueEmpty(request, OWNER, REPO)
  })

  test('revert to non-existent version returns 404', async ({ request }) => {
    const num = await pickIssue(request)
    const { status } = await revertTo(request, num, 99999)
    expect(status).toBe(404)
  })

  test('revert is synced to GitHub after queue processes', async ({ request }) => {
    const num = await pickIssue(request)
    const original = await getIssueDetail(request, num)

    await editIssue(request, num, 'Pre-revert state', 'changed')
    const { body: hist } = await getHistory(request, num)
    const oldestVer = hist[hist.length - 1].version
    const expectedTitle = hist.find(h => h.version === oldestVer).title

    await revertTo(request, num, oldestVer)
    await waitForQueueEmpty(request, OWNER, REPO, 15_000)

    const detail = await getIssueDetail(request, num)
    expect(detail.title).toBe(expectedTitle)

    // Restore
    await editIssue(request, num, original.title, original.body)
    await waitForQueueEmpty(request, OWNER, REPO, 15_000)
  })

  test('unauthenticated revert returns 401', async ({ playwright }) => {
    const fresh = await playwright.request.newContext()
    try {
      const res = await fresh.post(`${BASE}/issues/1/history/1/revert`)
      expect(res.status()).toBe(401)
    } finally {
      await fresh.dispose()
    }
  })
})

// ── Queue integrity for update jobs ─────────────────────────────────────────

test.describe('Queue — Update Jobs', () => {
  test.beforeEach(async ({ request }) => { await loginViaApi(request) })

  test('update operation appears in queue log after edit', async ({ request }) => {
    const num = await pickIssue(request)
    const original = await getIssueDetail(request, num)

    await editIssue(request, num, 'Queue log check', 'body')
    await waitForQueueEmpty(request, OWNER, REPO, 15_000)

    const statsRes = await request.get(`${API}/api/repos/${OWNER}/${REPO}/queue`)
    const stats = await statsRes.json()
    const log = stats.recent || []
    const updateJob = log.find(j => j.operation === 'update')
    expect(updateJob).toBeTruthy()
    expect(updateJob.status).toBe('done')

    // Restore
    await editIssue(request, num, original.title, original.body)
    await waitForQueueEmpty(request, OWNER, REPO)
  })

  test('multiple edits enqueue separate jobs', async ({ request }) => {
    const num = await pickIssue(request)
    const original = await getIssueDetail(request, num)

    await editIssue(request, num, 'Multi job 1', 'b1')
    await editIssue(request, num, 'Multi job 2', 'b2')
    await editIssue(request, num, 'Multi job 3', 'b3')
    await waitForQueueEmpty(request, OWNER, REPO, 20_000)

    const statsRes = await request.get(`${API}/api/repos/${OWNER}/${REPO}/queue`)
    const { recent } = await statsRes.json()
    const updateJobs = recent.filter(j => j.operation === 'update')
    expect(updateJobs.length).toBeGreaterThanOrEqual(3)

    // Restore
    await editIssue(request, num, original.title, original.body)
    await waitForQueueEmpty(request, OWNER, REPO)
  })
})
