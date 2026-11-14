# QA for the learning-tab patch

Everything in `kc-learning-tab.patch` is reviewed and parsed, **not run** —
the environment it was written in refuses to execute freshly-cloned external
code, so the server was never started against it. This is the list of what to
check, and what the right answer is.

Order matters a little: 1 and 2 need no special data, the rest need a state
set up.

## 0. It applies and starts

```
git apply --check kc-learning-tab.patch   # should print nothing
git apply kc-learning-tab.patch
```

Three files change: `server/src/routes/lmsPortal.js`,
`client/src/admin/components/LearningDrawer.jsx`,
`client/src/admin/pages/portal/PortalTranscript.jsx`. Nothing else. If the
server does not boot, the fault is in the route file — it is the only one
with new SQL.

## 1. Browse still works, and now searches

Open the portal, click **Learning** in the sidebar.

- My Courses above is unchanged.
- Browse Courses below lists published courses you are **not** enrolled on.
- A search box sits above the list. Typing filters it, about a quarter of a
  second after you stop.
- Price badges still read **Free** or an amount. *This is the one most likely
  to regress: browsing used to come from `/lms-checkout/courses`, which
  carried pricing, and now comes from `/portal/lms/catalogue`, which looks
  pricing up separately. A course with a price showing "Free" means that
  lookup is wrong.*
- The count beside the heading reads "N in the catalogue" with the box empty
  and "N match" once you type. It counts courses you are enrolled on too, so
  it can legitimately exceed the number of cards.

**The failure case worth forcing.** Stop the API, or break the route
deliberately, and reopen the drawer. It must say *"Could not load the course
list just now"* — **not** "No other courses are available right now." A
failed request is not an empty catalogue and must never be shown as one.

## 2. The transcript shows marks

Go to **My transcript**.

- The table has a **Marked** column.
- A course with graded work shows a percentage and "N pieces marked".
- A course with none shows a dash, not a zero. *0% and "not marked yet" are
  different claims.*
- The average in the stat row is weighted by how many pieces were marked, so
  it will not always equal the mean of the column.

## 3. Certificates are listed, not counted

With at least one completed course:

- A **Certificates** section appears under the table.
- Each row shows the course, the certificate number and the issue date.
- **Open** goes to the course, where the existing download lives.
- The certificate count in the stats matches the number of rows.

## 4. Assignments, split by whose move it is

Set up, on a course the learner is entitled to:

| State to create | Should appear as |
|---|---|
| assignment lesson, published, never handed in | **To do** |
| assignment handed in, not yet marked | **Waiting to be marked** |
| assignment handed in and graded | **absent** — it is finished |
| assignment in a course they are *not* entitled to | **absent** — must never leak |

**The edge case that was wrong and is now fixed.** Submit the same assignment
**twice** without marking either. It must appear **once**, as "Waiting to be
marked". Before the fix it appeared twice, because the table has no unique
key on (lesson_id, contact_id), the insert is unguarded, and the join
returned a row per submission. Worth forcing, because resubmission after
feedback is how the feature is meant to work.

Also check a lesson with one graded submission **and** a later pending one: it
should show once, as "Waiting to be marked".

## 5. Quiz results survive the day they were sat

Sit a quiz, then navigate away and return to the transcript.

- A **Quiz results** section lists it with the score.
- The badge is green when passed, red when not.
- "pass N%" underneath matches the quiz's configured passing score.
- Sitting the same quiz three times gives three rows, newest first.
- The quiz title links back to its lesson.

## 6. The lesson view: your own work, and no double submit

On an **assignment** lesson:

- Before submitting, the form is as it was.
- After submitting, the "waiting to be marked" notice now carries a
  collapsed **What you submitted** with the date. Open it: your text should
  be there, with its line breaks intact.
- Once marked, the score and feedback show as before, with the same
  collapsed section underneath. *This is the point: somebody reading "this
  does not answer the second part" previously had no way to see what they
  had written.*

**The double-submit window, which is the one worth forcing.** Throttle the
network (DevTools, "Slow 3G") and click **Submit** once. The button should
stay disabled and the form should stay gone until the reload finishes — it
must not flicker back to an editable form with your text still in it. Before
this change it did, and a second click there wrote a second row, because
lms_lesson_submissions has no unique key on (lesson_id, contact_id) and the
insert is unguarded.

Then check the marker's queue shows the assignment **once**.

Note what is deliberately *not* changed: a graded assignment still cannot be
resubmitted. The status column is `ENUM('pending','graded')` with no
"returned for revision", so a mark is final by design. If staff want to send
work back, that is a schema change and a product decision, not a UI fix.

