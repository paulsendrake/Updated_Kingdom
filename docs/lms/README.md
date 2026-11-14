# The LMS work: what is here, and the order to do it in

Everything in this folder is about the Learning module and nothing else. No
other module was touched — not giving, membership, events, orders, invoices,
subscriptions, payment methods, profile or the CRM. That was the constraint
the work was done under, and section 9 of each QA doc is how to confirm it.

Branch: `claude/lms-learning-tab`, four commits on top of `main`.

## Do these in order

1. **Apply the MySQL migration.** From the repository root:

       mysql <your-database> < server/vendor/kcc-lms/migrations/mysql/0002_question_banks.sql

   It adds one nullable column (`lms_quizzes.draw_size`) and creates one new
   table (`lms_quiz_draws`). It alters nothing else and touches no existing
   row. **The code reads both, so deploying before running this breaks every
   quiz read.** There is no automatic runner for the vendored module's
   migrations — this is a manual step.

2. **Deploy the branch.** Nothing to build for the LMS module: its `dist/`
   is committed, because the server has no build phase at deploy time. See
   `server/vendor/kcc-lms/VENDORED.md`.

3. **Work through the QA docs**, in this order:
   - `qa-learning-tab.md` — the bigger change. Start at section 0.
   - `qa-question-banks.md` — the quiz feature. Section 0 is a gate: if the
     migration did not land, stop there.

## What changed

Six files outside the vendored LMS module:

| File | What |
|---|---|
| `client/src/admin/components/LearningDrawer.jsx` | Catalogue browsing and search |
| `client/src/admin/pages/LmsCourseEditorPage.jsx` | "Questions Per Attempt" on the quiz modal |
| `client/src/admin/pages/portal/PortalLessonView.jsx` | Submitted work, double-submit guard, video progress fix |
| `client/src/admin/pages/portal/PortalTranscript.jsx` | Marks, certificates, assignments, quiz history |
| `server/src/routes/lms.js` | Marking queue queries, `drawSize` on the quiz schema |
| `server/src/routes/lmsPortal.js` | The endpoints the two portal pages read |

Plus the vendored module at `server/vendor/kcc-lms`, which gained question
banks: a quiz can now hold more questions than it asks, and each learner is
dealt a random subset. `VENDORED.md` in that folder records every way the
vendored copy differs from upstream — there is one seam, the `user_id`
columns, because learners here are `contacts` (int) and not `users` (uuid).

`gap-analysis.md` is the survey this came out of: what the learning tab had,
what the standalone LMS had, and what is still missing. It is the answer to
"flush out what all is needed". Two claims in an earlier draft of it were
wrong and are corrected in place, marked as corrections rather than quietly
edited.

## What is actually verified, and what is not

Be suspicious in proportion. The split is not even.

**Tested by running it.** The LMS module's own probe suite, which runs
against a real PostgreSQL: entitlement, progress, assessment, catalogue,
authoring, the HTTP adapter, the React components, migrations and install —
all green, including the question-bank behaviour. Several checks were
mutation-tested, meaning the code was deliberately broken to confirm the
check actually fails; where a check could not be made to fail it is called
out rather than counted.

**Checked without running it.** The committed `dist/` was rebuilt from the
committed `src/` and came out byte-identical, so what deploys is what the
source says. Every one of the 32 module functions the server calls resolves
to a real export. Both patch files apply cleanly and reproduce the branch
head exactly. The JSX parses.

**Not verified at all.** None of this has met MySQL, and none of it has been
opened in a browser. The environment it was written in has neither, and it
could not run your application. Every SQL statement in `lmsPortal.js` is
unexecuted; column names were read from your schema rather than assumed, but
that is reading, not evidence. Each QA doc
ends with a "what I could not check" section listing the specific things to
watch. Those are the parts most likely to bite.

## If you would rather patch than merge

`patches/01-learning-tab.patch` then `patches/02-question-banks.patch`, in
that order, with `git apply`. They were generated from this branch and
verified to reproduce it. Merging the branch is simpler and gets the same
result.
