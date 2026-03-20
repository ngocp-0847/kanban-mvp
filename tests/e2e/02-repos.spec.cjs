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
  const res = await request.post(`${API}/api/auth/login`, { data: { token: getToken() } })
  expect(res.status()).toBe(200)
  return res.json().then(d => d.user)
}

test.describe('Repo Management API', () => {
  test.beforeEach(async ({ request }) => { await login(request) })

  test('GET /api/repos returns array', async ({ request }) => {
    const res = await request.get(`${API}/api/repos`)
    expect(res.status()).toBe(200)
    const repos = await res.json()
    expect(Array.isArray(repos)).toBe(true)
  })

  test('repos have owner, repo, addedAt fields', async ({ request }) => {
    const res = await request.get(`${API}/api/repos`)
    const repos = await res.json()
    if (!repos.length) return
    const r = repos[0]
    expect(r).toHaveProperty('owner')
    expect(r).toHaveProperty('repo')
    expect(r).toHaveProperty('addedAt')
  })

  test('POST /api/repos with invalid repo returns 422', async ({ request }) => {
    const res = await request.post(`${API}/api/repos`, {
      data: { owner: 'non-existent-user-xyz-9999', repo: 'no-such-repo' },
    })
    expect(res.status()).toBe(422)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })

  test('POST /api/repos without owner/repo returns 400', async ({ request }) => {
    const res = await request.post(`${API}/api/repos`, { data: {} })
    expect(res.status()).toBe(400)
  })

  test('can add and remove a repo', async ({ request }) => {
    // Clean state
    await request.delete(`${API}/api/repos/${OWNER}/${REPO}`)

    // Add
    const addRes = await request.post(`${API}/api/repos`, {
      data: { owner: OWNER, repo: REPO },
    })
    expect([201, 409]).toContain(addRes.status())

    // Should now be in list
    const listRes = await request.get(`${API}/api/repos`)
    const repos = await listRes.json()
    const found = repos.find(r => r.owner === OWNER && r.repo === REPO)
    expect(found).toBeTruthy()

    // Remove
    const delRes = await request.delete(`${API}/api/repos/${OWNER}/${REPO}`)
    expect(delRes.status()).toBe(200)

    // Should be gone
    const afterDel = await request.get(`${API}/api/repos`)
    const afterRepos = await afterDel.json()
    const stillThere = afterRepos.find(r => r.owner === OWNER && r.repo === REPO)
    expect(stillThere).toBeUndefined()

    // Re-add for subsequent tests
    await request.post(`${API}/api/repos`, { data: { owner: OWNER, repo: REPO } })
  })

  test('duplicate repo returns 409', async ({ request }) => {
    // Ensure repo exists
    await request.post(`${API}/api/repos`, { data: { owner: OWNER, repo: REPO } })

    const res = await request.post(`${API}/api/repos`, {
      data: { owner: OWNER, repo: REPO },
    })
    expect(res.status()).toBe(409)
  })
})
