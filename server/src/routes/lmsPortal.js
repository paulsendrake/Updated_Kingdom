// =============================================================================
// /api/portal/lms — the learner-facing side of the Learning module
//
// Mounted separately from routes/portal.js (which owns /api/portal/* for
// everything else) rather than folded into that already-1300-line file.
// Express tries routers in registration order and falls through on no
// match, so two routers sharing the /api/portal prefix is safe as long as
// this one is registered — see index.js.
//
// The acting viewer is always 'learner': this file has no staff path. Every
// entitlement question (may this person see this course/lesson/quiz) is
// answered inside the vendored module itself (requireEntitlement), not
// re-decided here — this layer only resolves who's asking.
// =============================================================================
const router = require('express').Router();
const { z } = require('zod');
const { db } = require('../db');
const { requirePortal } = require('./portal');
const { loadRuntime, contextFor, statusForLmsError } = require('../lms/runtime');

router.use(requirePortal);

function handleLmsError(err, res, next) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  const status = statusForLmsError(err);
  if (status) return res.status(status).json({ error: err.message });
  next(err);
}

async function learnerContext(req) {
  if (!req.user.contact_id) {
    const err = new Error('Your account has no linked member record, so there is nothing to show here.');
    err.status = 409;
    throw err;
  }
  return contextFor(String(req.user.contact_id), 'learner');
}

router.get('/courses', async (req, res, next) => {
  try {
    const context = await learnerContext(req);
    const { lms } = await loadRuntime();
    const shelf = await lms.myCourses(context);
    res.json(shelf);
  } catch (err) { handleLmsError(err, res, next); }
});

/*
 * The catalogue, searchable.
 *
 * Browsing already exists: the portal's learning drawer calls
 * /lms-checkout/courses, which selects every published course and attaches
 * pricing. That is the right answer for a handful of courses and the wrong
 * one for a few hundred — it has no search, no filtering, no paging, and the
 * drawer works out what you are already enrolled on by filtering the list in
 * the browser after loading all of it.
 *
 * browseCatalogue and catalogueFacets have been in the vendored module all
 * along (vendor/kcc-lms/src/services/catalogue.ts) and nothing reached them.
 * They answer the same question with a query, a level, a language, a topic
 * and a page, return an `enrolled` flag per card so the client does not have
 * to work it out, and build the filter options from the values actually
 * present rather than a hardcoded list. The module describes itself as the
 * one read not gated by entitlement, precisely so a course can be looked at
 * before it is taken: it returns the describing fields and never the
 * material.
 *
 * Added alongside the checkout route rather than replacing it — that one
 * carries pricing and feeds the paid-enrolment flow, which is not this
 * module's business.
 *
 * Declared above '/courses/:slug' on purpose. Express matches in order, and
 * ':slug' would otherwise swallow 'catalogue' and answer 404 for a course by
 * that name.
 */
