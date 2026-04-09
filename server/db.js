/**
 * db.js — SQLite-backed local cache for issues + sync queue.
 *
 * Tables:
 *   issues          — cached GitHub issues per repo
 *   sync_queue      — pending writes to GitHub (move, close, create, comment)
 *   sync_log        — completed/failed sync operations (audit trail)
 */

import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dir, 'kanban.db')

let _db

export function getDb() {
  if (_db) return _db
  _db = new Database(DB_PATH)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  migrate(_db)
  return _db
}

function migrate(db) {
  db.exec(`
    -- Cached issues from GitHub
    CREATE TABLE IF NOT EXISTS issues (
      repo_key      TEXT NOT NULL,         -- "owner/repo"
      number        INTEGER NOT NULL,
      title         TEXT NOT NULL,
      body          TEXT DEFAULT '',
      state         TEXT DEFAULT 'open',   -- open | closed
      column_name   TEXT DEFAULT 'todo',   -- todo | in-progress | done
      user_login    TEXT,
      assignees     TEXT DEFAULT '[]',     -- JSON array
      labels        TEXT DEFAULT '[]',     -- JSON array of label names
      url           TEXT,
      created_at    TEXT,
      updated_at    TEXT,
      synced_at     TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (repo_key, number)
    );

    CREATE INDEX IF NOT EXISTS idx_issues_repo ON issues(repo_key, state);

    -- Sync queue — pending GitHub writes
    CREATE TABLE IF NOT EXISTS sync_queue (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_key      TEXT NOT NULL,
      operation     TEXT NOT NULL,   -- move | close | create | comment | assignees | labels
      payload       TEXT NOT NULL,   -- JSON
      status        TEXT DEFAULT 'pending',  -- pending | processing | done | failed
      retries       INTEGER DEFAULT 0,
      error         TEXT,
      user_login    TEXT,            -- who triggered this
      created_at    TEXT DEFAULT (datetime('now')),
      processed_at  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_queue_status ON sync_queue(status, created_at);

    -- Issue edit history — snapshot before every title/body edit
    CREATE TABLE IF NOT EXISTS issue_history (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_key      TEXT NOT NULL,
      number        INTEGER NOT NULL,
      version       INTEGER NOT NULL,       -- 1-based, auto-incremented per issue
      title         TEXT NOT NULL,
      body          TEXT DEFAULT '',
      edited_by     TEXT,                   -- GitHub login of editor
      edited_at     TEXT DEFAULT (datetime('now')),
      revert_of     INTEGER                 -- id this revert was sourced from (NULL = original edit)
    );

    CREATE INDEX IF NOT EXISTS idx_history_issue ON issue_history(repo_key, number, version);

    -- Sync log — completed operations (for audit / debug)
    CREATE TABLE IF NOT EXISTS sync_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_key      TEXT NOT NULL,
      operation     TEXT NOT NULL,
      payload       TEXT,
      result        TEXT,
      status        TEXT,
      user_login    TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    -- Gantt project cache — cached GitHub Projects v2 data
    CREATE TABLE IF NOT EXISTS gantt_project_cache (
      project_key   TEXT PRIMARY KEY,          -- "org/number"
      meta_json     TEXT,
      items_json    TEXT,
      tree_json     TEXT,
      fetched_at    TEXT DEFAULT (datetime('now'))
    );
  `)
}

// ── Issue cache ────────────────────────────────────────────────────────────────

export function upsertIssues(repoKey, issues) {
  const db = getDb()
  const upsert = db.prepare(`
    INSERT INTO issues
      (repo_key, number, title, body, state, column_name, user_login,
       assignees, labels, url, created_at, updated_at, synced_at)
    VALUES
      (@repo_key, @number, @title, @body, @state, @column_name, @user_login,
       @assignees, @labels, @url, @created_at, @updated_at, datetime('now'))
    ON CONFLICT(repo_key, number) DO UPDATE SET
      title       = excluded.title,
      body        = excluded.body,
      state       = excluded.state,
      column_name = excluded.column_name,
      user_login  = excluded.user_login,
      assignees   = excluded.assignees,
      labels      = excluded.labels,
      url         = excluded.url,
      updated_at  = excluded.updated_at,
      synced_at   = datetime('now')
  `)

  const tx = db.transaction((items) => {
    for (const issue of items) {
      upsert.run({
        repo_key: repoKey,
        number: issue.number,
        title: issue.title,
        body: issue.body || '',
        state: issue.state || 'open',
        column_name: issue.column || 'todo',
        user_login: issue.user || null,
        assignees: JSON.stringify(issue.assignees || []),
        labels: JSON.stringify(issue.labels || []),
        url: issue.url || null,
        created_at: issue.createdAt || issue.created_at || null,
        updated_at: issue.updatedAt || issue.updated_at || null,
      })
    }
  })
  tx(issues)
}

