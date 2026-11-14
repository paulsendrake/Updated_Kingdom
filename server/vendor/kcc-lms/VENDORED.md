# Vendoring notes

Source: https://github.com/paulsendrake/KCLMS, commit `d5570d4`
("Run on MySQL as well as PostgreSQL, with one set of rules"), plus the
question-banks change from branch `claude/question-banks` applied on top of
it, then commit `6f6e387` ("Say what happened when a learner's paper is
replaced under them") on top of that (see "Question banks" below).

This is a vendored copy, not an npm dependency, because the one seam the
module asks integrators to edit — the `user_id` columns — needed a real
edit for this host. See the README's own "Installing" section for why
vendoring is one of the three supported ways to consume this module.

## What was changed from upstream

1. **`migrations/mysql/0001_lms.sql`** — the three `user_id` columns
   (`lms_cohort_members`, `lms_lesson_progress`, `lms_quiz_attempts`) and
   `lms_courses.created_by` changed from `char(36)` to `varchar(20)`, and
   the `foreign key ... references users (id)` constraints were dropped.

   Kingdom Connections' learners are `contacts` (church members), not
   `users` (internal staff), and `contacts.id` is `int unsigned
   auto_increment` — not a 36-character UUID. MySQL will not let a
   `varchar` column carry a real foreign key against an `int unsigned`
   one, so referential integrity here is enforced by the application
   (always write an id that exists in `contacts`) rather than the
   database. This CRM never hard-deletes a contact row (donation and
   membership history must be retained for compliance), so the
   `on delete cascade` this would otherwise provide isn't needed in
   practice — there's no delete path that would trigger it.

   A staff account acting as instructor or admin passes its own
   `users.contact_id` (already present in the host schema) as the viewer
   id, rather than getting a second identity scheme.

2. **`src/schema/mysql.ts`** — same three columns plus `created_by`
   changed from `char(..., {length:36})` to `varchar(..., {length:20})`
   via a new `userRef()` helper (the existing `ref()` helper, used for
   every other id in the schema, is untouched). `HOST_USERS_TABLE` updated
   to `'contacts'` for documentation accuracy; it isn't used for a real DB
   constraint anywhere so this is cosmetic.

3. **`src/schema/mysql.ts` and `migrations/mysql/0002_question_banks.sql`**
   — the new `lms_quiz_draws.user_id` follows the same seam as the three
   columns above: `varchar(20)`, no foreign key. It is a learner column like
   any other, so leaving it `char(36)` would have given this host a table
   whose `user_id` could never match a contact.

Nothing else was touched. The services, ports, store interface, Postgres
schema/migration, and Drizzle store implementation are byte-for-byte
upstream at the commit named above, with the question-banks change applied.

## Question banks

Vendored from `claude/question-banks` rather than from a released upstream
commit, because it was written for this host's benefit and upstream has
since moved on in ways this app is not ready for — the module's `dist/`
layout changed from flat to `dist/esm` + `dist/cjs`, and
`server/src/lms/runtime.js` imports `dist/index.js` directly. Taking
upstream wholesale would break that import and drag in an HTTP layer, a
browser client and React components this server does not use.

So this is deliberately a narrow vendor: the question-banks commit applied
to `d5570d4`, built with this directory's own `tsconfig.build.json`, which
keeps the flat `dist/` the server expects.

What it adds:

* `lms_quizzes.draw_size` — null (the default) means ask every question, as
  before. Set it and the quiz becomes a bank: each learner is dealt that
  many of its questions.
* `lms_quiz_draws` — the hand a learner was dealt. A paper is read in one
  request and answered in another, so the draw has to be written down;
  otherwise a refresh reshuffles it and the answers are marked against
  questions nobody was asked.
* `ports.random` — alongside `ports.clock`, so a deliberately random feature
  can be asserted in a test.

Marking is scoped to the drawn questions. Scoring against the whole bank
counts the unasked ones as wrong, which turns a learner who answered all of
their questions correctly into a fail.

Saving a quiz replaces its questions outright, so every save mints new
question ids and invalidates any draw dealt before it. Reading the paper
again deals a fresh hand; submitting one dealt before the save cannot be
marked, and says so ("This quiz changed while you were taking it...")
rather than claiming the quiz has no questions.

`draw_size` is set from the course editor, next to Passing Score and Max
Attempts, as "Questions Per Attempt" — blank there means ask every
question. Both sides refuse a draw bigger than the bank; the module's
refusal is the authority and the editor's is only there to save a round
trip.

**Apply `migrations/mysql/0002_question_banks.sql` before deploying this.**
The code reads `draw_size` and `lms_quiz_draws`; without the migration every
quiz read fails.

## Build

The module ships TypeScript source with `emitDeclarationOnly: true` (it
expects a TypeScript-native or bundler-based consumer). This server is
plain CommonJS JavaScript with no build step, so `dist/` here is compiled
ahead of time with `tsconfig.build.json` (module: NodeNext, actual JS
emitted) and **committed** — Railway's deploy doesn't run a build step for
this server and may install with devDependencies skipped, so regenerating
`dist/` at deploy time isn't reliable. `typescript` stays a devDependency;
it's only needed locally to regenerate `dist/` after a vendored update.

Regenerate after changing anything under `src/`:

```bash
cd server
npx tsc -p vendor/kcc-lms/tsconfig.build.json
```

`dist/` is ESM (`"type": "module"` applies to everything under this
directory per Node's nearest-`package.json` rule). Load it from the
server's CommonJS code with a dynamic `import()`, not `require()`.

## Updating from upstream

Re-apply the two edits above to any new vendored copy — they're small and
isolated by design (see the README's own "If not" column for the seam).
Diff this directory against a fresh clone of the source repo to confirm
nothing else drifted before overwriting.
