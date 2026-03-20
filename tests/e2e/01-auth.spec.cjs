// @ts-check
const { test, expect } = require('@playwright/test')

const API = 'http://localhost:4000'

function getToken() {
  const fs = require('fs'), path = require('path')
  const env = fs.readFileSync(path.join(__dirname, '../../.env'), 'utf8')
  return env.match(/^GITHUB_TOKEN=(.+)$/m)[1].trim()
}

test.describe('Auth API', () => {
  test('GET /api/auth/me returns 401 when not logged in', async ({ request }) => {
    const res = await request.get(`${API}/api/auth/me`)
    expect(res.status()).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Not authenticated')
  })

  test('POST /api/auth/login with invalid token returns 401', async ({ request }) => {
    const res = await request.post(`${API}/api/auth/login`, {
      data: { token: 'ghp_invalid_token_definitely_fake_12345' },
    })
    expect(res.status()).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/GitHub rejected/i)
  })

  test('POST /api/auth/login with missing token returns 400', async ({ request }) => {
    const res = await request.post(`${API}/api/auth/login`, { data: {} })
    expect(res.status()).toBe(400)
  })

  test('POST /api/auth/login with valid token returns user', async ({ request }) => {
    const res = await request.post(`${API}/api/auth/login`, {
      data: { token: getToken() },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.user).toHaveProperty('login')
    expect(body.user).toHaveProperty('avatar_url')
    // Token must NOT be in response
    expect(JSON.stringify(body)).not.toContain('ghp_')
    expect(JSON.stringify(body)).not.toContain(getToken())
  })

  test('GET /api/auth/me returns user after login', async ({ request }) => {
    await request.post(`${API}/api/auth/login`, { data: { token: getToken() } })
    const res = await request.get(`${API}/api/auth/me`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.user.login).toBeTruthy()
  })

  test('POST /api/auth/logout destroys session', async ({ request }) => {
    await request.post(`${API}/api/auth/login`, { data: { token: getToken() } })
    await request.post(`${API}/api/auth/logout`)
    const res = await request.get(`${API}/api/auth/me`)
    expect(res.status()).toBe(401)
  })

  test('protected routes return 401 without session', async ({ request }) => {
    const routes = [
      '/api/repos',
      '/api/repos/ngocp-0847/kanban-mvp/issues',
    ]
    for (const route of routes) {
      const res = await request.get(`${API}${route}`)
      expect(res.status(), `${route} should be 401`).toBe(401)
    }
  })
})