const catalogueQuery = z.object({
  query: z.string().trim().max(200).optional(),
  level: z.string().trim().max(40).optional(),
  language: z.string().trim().max(40).optional(),
  topic: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

router.get('/catalogue', async (req, res, next) => {
  try {
    const parsed = catalogueQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Those filters are not valid.' });
    const context = await learnerContext(req);
    const { lms } = await loadRuntime();
    const page = await lms.browseCatalogue(context, parsed.data);
    // Defensive: everything below indexes into page.items, and a 500 from a
    // shape change would take the whole drawer down rather than the browse
    // half of it.
    if (!page || !Array.isArray(page.items)) return res.json({ items: [], total: 0 });

    /*
     * Pricing is attached here rather than left to the caller.
     *
     * The module has no opinion about money and should not grow one — pricing
     * lives in lms_course_pricing, which is this application's table, not the
     * module's. But the drawer shows a price badge, so a catalogue without it
     * would mean either a second request or a silent regression from "$49" to
     * nothing on every paid course.
     *
     * Only the rows on this page are looked up, unlike /lms-checkout/courses
     * which reads the whole pricing table every time. A course with no row is
     * free, which is the same assumption that endpoint makes.
     */
    const ids = page.items.map((item) => item.id);
    let pricing = new Map();
    if (ids.length > 0) {
      const [rows] = await db.query(
        `SELECT * FROM lms_course_pricing WHERE course_id IN (${ids.map(() => '?').join(',')})`,
        ids,
      );
      pricing = new Map(rows.map((row) => [row.course_id, row]));
    }

    res.json({
      ...page,
      items: page.items.map((item) => ({
        ...item,
        pricing: pricing.get(item.id) || { access_type: 'free' },
      })),
    });
  } catch (err) { handleLmsError(err, res, next); }
});

router.get('/catalogue/facets', async (req, res, next) => {
  try {
    const context = await learnerContext(req);
    const { lms } = await loadRuntime();
    res.json(await lms.catalogueFacets(context));
  } catch (err) { handleLmsError(err, res, next); }
});

router.get('/courses/:slug', async (req, res, next) => {
  try {
    const context = await learnerContext(req);
    const { lms } = await loadRuntime();
    const course = await lms.getCourse(context, req.params.slug);
    if (!course) return res.status(404).json({ error: 'No such course.' });
    res.json(course);
  } catch (err) { handleLmsError(err, res, next); }
});

router.get('/courses/:courseSlug/lessons/:lessonSlug', async (req, res, next) => {
  try {
    const context = await learnerContext(req);
    const { lms } = await loadRuntime();
    const lesson = await lms.getLesson(context, req.params.courseSlug, req.params.lessonSlug);
    if (!lesson) return res.status(404).json({ error: 'No such lesson.' });
    res.json(lesson);
  } catch (err) { handleLmsError(err, res, next); }
});

router.post('/lessons/:id/complete', async (req, res, next) => {
  try {
    const context = await learnerContext(req);
    const { lms, store } = await loadRuntime();
    const result = await lms.completeLesson(context, req.params.id);
    if (result?.courseCompleted) {
      const found = await store.findLessonById(req.params.id);
      if (found?.courseId) {
        const { issueCertificateIfComplete } = require('../services/lmsCertificates');
        await issueCertificateIfComplete({ courseId: found.courseId, contactId: req.user.contact_id });
      }
    }
    res.json(result);
  } catch (err) { handleLmsError(err, res, next); }
});

router.post('/lessons/:id/uncomplete', async (req, res, next) => {
  try {
    const context = await learnerContext(req);
    const { lms } = await loadRuntime();
    await lms.uncompleteLesson(context, req.params.id);
    res.json({ ok: true });
  } catch (err) { handleLmsError(err, res, next); }
});

router.get('/lessons/:id/quiz', async (req, res, next) => {
  try {
    const context = await learnerContext(req);
    const { lms } = await loadRuntime();
    const paper = await lms.getQuizPaper(context, req.params.id);
    if (!paper) return res.status(404).json({ error: 'No such quiz.' });
    res.json(paper);
  } catch (err) { handleLmsError(err, res, next); }
});

const progressSchema = z.object({ secondsWatched: z.number().min(0), lastPositionSeconds: z.number().min(0) });
router.post('/lessons/:id/progress', async (req, res, next) => {
  try {
    const { secondsWatched, lastPositionSeconds } = progressSchema.parse(req.body);
    const context = await learnerContext(req);
    const { lms } = await loadRuntime();
    await lms.recordWatched(context, { lessonId: req.params.id, secondsWatched, lastPositionSeconds });
    res.json({ ok: true });
  } catch (err) { handleLmsError(err, res, next); }
});

// Assignment submission — the learner's half of Marking (see routes/lms.js's
// POST /submissions/:id/grade for the staff half). Submitting does NOT
// complete the lesson; completion happens only once it's graded, since the
// mark is what the learner is waiting on.
const submissionSchema = z.object({ bodyText: z.string().min(1).max(20000) });
router.post('/lessons/:id/submissions', async (req, res, next) => {
  try {
    const { bodyText } = submissionSchema.parse(req.body);
    await learnerContext(req); // throws if this account has no linked contact
    const { store } = await loadRuntime();
    const found = await store.findLessonById(req.params.id);
    if (!found) return res.status(404).json({ error: 'No such lesson.' });

    /*
     * One outstanding hand-in at a time.
     *
     * lms_lesson_submissions has no unique key on (lesson_id, contact_id),
     * and the insert below had no guard, so a second POST — a retry, a
     * double click that beat the button's disabled state, anything calling
     * the API directly — wrote a second pending row. The learner saw one
     * thing; the marker's queue showed the same work twice; grading one
     * completed the lesson and left the other pending for good, because
     * nothing ever revisits it. A stuck row in a work queue is the kind of
     * thing somebody eventually fixes by hand in the database.
     *
     * Checked rather than constrained because resubmission after a mark is a
     * different question: status is ENUM('pending','graded') with no
     * "returned for revision", so a unique key would also forbid the
     * resubmission the schema otherwise allows. This forbids only the second
     * *pending* one, which is the case that has no meaning.
     */
    const [[outstanding]] = await db.query(
      `SELECT id FROM lms_lesson_submissions
        WHERE lesson_id = :lesson_id AND contact_id = :contact_id AND status = 'pending'
        LIMIT 1`,
      { lesson_id: req.params.id, contact_id: req.user.contact_id }
    );
    if (outstanding) {
      return res.status(409).json({ error: 'You have already submitted this assignment. It is waiting to be marked.' });
    }

    await db.query(
      `INSERT INTO lms_lesson_submissions (lesson_id, contact_id, body_text)
       VALUES (:lesson_id, :contact_id, :body_text)`,
      { lesson_id: req.params.id, contact_id: req.user.contact_id, body_text: bodyText }
    );
    res.status(201).json({ ok: true });
  } catch (err) { handleLmsError(err, res, next); }
});

router.get('/lessons/:id/submissions', async (req, res, next) => {
  try {
    await learnerContext(req);
    const [rows] = await db.query(
      `SELECT * FROM lms_lesson_submissions WHERE lesson_id = :id AND contact_id = :cid ORDER BY submitted_at DESC`,
      { id: req.params.id, cid: req.user.contact_id }
    );
    res.json(rows);
  } catch (err) { handleLmsError(err, res, next); }
});

// Certificates — issued automatically on 100% completion (see the complete
// route above and routes/lms.js's grading route), never requested on demand.
router.get('/courses/:slug/certificate', async (req, res, next) => {
  try {
    await learnerContext(req);
    const { schema, db: lmsDb } = await loadRuntime();
    const { eq } = require('drizzle-orm');
    const [course] = await lmsDb.select().from(schema.courses).where(eq(schema.courses.slug, req.params.slug));
    if (!course) return res.status(404).json({ error: 'No such course.' });
    const [[cert]] = await db.query(
      'SELECT * FROM lms_certificates WHERE course_id = :cid AND contact_id = :uid',
      { cid: course.id, uid: req.user.contact_id }
    );
    if (!cert) return res.status(404).json({ error: 'No certificate issued for this course yet.' });
    res.json(cert);
  } catch (err) { handleLmsError(err, res, next); }
});

router.get('/courses/:slug/certificate.pdf', async (req, res, next) => {
  try {
    await learnerContext(req);
    const { schema, db: lmsDb } = await loadRuntime();
    const { eq } = require('drizzle-orm');
    const [course] = await lmsDb.select().from(schema.courses).where(eq(schema.courses.slug, req.params.slug));
    if (!course) return res.status(404).json({ error: 'No such course.' });
    const [[cert]] = await db.query(
      'SELECT * FROM lms_certificates WHERE course_id = :cid AND contact_id = :uid',
      { cid: course.id, uid: req.user.contact_id }
    );
    if (!cert) return res.status(404).json({ error: 'No certificate issued for this course yet.' });
    const [[contact]] = await db.query('SELECT CONCAT_WS(\' \', first_name, last_name) AS name FROM contacts WHERE id = :id', { id: req.user.contact_id });

    const { resolveBusinessBranding, renderCertificatePdf } = require('../services/lmsCertificates');
    const company = await resolveBusinessBranding();
    const buf = await renderCertificatePdf({
      contactName: contact?.name || 'Learner', courseTitle: course.title,
      certificateNumber: cert.certificate_number, issuedAt: cert.issued_at, company,
    });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="certificate-${cert.certificate_number}.pdf"`);
    res.send(buf);
  } catch (err) { next(err); }
});

// Transcript — a read-only aggregation across courses/progress/certificates/
// marks, no new write path. Mirrors the reference app's "My transcript" page
// (stat cards + a per-course record list).
router.get('/transcript', async (req, res, next) => {
  try {
    const context = await learnerContext(req);
    const { lms } = await loadRuntime();
    const shelf = await lms.myCourses(context);

    /*
     * Marks per course, not just one number across everything.
     *
     * This page tells the learner it shows "how far through it you are, and
     * what's been marked", and it could not keep the second half: the only
     * mark it had was a single average over every graded submission the
     * person has ever made, so a course they did well in and one they
     * struggled with arrived as one figure with no way back to either.
     *
     * The join is submissions -> lessons -> modules -> courses, because a
     * submission knows its lesson and nothing above it.
     */
    const [scoreRows] = await db.query(
      `SELECT m.course_id AS courseId, AVG(s.score) AS averageMark, COUNT(*) AS markedCount
         FROM lms_lesson_submissions s
         JOIN lms_lessons l ON l.id = s.lesson_id
         JOIN lms_modules m ON m.id = l.module_id
        WHERE s.contact_id = :id AND s.status = 'graded' AND s.score IS NOT NULL
        GROUP BY m.course_id`,
      { id: req.user.contact_id },
    );
    const marksByCourse = new Map(
      scoreRows.map((row) => [row.courseId, {
        averageMark: row.averageMark === null ? null : Math.round(Number(row.averageMark)),
        markedCount: Number(row.markedCount),
      }]),
    );

    /*
     * The certificates themselves rather than how many there are. A count
     * told somebody they had earned three and gave them no way to see one.
     */
    const [certificates] = await db.query(
      `SELECT cert.certificate_number AS certificateNumber,
              cert.issued_at AS issuedAt,
              cert.course_id AS courseId,
              c.title AS courseTitle,
              c.slug AS courseSlug
         FROM lms_certificates cert
         JOIN lms_courses c ON c.id = cert.course_id
        WHERE cert.contact_id = :id
        ORDER BY cert.issued_at DESC`,
      { id: req.user.contact_id },
    );

    /*
     * Quiz results after the moment of sitting them.
     *
     * An attempt is marked, shown once on submit, and then unreachable: a
     * learner who wants to know what they scored last week has nowhere to
     * look. The rows have been kept all along. user_id on an attempt is the
     * contact id — contextFor() is built from req.user.contact_id, and the
     * assessment service writes context.viewer.id — so this reads the same
     * key the rest of this file uses.
     *
     * Newest first, and capped: this is a record to glance at, not an export.
     */
    const [quizAttempts] = await db.query(
      `SELECT a.score, a.passed, a.submitted_at AS submittedAt,
              q.title AS quizTitle, q.passing_score AS passingScore,
              l.title AS lessonTitle, l.slug AS lessonSlug,
              c.title AS courseTitle, c.slug AS courseSlug
         FROM lms_quiz_attempts a
         JOIN lms_quizzes q ON q.id = a.quiz_id
         JOIN lms_lessons l ON l.id = q.lesson_id
         JOIN lms_modules m ON m.id = l.module_id
         JOIN lms_courses c ON c.id = m.course_id
        WHERE a.user_id = :id
        ORDER BY a.submitted_at DESC
        LIMIT 50`,
      { id: String(req.user.contact_id) },
    );

    /*
     * What is still owed, and what is waiting on somebody else.
     *
     * Two different states that both read as "not done" and should not be
     * shown as one: an assignment never handed in is the learner's move, and
     * one handed in and not yet marked is not. Scoped to the courses on their
     * shelf, so an assignment in a course they are not entitled to cannot
     * appear.
     */
    const shelfIds = shelf.map((course) => course.id);
    let assignments = [];
    if (shelfIds.length > 0) {
      const placeholders = shelfIds.map(() => '?').join(',');
      /*
       * Grouped by lesson, not joined row by row.
       *
       * lms_lesson_submissions has no unique key on (lesson_id, contact_id),
       * the insert is a plain INSERT, and the existing GET for a lesson
       * orders by submitted_at DESC — so more than one hand-in per lesson is
       * how the thing is designed, not an edge case. A plain LEFT JOIN
       * therefore returns one row per submission, and a lesson with two
       * pending hand-ins would be listed twice under the same React key.
       *
       * HAVING rather than WHERE because the question is about the set of
       * submissions for a lesson: show it if there are none at all, or if any
       * of them is still waiting to be marked. A lesson whose only submission
       * has been graded is finished and drops out.
       */
      const [rows] = await db.query(
        `SELECT l.id AS lessonId, l.title AS lessonTitle, l.slug AS lessonSlug,
                c.title AS courseTitle, c.slug AS courseSlug,
                MAX(s.submitted_at) AS submittedAt,
                COUNT(s.id) AS submissionCount,
                SUM(s.status = 'pending') AS pendingCount
           FROM lms_lessons l
           JOIN lms_modules m ON m.id = l.module_id
           JOIN lms_courses c ON c.id = m.course_id
           LEFT JOIN lms_lesson_submissions s
                  ON s.lesson_id = l.id AND s.contact_id = ?
          WHERE l.kind = 'assignment'
            AND l.is_published = 1
            AND m.course_id IN (${placeholders})
          GROUP BY l.id, l.title, l.slug, c.title, c.slug
         HAVING submissionCount = 0 OR pendingCount > 0
          ORDER BY c.title, l.title`,
        [req.user.contact_id, ...shelfIds],
      );
      assignments = rows.map((row) => ({
        lessonId: row.lessonId,
        lessonTitle: row.lessonTitle,
        lessonSlug: row.lessonSlug,
        courseTitle: row.courseTitle,
        courseSlug: row.courseSlug,
        submittedAt: row.submittedAt,
        state: Number(row.pendingCount) > 0 ? 'awaiting_marking' : 'to_do',
      }));
    }

    const allMarked = [...marksByCourse.values()];
    const totalMarked = allMarked.reduce((a, m) => a + m.markedCount, 0);
    const averageMark = totalMarked
      ? Math.round(allMarked.reduce((a, m) => a + m.averageMark * m.markedCount, 0) / totalMarked)
      : null;
    const lessonsCompleted = shelf.reduce((a, c) => a + (c.completedCount || 0), 0);

    res.json({
      courses: shelf.map((course) => ({
        ...course,
        ...(marksByCourse.get(course.id) ?? { averageMark: null, markedCount: 0 }),
      })),
      certificates,
      quizAttempts,
      assignments,
      stats: {
        courseCount: shelf.length,
        lessonsCompleted,
        certificateCount: certificates.length,
        averageMark,
      },
    });
  } catch (err) { handleLmsError(err, res, next); }
});

const attemptSchema = z.object({ answers: z.record(z.string(), z.string()) });
router.post('/quizzes/:id/attempts', async (req, res, next) => {
  try {
    const { answers } = attemptSchema.parse(req.body);
    const context = await learnerContext(req);
    const { lms } = await loadRuntime();
    const result = await lms.submitAttempt(context, { quizId: req.params.id, answers });
    res.json(result);
  } catch (err) { handleLmsError(err, res, next); }
});

module.exports = router;
