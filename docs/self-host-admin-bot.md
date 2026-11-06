# Admin bot CLI (instructions, memory, and space skills)

Server-side maintenance tool bundled with the API (`dist/cli/admin-bot.js`). It lists and locates
bots for an owner account, exports current profile data and **durable knowledge-related records**,
and applies updates through the same persistence paths as the product API (no raw SQL).

Use it from the same environment as the API container or a source checkout: load `DATABASE_URL`,
content encryption keys, and optional key manager settings. Never paste secret bodies on the
command line; pass file paths for instruction, memory, and skill content.

## Identity and scope

Provide **either** `--owner-email` **or** `--owner-user-id` (stable account id from your admin
systems). You still scope writes to one Space with `--space-id` when the account belongs to more
than one Space, or when you need an explicit tenant.

- `list --all-spaces` prints bots per Space (read-only discovery).
- `find-bot --exact-name "…"` searches every Space the owner belongs to and returns
  `(spaceId, botId)` rows (all matches). When several bots share a name in one Space, pass
  `--space-id` plus `list` / `--bot-id`.

**Scope:** one owning user, one Space per command (except discovery helpers), and an explicit bot id
(`--bot-id`) for export and bot-scoped updates.

## Knowledge coverage in exports (version 2)

The export JSON includes:

| Section | Meaning |
| --- | --- |
| `bot` | Profile fields used here (instructions, instruction history, description, …) |
| `memoryDocuments` | Markdown files in Postgres for this bot (`MEMORY.md`, `journal/…`, etc.) — **primary place for bot “facts”**; updated via `MarkdownMemoryStore` |
| `knowledge.taughtSkills` | Per-bot **TaughtSkill** rows (recorded playbooks); JSON columns, not general text editing here |
| `knowledge.agentSkillsInSpace` | **AgentSkill** SKILL.md recipes available to this Space (owner-scoped); same catalog bots see for user skills |
| `knowledge.memoryProposalsPending` | Pending **MemoryProposal** rows (dream suggestions), full `content` included for review |
| `knowledge.memoryDreamsRecent` | Recent **MemoryDream** job metadata (not content proposals) |

This CLI edits **markdown memory** and **user AgentSkill** bodies via supported services. It does
**not** mutate `TaughtSkill` playbooks, dream jobs, or external memory providers—only reads them for
export. Cleaning “knowledge” that lives in a user **AgentSkill** uses `update-skill`; cleaning bot
markdown facts uses `update-memory`.

## Safety

- Default is **dry run**; add `--apply` to perform writes.
- Successful writes take a snapshot **after** commit; if that snapshot cannot be written, the CLI
  **rolls back** the just-applied change (instructions or memory) when possible, so you never sit in
  a “committed but not backed up” state without a matching error.
- Optional `--expected-instructions-file` must match current instructions byte-for-byte or the
  instruction update fails (**stale guard**).
- Optional `--expected-revision` on memory updates rejects concurrent edits.
- Stderr errors are **shortened and single-lined** so multi-line content is not echoed on failure.

## Commands

List bots in one Space (or `--all-spaces` for a multi-Space owner):

```bash
docker compose -f docker-compose.images.yml exec api \
  node dist/cli/admin-bot.js list --owner-user-id '<user-id>' --space-id '<space-id>'
```

Find a bot by exact name across all Spaces (fails if ambiguous):

```bash
node dist/cli/admin-bot.js find-bot --owner-user-id '<user-id>' --exact-name "Naoufel"
```

Export profile + memory + knowledge summary:

```bash
node dist/cli/admin-bot.js export \
  --owner-user-id '<user-id>' \
  --space-id '<space-id>' \
  --bot-id '<bot-id>' \
  --out /secure/before.json
```

Replace instructions (dry run):

```bash
node dist/cli/admin-bot.js update-instructions \
  --owner-user-id '<user-id>' \
  --space-id '<space-id>' \
  --bot-id '<bot-id>' \
  --instructions-file ./new-instructions.md
```

Apply with concurrency check (save current instructions first):

```bash
node dist/cli/admin-bot.js update-instructions --apply \
  --owner-user-id '<user-id>' \
  --space-id '<space-id>' \
  --bot-id '<bot-id>' \
  --instructions-file ./new-instructions.md \
  --expected-instructions-file ./current.txt \
  --backup-dir /secure/backups
```

Update the default bot memory file `MEMORY.md`:

```bash
node dist/cli/admin-bot.js update-memory --apply \
  --owner-user-id '<user-id>' \
  --space-id '<space-id>' \
  --bot-id '<bot-id>' \
  --content-file ./memory.md \
  --expected-revision 5 \
  --backup-dir /secure/backups
```

Edit a user **AgentSkill** (SKILL.md body) available in that Space:

```bash
node dist/cli/admin-bot.js update-skill --apply \
  --owner-user-id '<user-id>' \
  --space-id '<space-id>' \
  --skill-id '<skill-id>' \
  --skill-file ./SKILL.md \
  --backup-dir /secure/backups
```

## Deployment

Build the API package so `dist/cli/admin-bot.js` exists (`pnpm --filter @atlas/db generate` then
`pnpm --filter @atlas/api build`), then deploy the image like other CLI entrypoints.

## Integration test (disposable Postgres)

On a machine with local PostgreSQL and `sudo` peer access to `postgres`:

```bash
node apps/api/scripts/admin-bot-integration.mjs
```

This creates a throwaway database, runs migrations, executes `VERIFY_DATABASE=1` Vitest for this
CLI, then drops the database.
