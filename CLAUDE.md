# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Product

openPad (AI STUDY) is a product of **주식회사 와이주 (Whyzoo Inc.)**, Copyright 2026, released under
the Apache License 2.0. Keep the attribution in `NOTICE`, `LICENSE`, `README.md` and `package.json`
in step with any rebrand — `NOTICE` is the one the licence actually requires redistributors to carry.

## Overview

AI STUDY — a Trello-style shared board (`ewp` / "aiwall") for lectures to 한국동서발전 협력사 임직원. A single **teacher/admin** manages multiple boards; **guests** (수강생) join through an unguessable share link, get an emoji + nickname profile, and post cards, comments, and Q&A chat. Everything is server-rendered; state lives either in a local SQLite file plus an uploads directory (self-hosting) or in Postgres plus object storage (Supabase behind Vercel) — see the data layer below.

## Runtime & stack (read before writing code)

- **Next.js 16 (App Router, `output: "standalone"`, Turbopack) + React 19.** `AGENTS.md` warns this Next.js has breaking changes vs. training data — consult `node_modules/next/dist/docs/` before writing framework code. Note `params` is a `Promise` everywhere (`await context.params`).
- **The data layer is driver-agnostic and fully async.** `src/lib/db.ts` exposes `get/all/run/transaction`, all returning Promises. It dispatches to one of two drivers in `src/lib/driver.ts`: `node:sqlite` (`DatabaseSync`, the default for self-hosting — NOT better-sqlite3) or Postgres via `pg` when `DATABASE_URL` is set (Supabase behind Vercel). Write SQL once with `?` placeholders and syntax both engines accept; the Postgres adapter rewrites `?` to `$n`. Anything genuinely engine-specific lives in `driver.ts` or `src/lib/schema.ts` — never in a route.
  - Avoid `INSERT OR IGNORE` / `UPDATE OR IGNORE` (SQLite-only); use `ON CONFLICT DO NOTHING`.
  - `position` and other counters are `INTEGER`: Postgres tops out near 2.1 billion, so never store a `Date.now()` timestamp in one.
  - Queries inside `transaction()` are pinned to its connection via `AsyncLocalStorage`. Never call an async DB helper without awaiting it — a floating promise resolves after the transaction commits.
- Auth uses `jose` (HS256 JWT in httpOnly cookies); `bcryptjs` is a dependency but the admin password is compared with `timingSafeEqual` (see `checkAdminPassword`), not hashed.
- `zod` for validation, `qrcode` for share QR codes, `lucide-react` for icons, Tailwind v4 (`@tailwindcss/postcss`).

## Commands

```bash
npm run dev      # next dev (Turbopack)
npm run build    # next build (standalone)
npm run start    # next start
npm run lint     # eslint
docker compose up -d --build   # full prod build; publishes 127.0.0.1:7400 -> 3000
```

There is **no test framework** in this repo — do not assume `npm test` exists. Verify changes via `npm run build` / `npm run lint` and by exercising the running app.

## Environment variables

Copy `.env.example`. `SESSION_SECRET` (≥32 chars, throws in production if shorter) is required. `ADMIN_EMAIL` (default `admin@ai-study.local`) + `ADMIN_PASSWORD` seed the first super-admin instructor account on DB init (`seedAdminInstructor` in `db.ts`) — only runs if no admin exists yet. `SQLITE_PATH` (default `/data/aistudy.sqlite`) and `UPLOAD_DIR` (default `/data/uploads`) point at the persisted volume — in `compose.yaml` these live on the `ewp_data` volume mounted at `/data`.

## Architecture

### Two actors, three routes
- **Admin/teacher**: signs in at `/admin` (`AdminClient`), manages all boards, opens a board at `/board/[id]`.
- **Guest**: opens `/share/[token]` where `token` is the board's `share_token`.
- Both `/board/[id]` and `/share/[token]` render the same `BoardClient` with a different `mode` prop. `BoardClient` **polls `GET` every 5s** with `cache: "no-store"` — there are no websockets; realtime presence/chat is polling-based.

