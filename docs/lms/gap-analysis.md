# The learning tab: what is missing

Measured against `renfroe4009/kingdom-connections` at commit `61e38bb`
(client 2.6.0), cloned and read rather than recalled. Scope is the LMS module
and the portal learning tab only — nothing in this document touches another
module.

## What is there now

The learner side is four routes, declared in `client/src/App.jsx`:

| Route | Component | Lines |
|---|---|---|
| `/portal/learning` | `PortalLearning.jsx` | 59 |
| `/portal/learning/transcript` | `PortalTranscript.jsx` | 106 |
| `/portal/learning/:courseSlug` | `PortalCourseView.jsx` | 113 |
| `/portal/learning/:courseSlug/:lessonSlug` | `PortalLessonView.jsx` | 356 |

Behind them, `server/src/routes/lmsPortal.js` exposes thirteen endpoints:
course list and detail, lesson detail, complete and uncomplete, quiz fetch and
attempt, progress, assignment hand-in and listing, certificate and its PDF, and
the transcript.

That is a working course player.

The nav entry matters more than those routes, and is easy to miss: **Learning
in the portal sidebar is not a link to `/portal/learning`.** It opens
`client/src/admin/components/LearningDrawer.jsx` (116 lines), a side drawer
listing My Courses and Browse Courses. `PortalLearning.jsx` is the full page
behind it, reached by clicking into a course. Reading one without the other
gives a false picture of what a learner can actually do — it gave me one.

Between them, a learner can list what they are enrolled on, browse what else
is published, open a course, work through lessons, sit a quiz, hand in an
assignment, and collect a certificate and a transcript.

## Correction to an earlier draft of this document

An earlier version of this file said a learner had no way to see a course
they were not enrolled on. That was wrong, and it was wrong because it read
`PortalLearning.jsx` and stopped there. The Learning entry in the portal nav
is not that page — it opens `LearningDrawer.jsx`, which has a **Browse
Courses** section, and there is a marketing page at `/learn/:slug`. Browsing
works today.

## The catalogue: browsing exists, searching does not

`LearningDrawer.jsx` browses by calling `GET /lms-checkout/courses`
(`server/src/routes/lmsCheckout.js`), which runs

    select * from courses where status = 'published'

attaches pricing to each row, returns the lot, and leaves the drawer to
filter out what the learner is already enrolled on in the browser.

That is the right answer for a dozen courses and the wrong one for two
hundred: no search, no filters, no paging, and the whole table crosses the
wire so the client can discard part of it.

Meanwhile `server/vendor/kcc-lms/dist/services/catalogue.js` exports
`browseCatalogue` and `catalogueFacets`, which nothing references. They take
a query, a level, a language, a topic and a page; they return an `enrolled`
flag per card so the client does not have to work it out; and `catalogueFacets`
builds the filter options from the values actually present rather than a
hardcoded list.

**To do**
1. Add `GET /portal/lms/catalogue` and `GET /portal/lms/catalogue/facets` to
   `lmsPortal.js`, calling those two services. *(Done — see
   `kc-catalogue-endpoints.patch`.)*
2. Point the drawer's Browse section at the new endpoint, with a search box
   and the facet filters, and drop the client-side enrolled filtering in
   favour of the flag.
3. Leave `/lms-checkout/courses` alone. It carries pricing and feeds the paid
   enrolment flow, which is a different job.
4. If a full-page catalogue is wanted as well as the drawer, note that
   `learning/:courseSlug` is declared after `learning/transcript` in
   `App.jsx`, which is why the transcript works. Any new literal segment —
   `learning/catalogue` — must be declared **above** the `:courseSlug` route
   or it will be swallowed by it.

## Missing from the learning tab itself

Each claim below was checked against the code rather than inferred from the
page that looked likeliest. Three things an earlier draft listed as missing
turned out to exist, and they are recorded here rather than quietly dropped.

**Already there, contrary to an earlier draft:**

- *Continue where you left off.* `PortalCourseView.jsx` renders
  `course.nextLessonSlug` as a **Start Course** / **Continue** button. It is
  only missing one level up: the drawer and the My Learning grid show progress
  but make you open the course to resume. That is one extra click, not a
  missing feature.
