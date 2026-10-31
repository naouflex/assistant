# Migrating from Rakazo to Atlas

Atlas is derived from [Rakazo](https://github.com/elie222/rakazo) by elie222 (Apache 2.0, see
[NOTICE](NOTICE)). This fork renames the product, packages, settings and assets. An existing
Rakazo install keeps its data: the database, its users and the Postgres volume are not renamed.

## What keeps working without changes

- **Settings.** Every `ATLAS_*` setting falls back to the matching `RAKAZO_*` name
  (`packages/core/src/node/legacy-env.ts`, also used by `scripts/dev.mjs`, the web Vite config,
  the updater, the compose files and the host scripts in `infra/compose/*.sh`). When both are set,
  `ATLAS_*` wins.
- **Database.** `POSTGRES_USER`, `POSTGRES_DB`, `DATABASE_URL`, the `rakazo_app` role and the
  Prisma migration history are unchanged. Keep your existing values.
- **Bots.** Bots using the old `rakazo` avatar set are moved to `atlas` by the migration
  `20261111120000_atlas_avatar_set`, and the old value is still read as `atlas`.
- **Account exports.** Archives with format `rakazo-account-export` still import.

## Steps for an existing install

1. Stop the running app (`Ctrl+C` on `pnpm dev`, or stop your service). Do **not** run
   `pnpm compose:down`: it passes `-v` and deletes the Postgres volume.
2. Update the code (`git pull` or merge this branch), then:
   ```bash
   pnpm install          # packages moved from @rakazo/* to @atlas/*
   pnpm db:generate
   pnpm db:migrate       # pnpm dev also runs this on start
   pnpm sandbox:build    # builds atlas/computer:local
   ```
   Rebuild the computer image rather than retagging `rakazo/computer:local`: the image now uses
   the `atlas` user, `/home/atlas` and `x-atlas-*` control headers. Old computer containers are
   recreated on demand; bot workspaces live in the home store, not in the containers.
3. Optional: rename settings in `.env` (the old names keep working):
   ```bash
   sed -i.bak 's/^RAKAZO_/ATLAS_/' .env
   ```
   Also rename `RAKAZO_IMAGE=ghcr.io/elie222/rakazo/app` style values only if you build or pull
   images from `ghcr.io/naouflex/assistant/{app,computer,updater}`. Those images are published by
   this fork's CI and may not exist yet.
4. Start the app again (`pnpm dev`).

### Docker Compose installs

`infra/compose/images.yml` and `prod.yml` now declare `name: atlas` and `name: atlas-prod`
(previously `rakazo` and `rakazo-prod`). Compose prefixes volume names with the project name, so
set the old project name to keep using your existing volumes:

```bash
echo COMPOSE_PROJECT_NAME=rakazo >> .env        # images.yml installs
echo COMPOSE_PROJECT_NAME=rakazo-prod >> .env   # prod.yml installs
```

`docker-compose.yml` (local dev) has no project name, so nothing changes there.

Host scripts read root-owned settings from `/etc/atlas/*.env` (was `/etc/rakazo`). Move them:
`sudo mv /etc/rakazo /etc/atlas`. Variables already exported in the environment are aliased, but
files are read only from the new path.

## Renamed identifiers (one-time effects)

| Area | Before | After | Effect |
| --- | --- | --- | --- |
| Browser storage, cookies, mobile SecureStore keys | `rakazo.*` | `atlas.*` | Users sign in again; local UI preferences reset |
| HTTP headers | `x-rakazo-*` | `x-atlas-*` | Update reverse proxies or clients that set them |
| Docker labels on computers | `rakazo.*` | `atlas.*` | Old computer containers are no longer tracked; remove them once idle |
| Postgres notify channel, advisory lock names | `rakazo_*` | `atlas_*` | Restart api and worker together |
| Mobile URL scheme | `rakazo://` | `atlas://` | Old mobile builds cannot complete sign-in or billing callbacks |
| Bundle ids | `com.rakazo.*` | `com.naouflex.atlas.*` | New apps, separate from the App Store Rakazo app |
| Container images | `ghcr.io/elie222/rakazo/*`, `rakazo/computer:local` | `ghcr.io/naouflex/assistant/*`, `atlas/computer:local` | Rebuild or pull |
| Cloud sandbox workspace dir | `rakazo-home` | `atlas-home` | Workspaces are restored from the home store when a computer starts |
| Account export format | `rakazo-account-export` | `atlas-account-export` | Old archives still import |

The desktop app's environment variables (`ATLAS_DESKTOP_*`, development knobs only) have no
`RAKAZO_*` fallback.

## Not renamed on purpose

- `rakazo.com` links to upstream services and documentation.
- Prisma migrations (checksums), the `rakazo_app` role and the `rakazo_credit_cents` column.
- `LICENSE` (Apache 2.0, unchanged).
