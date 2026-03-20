# kanban-mvp

Kanban board MVP with 2-way GitHub Issues sync.

## gstack

Use the `/browse` skill from gstack for all web browsing (never use mcp__claude-in-chrome__* tools).

Available skills:
/office-hours, /plan-ceo-review, /plan-eng-review, /plan-design-review,
/design-consultation, /review, /ship, /browse, /qa, /qa-only, /design-review,
/setup-browser-cookies, /retro, /investigate, /document-release, /codex,
/careful, /freeze, /guard, /unfreeze, /gstack-upgrade

Skills directory: .claude/skills/gstack/

## Project goal
Kanban board where:
- Cards = GitHub Issues
- Columns = Issue labels (Todo, In Progress, Done)
- Drag card → update issue label via GitHub API
- Create card → create new GitHub Issue
- Close card → close issue on GitHub
- Webhook / polling for incoming changes from GitHub → update board
