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

    const [[certCount]] = await db.query('SELECT COUNT(*) AS n FROM lms_certificates WHERE contact_id = :id', { id: req.user.contact_id });
    const [scoreRows] = await db.query('SELECT score FROM lms_lesson_submissions WHERE contact_id = :id AND status = \'graded\'', { id: req.user.contact_id });
    const averageMark = scoreRows.length ? Math.round(scoreRows.reduce((a, r) => a + r.score, 0) / scoreRows.length) : null;
    const lessonsCompleted = shelf.reduce((a, c) => a + (c.completedCount || 0), 0);

    res.json({
      courses: shelf,
      stats: {
        courseCount: shelf.length,
        lessonsCompleted,
        certificateCount: certCount?.n || 0,
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