- *Certificates.* Downloadable from the course page once a course hits 100%,
  including a PDF.
- *Assignment hand-ins.* `PortalLessonView.jsx` posts and lists submissions.

**Genuinely missing:**

| Missing | Status |
|---|---|
| **Per-course marks on the transcript.** The page says it shows "how far through it you are, and what's been marked", and the table had no marks column. The endpoint returned one average across every graded submission a learner had ever made, so a course they did well in and one they struggled with arrived as a single figure. | **Built.** Grouped by course via submissions → lessons → modules, with a Marked column. |
| **The certificates themselves.** The transcript showed a count. Somebody could be told they had earned three and have no way to see one. | **Built.** Listed with number, date and a link to the course. |
| **Searchable browsing.** See above. | **Built** server-side and wired into the drawer. |
| **Outstanding assignments.** Nothing showed a learner what they had handed in that was still unmarked, or what was waiting to be done, without opening each lesson. | **Built.** Split by whose move it is — "To do" against "Waiting to be marked" — because showing them as one list makes somebody chase work sitting on a marker's desk. Scoped to courses on their shelf. |
| **Quiz results after the fact.** An attempt was marked and shown at the moment of submitting, and there was no way back to it. | **Built.** Newest fifty, with the score, the pass mark and a link back to the lesson. |

## Missing from the LMS module

These are in the standalone LMS (`paulsendrake/KingdonLMS`) and have no
counterpart here. They are the "good stuff in the other LMS" — listed with
what each actually is, so the cost is visible rather than implied.

| Feature | What it is | Tables in the standalone LMS |
|---|---|---|
| **Channels and content** | A course is not a free-standing row but a `ContentItem` living in a channel, with its own status and visibility (channel members / org members / platform members / public). Channels are per-organisation surfaces with automatic or opt-in membership. | `Channel`, `ChannelMembership`, `ContentItem` |
| **The main feed** | An organisation submits content to a platform-wide feed; a reviewer approves or declines it with a note; placements then decide which channels it appears in and what is pinned. | `MainFeedSubmission`, `FeedPlacement` |
| **Pathways** | Sequenced journeys through concepts, authored and taken. | `Pathway`, `PathwayConcept` |
| **Concept graph** | Concepts with typed edges between them and scripture evidence attached. | `Concept`, `ConceptEdge`, `ConceptEvidence` |
| **Reading plans** | Plans with per-day passages, subscriptions and per-day completion. | `ReadingPlan`, `ReadingPlanDay`, `ReadingPlanPassage`, `PlanSubscription`, `PlanDayCompletion` |
| **Scripture memory** | Passages to memorise with spaced review. | `MemoryPassage`, `MemoryReview`, `ScriptureMark` |
| **Question banks** | A bank of questions with a randomised draw per attempt, so two learners do not sit the same paper. Quizzes here are a fixed ordered list. | `QuestionBank`, `QuizDraw` |
| **Discussions** | Threads against a content item, with subscriptions. | `DiscussionThread`, `DiscussionPost`, `ThreadSubscription` |

## Suggested order

Items 1 and 2 are done and are in `kc-learning-tab.patch`. What follows is
the remaining work, and 4 and 5 are a scoping conversation rather than a
queue.

1. **Catalogue** — the service exists; this is wiring, and it is the thing a
   learner notices first.
2. **Continue, certificates, assignments, quiz results** — four small surfaces
   over data already returned. Together they are what makes the tab feel like a
   place rather than a list.
3. **Question banks** — self-contained, affects only assessment, and is the
   one item on the second table that needs no new navigation.
4. **Channels, content and the feed** — the largest piece, and the one that
   changes how content is modelled. Worth doing deliberately and on its own.
5. **Pathways, plans, memory, discussions** — each is a feature in its own
   right with its own authoring and learner surface. Each should be costed
   separately rather than as one line.

## A note on the two systems

`paulsendrake/kingdom` contains a from-scratch rebuild with much of the above
already implemented, including channels, content items and the feed with its
access rules. If the rebuild is being scrapped, that code is still worth
reading before any of items 4 and 5 are written again from nothing — the
access rules in particular took a cross-checked probe over 196 viewer and item
combinations to get right, and they found a real leak on the first run.
