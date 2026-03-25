/**
 * db.js — SQLite-backed local cache for issues + sync queue.
 *
 * Tables:
 *   issues           — cached GitHub issues per repo
 *   issue_relations   — parent-child sub-issue links (authoritative source)
 *   sync_queue        — pending writes to GitHub
 *   sync_log          — completed/failed sync operations (audit trail)
 *   issue_history     — version snapshots for edits/reverts
 *
 * Schema versioning: PRAGMA user_version tracks migration state.
 * Denormalized columns on issues (github_id, parent_number, children_total,
 * children_done) are read-caches populated from issue_relations.
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
  // v0: base tables (CREATE IF NOT EXISTS — always safe to re-run)
  db.exec(`
    CREATE TABLE IF NOT EXISTS issues (
      repo_key      TEXT NOT NULL,
      number        INTEGER NOT NULL,
      title         TEXT NOT NULL,
      body          TEXT DEFAULT '',
      state         TEXT DEFAULT 'open',
      column_name   TEXT DEFAULT 'todo',
      user_login    TEXT,
      assignees     TEXT DEFAULT '[]',
      labels        TEXT DEFAULT '[]',
      url           TEXT,
      created_at    TEXT,
      updated_at    TEXT,
      synced_at     TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (repo_key, number)
    );
    CREATE INDEX IF NOT EXISTS idx_issues_repo ON issues(repo_key, state);

    CREATE TABLE IF NOT EXISTS sync_queue (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_key      TEXT NOT NULL,
      operation     TEXT NOT NULL,
      payload       TEXT NOT NULL,
      status        TEXT DEFAULT 'pending',
      retries       INTEGER DEFAULT 0,
      error         TEXT,
      user_login    TEXT,
      created_at    TEXT DEFAULT (datetime('now')),
      processed_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_queue_status ON sync_queue(status, created_at);

    CREATE TABLE IF NOT EXISTS issue_history (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_key      TEXT NOT NULL,
      number        INTEGER NOT NULL,
      version       INTEGER NOT NULL,
      title         TEXT NOT NULL,
      body          TEXT DEFAULT '',
      edited_by     TEXT,
      edited_at     TEXT DEFAULT (datetime('now')),
      revert_of     INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_history_issue ON issue_history(repo_key, number, version);

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
  `)

  // ── Versioned migrations via PRAGMA user_version ──────────────────────────
  const currentVersion = db.pragma('user_version', { simple: true })

  if (currentVersion < 1) {
    // v1: sub-issues support
    try { db.exec('ALTER TABLE issues ADD COLUMN github_id INTEGER') } catch (_) {}
    try { db.exec('ALTER TABLE issues ADD COLUMN parent_number INTEGER DEFAULT NULL') } catch (_) {}
    try { db.exec('ALTER TABLE issues ADD COLUMN children_total INTEGER DEFAULT 0') } catch (_) {}
    try { db.exec('ALTER TABLE issues ADD COLUMN children_done INTEGER DEFAULT 0') } catch (_) {}

    db.exec(`
      CREATE TABLE IF NOT EXISTS issue_relations (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_key      TEXT NOT NULL,
        parent_number INTEGER NOT NULL,
        child_number  INTEGER NOT NULL,
        synced_from   TEXT DEFAULT 'github',
        created_at    TEXT DEFAULT (datetime('now')),
        UNIQUE(repo_key, parent_number, child_number)
      );
      CREATE INDEX IF NOT EXISTS idx_relations_parent ON issue_relations(repo_key, parent_number);
      CREATE INDEX IF NOT EXISTS idx_relations_child ON issue_relations(repo_key, child_number);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_relations_one_parent ON issue_relations(repo_key, child_number);
    `)

    db.pragma('user_version = 1')
    console.log('[db] migrated to schema v1 (sub-issues)')
  }

  if (db.pragma('user_version', { simple: true }) < 2) {
    // v2: enforce one-parent-per-child at DB level (prevents race condition)
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_relations_one_parent ON issue_relations(repo_key, child_number)`)
    db.pragma('user_version = 2')
    console.log('[db] migrated to schema v2 (one-parent constraint)')
  }
}

// ── Issue cache ────────────────────────────────────────────────────────────────

export function upsertIssues(repoKey, issues) {
  const db = getDb()
  const upsert = db.prepare(`
    INSERT INTO issues
      (repo_key, number, title, body, state, column_name, user_login,
       assignees, labels, url, created_at, updated_at, synced_at, github_id)
    VALUES
      (@repo_key, @number, @title, @body, @state, @column_name, @user_login,
       @assignees, @labels, @url, @created_at, @updated_at, datetime('now'), @github_id)
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
      synced_at   = datetime('now'),
      github_id   = COALESCE(excluded.github_id, issues.github_id)
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
        github_id: issue.githubId || issue.github_id || null,
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
    githubId: r.github_id,
    parentNumber: r.parent_number,
    childrenTotal: r.children_total || 0,
    childrenDone: r.children_done || 0,
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

// ── Sub-issue relations (issue_relations is authoritative source) ────────────

export function upsertRelation(repoKey, parentNumber, childNumber, syncedFrom = 'github') {
  try {
    getDb().prepare(`
      INSERT INTO issue_relations (repo_key, parent_number, child_number, synced_from)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(repo_key, parent_number, child_number) DO UPDATE SET
        synced_from = excluded.synced_from
    `).run(repoKey, parentNumber, childNumber, syncedFrom)
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint failed')) {
      throw new Error('Issue already has a parent (one-parent-per-child constraint)')
    }
    throw err
  }
}

export function deleteRelation(repoKey, parentNumber, childNumber) {
  getDb().prepare(`
    DELETE FROM issue_relations
    WHERE repo_key = ? AND parent_number = ? AND child_number = ?
  `).run(repoKey, parentNumber, childNumber)
}

export function getChildrenForParent(repoKey, parentNumber) {
  return getDb().prepare(`
    SELECT ir.child_number, i.title, i.state, i.column_name, i.user_login, i.github_id,
           i.assignees
    FROM issue_relations ir
    LEFT JOIN issues i ON i.repo_key = ir.repo_key AND i.number = ir.child_number
    WHERE ir.repo_key = ? AND ir.parent_number = ?
    ORDER BY ir.child_number ASC
  `).all(repoKey, parentNumber)
}

export function getParentForChild(repoKey, childNumber) {
  const row = getDb().prepare(`
    SELECT ir.parent_number, i.title, i.github_id
    FROM issue_relations ir
    LEFT JOIN issues i ON i.repo_key = ir.repo_key AND i.number = ir.parent_number
    WHERE ir.repo_key = ? AND ir.child_number = ?
  `).get(repoKey, childNumber)
  return row || null
}

export function getGithubId(repoKey, number) {
  const row = getDb().prepare(
    'SELECT github_id FROM issues WHERE repo_key = ? AND number = ?'
  ).get(repoKey, number)
  return row?.github_id || null
}

export function getAllRelations(repoKey) {
  return getDb().prepare(`
    SELECT parent_number, child_number FROM issue_relations WHERE repo_key = ?
  `).all(repoKey)
}

/** Delete relations not in the provided set of {parentNumber, childNumber} pairs */
export function reconcileRelations(repoKey, parentNumber, currentChildNumbers) {
  const db = getDb()
  const existing = db.prepare(`
    SELECT child_number FROM issue_relations
    WHERE repo_key = ? AND parent_number = ?
  `).all(repoKey, parentNumber).map(r => r.child_number)

  const toDelete = existing.filter(cn => !currentChildNumbers.includes(cn))
  if (toDelete.length > 0) {
    const del = db.prepare(`
      DELETE FROM issue_relations
      WHERE repo_key = ? AND parent_number = ? AND child_number = ?
    `)
    for (const cn of toDelete) del.run(repoKey, parentNumber, cn)
    console.log(`[db] reconciled: removed ${toDelete.length} stale relations from #${parentNumber}`)
  }
}