## 7. Video progress is kept, and kept against the right lesson

This is the highest-consequence fix in the patch and the hardest to see, so
it is worth doing properly. Use a course with two video lessons, A and B.

**Short watch, then move on.** Play lesson A for about seven seconds — under
the ten-second reporting threshold — then click straight through to lesson
B. Go back to A. Its progress should show those seconds. Before this change
nothing was recorded at all, because the final report only ran when the
component unmounted and moving between lessons on this route reuses it.

**The misattribution, which matters more.** Play A for a few seconds, go to
B, do not play B, then leave the portal entirely (or close the tab). Check
B's progress. It must be **zero**. Before this change `currentTimeRef` still
held A's seconds while `lessonIdRef` had moved to B, so the flush on unmount
recorded A's watch time against B — a lesson nobody had played.

Check in the database if the UI is ambiguous:

```sql
SELECT lesson_id, seconds_watched, last_position_seconds
  FROM lms_lesson_progress WHERE user_id = '<contact id>';
```

**It cannot go backwards.** Watch A for a minute, leave, come back and watch
five seconds. `seconds_watched` must not drop. The store writes it with
`GREATEST(existing, new)`, so this should hold — the change makes reports
more frequent, not larger, and it is worth confirming once since frequency
is what changed.

## 8. The marking queue, and the duplicate that could get stuck

**One outstanding hand-in at a time.** With an assignment already submitted
and unmarked, POST the same lesson again directly — the UI hides the form, so
this needs curl or the network tab:

```
POST /api/portal/lms/lessons/<lessonId>/submissions   {"bodyText":"again"}
```

It must come back **409**, saying it is already submitted and waiting to be
marked, and no second row may appear. Before this, the second POST wrote one:
the marker's queue showed the same work twice, grading one completed the
lesson, and the other stayed pending for ever because nothing revisits it.

If any duplicates already exist in the database from before this patch, they
are still there — this stops new ones, it does not clean up old ones. Worth
checking once:

```sql
SELECT lesson_id, contact_id, COUNT(*) FROM lms_lesson_submissions
 WHERE status = 'pending' GROUP BY lesson_id, contact_id HAVING COUNT(*) > 1;
```

**The queue still reads correctly.** Open the marking page. Each pending
submission shows its learner, lesson and course title exactly as before — the
queries behind it were narrowed to the lessons actually in the queue, so the
*output* should be identical. If a course or lesson title has gone blank,
that narrowing is where to look.

It should also be faster on a site with many courses, since the page used to
read every lesson, module and course in the system on each load and match
them with a `.find()` inside a `.map()`.

## 9. Nothing else moved

The scope was the LMS module only. Confirm the dashboard, giving, membership,
events, orders, invoices, subscriptions, payment methods and profile tabs are
untouched, and that the admin side is unchanged.

## What I could not check, and you should watch

- **Every SQL statement here is unexecuted.** Five new queries: per-course
  marks, certificates, quiz attempts, outstanding assignments, catalogue
  pricing. Column names were read from the schema rather than assumed, but
  none of these queries has met a real database.
- **Correction to an earlier draft of this document.** It said the positional
  `?` placeholders in two of those queries "match what 23 other `db.query`
  calls in these routes already do". That was wrong, and backwards: of the 26
  pre-existing `db.query` call sites in `lms.js` and `lmsPortal.js`, 24 use
  `:named` placeholders and none uses a positional `?`. The house convention
  here is named placeholders.

  The two queries are still correct, for a better reason than the one I gave.
  They build a dynamic `IN (...)` list from an array, which named
  placeholders do not express, and mysql2 supports positional `?` with an
  array even while `namedPlaceholders` is enabled — deliberately, not by
  accident. From `mysql2/lib/base/connection.js`, in
  `_resolveNamedPlaceholders`:

      if (Array.isArray(options.values)) {
        // if an array is provided as the values, assume the conversion is
        // not necessary. this allows the usage of unnamed placeholders even
        // if the namedPlaceholders flag is enabled.
        return;
      }

  Both sites pass an array. Read the driver source rather than my count.
- **`ONLY_FULL_GROUP_BY`.** Two queries group. Both list every non-aggregated
  column in `GROUP BY`, so they should be fine under strict mode, but that is
  reasoning rather than evidence.
- **`SUM(s.status = 'pending')`** returns a string or decimal through mysql2
  depending on driver settings; it is wrapped in `Number()` before comparison.
  If assignments all read as "To do" when some are pending, that wrapping is
  where to look.
