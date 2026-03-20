# Architecture: Kanban MVP + GitHub Issues Sync

## Stack
- **Frontend:** React + Vite + @hello-pangea/dnd (drag-and-drop)
- **Backend:** Express.js (Node) — thin API proxy + polling scheduler
- **Auth:** GitHub Personal Access Token (stored server-side via .env)
- **Sync:** Polling GitHub REST API every 30s (no webhook needed for MVP)

## Columns → Labels mapping
| Column | GitHub Label |
|--------|-------------|
| Todo | `kanban:todo` |
| In Progress | `kanban:in-progress` |
| Done | `kanban:done` |

## Data flow

### Board → GitHub (user actions)
```
User drags card → PATCH /api/issues/:id/move { column }
  → Express removes old kanban:* label
  → Express adds new kanban:* label
  → GitHub API updates issue
```

```
User creates card → POST /api/issues { title, body }
  → Express creates GitHub issue
  → Adds kanban:todo label automatically
```

```
User closes card → PATCH /api/issues/:id/close
  → Express closes GitHub issue (state: closed)
```

### GitHub → Board (incoming sync)
```
Every 30s: GET /repos/:owner/:repo/issues?labels=kanban:*&state=open
  → Compare with current state
  → Emit SSE event to frontend if changed
  → Frontend updates board
```

## API Routes (Express)
```
GET  /api/issues          → fetch all open issues with kanban labels
POST /api/issues          → create issue + add kanban:todo label
PATCH /api/issues/:id/move → update label (move column)
PATCH /api/issues/:id/close → close issue
GET  /api/events          → SSE stream for real-time updates
GET  /api/config          → return repo info (owner/repo)
```

## File structure
```
kanban-mvp/
├── server/
│   ├── index.js          # Express app
│   ├── github.js         # GitHub API client
│   └── poller.js         # 30s polling + SSE
├── client/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── Board.jsx     # Main kanban board
│   │   ├── Column.jsx    # Single column
│   │   ├── Card.jsx      # Issue card
│   │   └── api.js        # fetch wrapper
│   └── index.html
├── .env.example
└── package.json
```

## MVP scope (what's IN)
- [x] Display issues as cards in 3 columns
- [x] Drag card between columns → updates GitHub label
- [x] Create new card (title only) → creates GitHub issue
- [x] Close card → closes GitHub issue
- [x] Auto-refresh every 30s from GitHub
- [x] Config via .env: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO

## OUT of scope (v2)
- OAuth flow (use PAT for now)
- Multiple repos
- Assignees / milestones on board
- Comments
- Webhooks (polling sufficient for MVP)
