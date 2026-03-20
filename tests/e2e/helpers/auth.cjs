/**
 * Auth helpers for E2E tests.
 * Uses GITHUB_TOKEN from .env to log in via the API directly.
 */
const path = require('path')
const fs = require('fs')

function getToken() {
  const envPath = path.join(__dirname, '../../../.env')
  const env = fs.readFileSync(envPath, 'utf8')
  const match = env.match(/^GITHUB_TOKEN=(.+)$/m)
  if (!match) throw new Error('GITHUB_TOKEN not found in .env')
  return match[1].trim()
}

/**
 * Log in via the /api/auth/login endpoint.
 * Returns the session cookie so it can be reused across requests.
 */
async function loginViaApi(request) {
  const token = getToken()
  const res = await request.post('http://localhost:4000/api/auth/login', {
    data: { token },
  })
  if (!res.ok()) throw new Error(`Login failed: ${res.status()}`)
  const body = await res.json()
  return body.user
}

/**
 * Log in through the UI (LoginPage form).
 */
async function loginViaUI(page) {
  const token = getToken()
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  // Wait for either login form or board (already logged in)
  const loginForm = page.locator('input[type="password"]')
  const board = page.locator('.board__columns')

  const which = await Promise.race([
    loginForm.waitFor({ timeout: 8000 }).then(() => 'login'),
    board.waitFor({ timeout: 8000 }).then(() => 'board'),
  ]).catch(() => 'login')

  if (which === 'board') return // already authenticated

  await loginForm.fill(token)
  await page.click('button[type="submit"]')
  await page.waitForSelector('.repo-tabs', { timeout: 10_000 })
}

module.exports = { loginViaApi, loginViaUI, getToken }