### Auth & identity (`src/lib/auth.ts`, `src/lib/access.ts`, `src/lib/accounts.ts`)
- **Instructor accounts** (`instructors` table): email + bcrypt password (`src/lib/password.ts`), `role` (`admin`|`instructor`), `status` (`pending`|`active`|`disabled`). Signup creates a `pending` account; a super-admin approves it. Session is the `aistudy_teacher` JWT cookie; `getInstructorSession()` re-checks the DB row each call (so demote/disable takes effect immediately). Member management lives under `/api/instructors`.
- Guest cookies: `aistudy_participant`, `aistudy_device` — signed JWTs. **Device-based auto-re-entry**: a guest's `device_id` cookie ties them to a `device_profiles` row (nickname + emoji), so returning visitors auto-enroll — except on password-protected boards, which never auto-enroll (`resolveParticipantForBoard(boardId, autoEnroll)`).
- **Board ownership & access**: `boards.owner_id` (creator), `boards.audience` (`link` = anyone with link incl. students, `members` = logged-in instructors only), `boards.access_password_hash` (optional student entry password, checked at join). `canManageBoard(board, session)` = owner or super-admin.
- `actorForBoard(board, requireWrite)` is the single gate for board content routes: owner/admin → teacher; members-only board + logged-in instructor → auto-enrolled member (`ensureMemberParticipant`); link board → student via device/profile flow. `boardManager(board)` gates board-management routes (settings/columns/revisions/delete). `requireWrite` enforces `share_mode === "write"`.

### Data layer
- **`src/lib/schema.ts`** owns the entire schema (`src/lib/db.ts` is now just the async facade). Tables are created with `CREATE TABLE IF NOT EXISTS`, and lightweight migrations run inline via the `addColumn` helper (checks `PRAGMA table_info` before `ALTER TABLE`). Add schema changes here — the table DDL is shared by both engines, and `addColumn`-style migrations use `driver.columns()` instead of `PRAGMA table_info`.
- **`src/lib/board-data.ts`** is the aggregation + write-side domain layer. `getBoardPayload` builds the full `BoardPayload` the client renders (cards + comments + activity + presence + chat, with author name/emoji resolved via joins). Admin-only fields (share token, activity log, revisions) are gated on `viewer.isAdmin`.
- Every mutating teacher action calls `recordAction`, which writes an `audit_logs` row and — for teachers — auto-creates a **board revision** snapshot (`createRevision`, full JSON of board/columns/cards/comments). `restoreRevision` replays a snapshot. Revisions are `auto` or `final`.
- `touchPresence` upserts into the `presence` table keyed by identity; `getBoardPayload` treats anyone seen in the last 30s as an active viewer.

### API conventions (`src/app/api/**/route.ts`)
- Return errors with `apiError(message, status, code)` from `src/lib/http.ts` (Korean user-facing messages).
- In-memory rate limiting via `rateLimited(key, limit, windowMs)` — process-local, resets on restart.
- External links must pass `safeHttpUrl` (http/https only). Uploaded files are written with the `wx` flag (fail if exists) and served from `/api/files/[id]` with an inline-vs-attachment content-type allowlist and `nosniff`. Guest uploads are capped at 10MB; teacher uploads are unlimited.
- File writes and the DB insert are wrapped so an orphaned upload is removed if the transaction throws.
- All file access goes through `src/lib/storage.ts`, which has a local-volume and a Supabase Storage implementation behind one interface. On object storage the browser uploads directly via a signed ticket (`/api/boards/[slug]/uploads`), because serverless caps request bodies at 4.5MB — below the 10MB attachment limit.
- Push updates (SSE) rely on an in-process EventEmitter, so `src/lib/runtime.ts` turns them off on serverless and the client falls back to its 15s poll. The login rate limiter likewise moves into the database there.

### Security posture
Global headers set in `next.config.ts` (`nosniff`, `X-Frame-Options: DENY`, referrer + permissions policy, `poweredByHeader: false`). Admin password uses constant-time comparison. Cookies are `httpOnly` + `sameSite: strict` and `secure` in production.