/** Recalculate denormalized children_total/children_done/parent_number from issue_relations */
export function refreshDenormalizedSubIssueData(repoKey) {
  const db = getDb()

  // Reset all parent/children fields
  db.prepare(`
    UPDATE issues SET parent_number = NULL, children_total = 0, children_done = 0
    WHERE repo_key = ?
  `).run(repoKey)

  // Set parent_number on children
  const relations = db.prepare(`
    SELECT parent_number, child_number FROM issue_relations WHERE repo_key = ?
  `).all(repoKey)

  const setParent = db.prepare(`
    UPDATE issues SET parent_number = ? WHERE repo_key = ? AND number = ?
  `)
  for (const r of relations) {
    setParent.run(r.parent_number, repoKey, r.child_number)
  }

  // Set children_total and children_done on parents
  const counts = db.prepare(`
    SELECT ir.parent_number,
           COUNT(*) as total,
           SUM(CASE WHEN i.column_name = 'done' THEN 1 ELSE 0 END) as done
    FROM issue_relations ir
    LEFT JOIN issues i ON i.repo_key = ir.repo_key AND i.number = ir.child_number
    WHERE ir.repo_key = ?
    GROUP BY ir.parent_number
  `).all(repoKey)

  const setCount = db.prepare(`
    UPDATE issues SET children_total = ?, children_done = ?
    WHERE repo_key = ? AND number = ?
  `)
  for (const c of counts) {
    setCount.run(c.total, c.done || 0, repoKey, c.parent_number)
  }
}

/** Quick update: recalculate children_done for a specific parent */
export function recalcParentChildrenDone(repoKey, parentNumber) {
  const db = getDb()
  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN i.column_name = 'done' THEN 1 ELSE 0 END) as done
    FROM issue_relations ir
    LEFT JOIN issues i ON i.repo_key = ir.repo_key AND i.number = ir.child_number
    WHERE ir.repo_key = ? AND ir.parent_number = ?
  `).get(repoKey, parentNumber)

  db.prepare(`
    UPDATE issues SET children_total = ?, children_done = ?
    WHERE repo_key = ? AND number = ?
  `).run(row.total, row.done || 0, repoKey, parentNumber)

  return { total: row.total, done: row.done || 0 }
}

export function hasPendingJobs(repoKey) {
  const row = getDb().prepare(`
    SELECT COUNT(*) as cnt FROM sync_queue
    WHERE repo_key = ? AND status IN ('pending', 'processing')
  `).get(repoKey)
  return row.cnt > 0
}

/** Check depth constraint: returns true if issue already has a parent */
export function issueHasParent(repoKey, number) {
  const row = getDb().prepare(`
    SELECT 1 FROM issue_relations WHERE repo_key = ? AND child_number = ?
  `).get(repoKey, number)
  return !!row
}