export function getIssuesFromDb(repoKey) {
  const db = getDb()
  const rows = db.prepare(`
    SELECT * FROM issues
    WHERE repo_key = ? AND state = 'open'
    ORDER BY number DESC
  `).all(repoKey)

  return rows.map(r => ({
    id: r.number,   // frontend uses id for drag/drop key
    number: r.number,
    title: r.title,
    body: r.body,
    column: r.column_name,
    url: r.url,
    user: r.user_login,
    assignees: JSON.parse(r.assignees || '[]'),
    labels: JSON.parse(r.labels || '[]'),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    _syncedAt: r.synced_at,
  }))
}

export function updateIssueColumn(repoKey, number, column) {
  getDb().prepare(`
    UPDATE issues SET column_name = ?, updated_at = datetime('now')
    WHERE repo_key = ? AND number = ?
  `).run(column, repoKey, number)
}

export function markIssueClosed(repoKey, number) {
  getDb().prepare(`
    UPDATE issues SET state = 'closed', updated_at = datetime('now')
    WHERE repo_key = ? AND number = ?
  `).run(repoKey, number)
}

export function insertIssue(repoKey, issue) {
  upsertIssues(repoKey, [issue])
}

// ── Sync queue ─────────────────────────────────────────────────────────────────

export function enqueue(repoKey, operation, payload, userLogin = null) {
  const id = getDb().prepare(`
    INSERT INTO sync_queue (repo_key, operation, payload, user_login)
    VALUES (?, ?, ?, ?)
  `).run(repoKey, operation, JSON.stringify(payload), userLogin).lastInsertRowid

  console.log(`[queue] enqueued #${id} ${operation} for ${repoKey}`)
  return id
}

export function getPendingJobs(limit = 20) {
  return getDb().prepare(`
    SELECT * FROM sync_queue
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT ?
  `).all(limit)
}

export function markJobProcessing(id) {
  getDb().prepare(`UPDATE sync_queue SET status = 'processing' WHERE id = ?`).run(id)
}

export function markJobDone(id, result) {
  getDb().prepare(`
    UPDATE sync_queue
    SET status = 'done', processed_at = datetime('now'), error = NULL
    WHERE id = ?
  `).run(id)
  // Archive to log
  const job = getDb().prepare('SELECT * FROM sync_queue WHERE id = ?').get(id)
  if (job) {
    getDb().prepare(`
      INSERT INTO sync_log (repo_key, operation, payload, result, status, user_login)
      VALUES (?, ?, ?, ?, 'done', ?)
    `).run(job.repo_key, job.operation, job.payload, JSON.stringify(result), job.user_login)
  }
}

export function markJobFailed(id, error) {
  const job = getDb().prepare('SELECT * FROM sync_queue WHERE id = ?').get(id)
  if (!job) return
  const retries = (job.retries || 0) + 1
  const maxRetries = 3
  const status = retries >= maxRetries ? 'failed' : 'pending'

  getDb().prepare(`
    UPDATE sync_queue
    SET status = ?, retries = ?, error = ?, processed_at = datetime('now')
    WHERE id = ?
  `).run(status, retries, String(error), id)

  if (status === 'failed') {
    getDb().prepare(`
      INSERT INTO sync_log (repo_key, operation, payload, result, status, user_login)
      VALUES (?, ?, ?, ?, 'failed', ?)
    `).run(job.repo_key, job.operation, job.payload, String(error), job.user_login)
  }
}

export function getQueueStats(repoKey = null) {
  const db = getDb()
  const where = repoKey ? 'WHERE repo_key = ?' : ''
  const args = repoKey ? [repoKey] : []
  return db.prepare(`
    SELECT status, COUNT(*) as count
    FROM sync_queue ${where}
    GROUP BY status
  `).all(...args)
}

// ── Issue history ──────────────────────────────────────────────────────────────

/**
 * Snapshot current title/body BEFORE applying an edit.
 * Auto-increments version number per (repo_key, number).
 */
export function snapshotIssue(repoKey, number, { title, body, editedBy, revertOf = null }) {
  const db = getDb()
  const { maxVer } = db.prepare(`
    SELECT COALESCE(MAX(version), 0) as maxVer
    FROM issue_history
    WHERE repo_key = ? AND number = ?
  `).get(repoKey, number)

  const version = maxVer + 1
  db.prepare(`
    INSERT INTO issue_history (repo_key, number, version, title, body, edited_by, revert_of)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(repoKey, number, version, title, body || '', editedBy || null, revertOf)

  return version
}

/** Get full history for an issue, newest first */
export function getIssueHistory(repoKey, number) {
  return getDb().prepare(`
    SELECT * FROM issue_history
    WHERE repo_key = ? AND number = ?
    ORDER BY version DESC
  `).all(repoKey, number)
}

/** Get one specific version */
export function getHistoryVersion(repoKey, number, version) {
  return getDb().prepare(`
    SELECT * FROM issue_history
    WHERE repo_key = ? AND number = ? AND version = ?
  `).get(repoKey, number, version)
}

export function getRecentLog(repoKey, limit = 20) {
  const db = getDb()
  return db.prepare(`
    SELECT * FROM sync_log
    WHERE repo_key = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(repoKey, limit)
}
