# QA for question banks and the quiz-editor field

This covers `kc-question-banks.patch`, which goes on **after**
`kc-learning-tab.patch`. It adds one feature: a quiz can hold more questions
than it asks. Set a number and each learner is dealt that many at random.

Everything here is unexecuted. There is no MySQL and no browser in the
environment this was written in, so the module below is tested — its own
probe suite runs green on PostgreSQL, including the question-bank checks —
but the MySQL schema, the route and the editor field are reviewed and parsed,
not run. Treat section 0 as a gate: if it fails, nothing after it matters.

## 0. The migration, then it starts

**Apply the migration first.** From the repository root:

    mysql <your-database> < server/vendor/kcc-lms/migrations/mysql/0002_question_banks.sql

It adds `lms_quizzes.draw_size` (nullable int) and creates `lms_quiz_draws`.
Nothing else is altered and no existing row is touched. Without it, every
quiz read fails, because the code now selects `draw_size`.

Check it landed:

    describe lms_quizzes;        -- draw_size, int, YES null
    describe lms_quiz_draws;     -- id, quiz_id, user_id, question_ids, drawn_at, attempt_id

`lms_quiz_draws.user_id` must be **varchar(20)**, not char(36). It holds a
contact id, like the three learner columns in `0001`. If it came out
char(36), the wrong migration file was applied.

Then start the server and open an existing quiz in the course editor. It
should look and behave exactly as before, with one new field. Every quiz in
the database has `draw_size` null, which means "ask every question" — the
behaviour that shipped before this patch. **If anything about an existing
quiz has changed, stop here**: null is meant to be a complete no-op.

## 1. The new field

Admin, a course, a lesson, the quiz modal. Beside Passing Score and Max
Attempts there is now **Questions Per Attempt**. The three share the row, so
on a narrow window they stack rather than crowd.

Empty is the default, and the placeholder reads "All 6" on a six-question
quiz. The help text under it names the same number. Add or remove a question
and both should follow — they are read from the questions on screen, not
from what was saved.

Save with it empty and reopen: **still empty**. That round trip is worth
doing on purpose. Empty travels to the server as null and comes back as
null, and the box has to turn that back into empty rather than into the
text "null" or a 0 — either of which an author would then save without
noticing.

## 2. Making a bank

On a quiz with six questions, set Questions Per Attempt to **2** and save.

Now sit it as a learner (portal, the lesson, the quiz). You should be asked
**two** questions, not six, and the numbering should say so.

**Refresh the page before answering.** You must get the *same two
questions*. This is the single most important check in this document. A
paper is read in one request and answered in another, so the draw is written
to `lms_quiz_draws` rather than made fresh each read — if a refresh reshuffles
it, the answers posted back are marked against questions the learner was
never shown, and the score is nonsense. One row should exist:

    select question_ids, attempt_id from lms_quiz_draws where quiz_id = '<id>';

## 3. Marking is over the paper they sat

Answer both questions correctly and submit. The score must be **100**.

This is the bug the feature could easily have had. Scoring against all six
counts the four unasked ones as wrong, and a learner who answered everything
they were shown correctly is told they scored 33 and failed. The review
screen afterwards should list **two** rows, not six.

Then answer one of two correctly on a later sitting: 50, not 17.

## 4. A spent draw is not reused

Set Max Attempts to 0 (unlimited) on the bank quiz and sit it twice.

The second sitting deals a fresh hand. It is random, so it may well include
one or both of the same questions — that is not a fault. What must not
happen is being handed the *spent* paper back, or being told there is
nothing to answer. After two sittings:

    select attempt_id, question_ids from lms_quiz_draws where quiz_id = '<id>';

Every draw that was submitted carries the `attempt_id` it was marked under.
At most one row has `attempt_id` null, and only if a paper is currently on
screen unanswered — reading the quiz page deals that hand, so if you
navigated away after submitting there should be none.

## 5. Editing a quiz while somebody is mid-attempt

Worth doing once deliberately, because it is the roughest edge in here.

Open the bank quiz as a learner and leave it on screen without submitting.
As an admin, save that quiz (any change, or none). Now submit as the learner.

Saving replaces a quiz's questions outright — the module deletes them and
writes new rows with new ids — so the paper on the learner's screen no
longer exists. They should see:

> This quiz changed while you were taking it. Reload the lesson to be given
> a fresh set of questions.

and reloading should hand them a usable paper. Before this patch's module
update the same situation said *"That quiz has no questions yet"*, which is
untrue of a quiz holding six and tells the learner nothing they can act on.

No attempt should be recorded for the failed submit.

## 6. A draw bigger than the bank

On a six-question quiz, type **9** into Questions Per Attempt and save. It
should refuse, in the editor, without a round trip:

> This quiz asks for 9 questions but only has 6.

Then remove a question so the bank is five, with the field still reading 6,
and save. It should refuse the same way — the check counts the questions on
screen, not the ones that were there when the modal opened.

The module refuses this too, with the same wording, and that refusal is the
real one; the editor's copy only saves a trip to the server. To see the
module's own, set `draw_size` past the question count directly in SQL and
save the quiz from the editor.

Typing **0**, or a decimal, should behave sensibly: 0 means the same as
blank (ask everything), and a decimal is refused rather than rounded
silently.

## 7. Nothing else moved

The only files outside the vendored module are
`server/src/routes/lms.js` (one field added to the quiz schema) and
`client/src/admin/pages/LmsCourseEditorPage.jsx` (the field, and the check
before posting). Quizzes with `draw_size` null — which is all of them until
somebody sets one — take the same code path they did before.

Confirm the other modules are untouched: giving, membership, events,
orders, invoices, subscriptions, payment methods, profile, and the CRM.

## What I could not check, and you should watch

- **MySQL has had no execution at all.** The module's probe suite proves
  these rules against a real PostgreSQL, including the bank behaviour in
  sections 2 to 6. The MySQL schema and migration are the same rules
  written for the other engine, read against this app's existing tables —
  but they have not met a MySQL server. `question_ids` is a `json` column;
  if the driver ever handed it back as a string instead of an array, the
  code guards against iterating its characters, but that guard is reasoning,
  not evidence.
- **`drawn_at` ties.** The open draw is chosen by newest `drawn_at`. Two
  draws for the same learner and quiz in the same instant would make the
  choice arbitrary. It takes a learner reloading a lesson twice in the same
  tick to produce, and either draw is a valid paper, so the worst case is
  the pair of questions they see. Worth knowing it is there.
- **A draw survives a lowered draw size.** If a learner has a paper of
  eight open and an admin lowers the field to four, that learner still
  sits eight — their draw is intact, so nothing forces a re-deal. Their
  next sitting gets four. This is deliberate (the alternative is changing
  a paper under somebody mid-attempt), but it will look like the setting
  did not take.
- **The editor field is parsed, not rendered.** It was syntax-checked with
  the TypeScript parser rather than opened in a browser. The three-column
  row is Bootstrap's `col-md-4`, matching the pattern used elsewhere on the
  same modal, but no one has looked at it on a phone.
