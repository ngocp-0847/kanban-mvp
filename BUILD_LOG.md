# Build Log: Kanban MVP + GitHub Issues 2-way Sync
**Date:** 2026-03-20  
**Goal:** MVP Kanban board app, sync 2 chiều với GitHub Issues  
**Stack:** gstack (Garry Tan's Claude Code setup) + TBD

---

## 00:00 — Setup environment

### Tools
- Claude Code: 2.1.70
- OS: macOS 12.5 (Apple M1)
- Node: v24.13.0

### Step 1: Clone gstack
```bash
git clone https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
```
→ ✅ Clone OK

### Step 2: Run setup
```bash
cd ~/.claude/skills/gstack && ./setup
```
→ ❌ Error: `bun is required but not installed`

**Fix: install bun**

**Fix applied:**
```bash
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
bun --version  # → 1.3.11
cd ~/.claude/skills/gstack && ./setup
```
→ ✅ gstack ready  
→ Skills linked: browse, careful, codex, design-consultation, design-review, document-release, freeze, gstack-upgrade, guard, investigate, office-hours, plan-ceo-review, plan-design-review, plan-eng-review, qa-only, qa, retro, review, setup-browser-cookies, ship, unfreeze

---

## Step 3: Init project + GitHub repo


### Step 3 result
- Git repo init ✅
- GitHub repo created: https://github.com/ngocp-0847/kanban-mvp ✅
- gstack added to project ✅

---

## Step 4: /office-hours — Product definition via gstack CEO agent

**Prompt to Claude Code:**
> /office-hours — Build a Kanban board MVP with 2-way sync to GitHub Issues. 
> Cards = Issues. Columns = Labels or Milestones. Drag card → update issue label. 
> Create card → create issue. Close card → close issue.

**Running Claude Code with gstack...**


### Step 4 note
- Claude Code rate limit → wait 60s before retry
- gstack /office-hours sẽ define product + stack


---

## ✅ MVP Working — Test Results

### Server (port 4000)
- `GET /api/config` → ✅ returns owner/repo
- `GET /api/issues` → ✅ returns issues from GitHub (SSE + polling 30s)
- `POST /api/issues` → ✅ creates GitHub issue #1 with `kanban:todo` label
- `PATCH /api/issues/1/move` → ✅ moves to `kanban:in-progress` (label swap)
- SSE `/api/events` → ✅ real-time push to frontend

### Frontend (port 5173)
- React + Vite running ✅
- DragDropContext configured ✅
- Board / Column / Card components ✅

### GitHub sync verified
- Created issue → label `kanban:todo` added automatically ✅
- Move column → label swapped (`kanban:todo` → `kanban:in-progress`) ✅
- Polling every 30s picks up external GitHub changes ✅

---

## Architecture used
- Backend: Express + node-fetch + SSE (Server-Sent Events)
- Frontend: React 18 + @hello-pangea/dnd + Vite proxy
- Sync: Pull-based polling (30s) + SSE push to browser
- Auth: GitHub PAT in .env

