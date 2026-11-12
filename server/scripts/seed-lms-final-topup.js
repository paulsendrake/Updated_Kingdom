#!/usr/bin/env node
// Final top-up so every LMS screen has something rich to show, no action
// required first: gives contact 8 (froe4009@gmail.com, the account used to
// demo this) a THIRD course that's already 100% complete + certified
// (through the real submission -> grade -> complete -> certificate
// pipeline, not a shortcut), so Transcript/Certificate-download/My-Courses
// all look full immediately — the other two courses are left in-progress
// with pending submissions specifically so Marking/grading still has
// something live to click through too. Also adds a sample lesson
// attachment, the one piece of LMS UI with zero seeded data so far.
//
//   node scripts/seed-lms-final-topup.js

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { loadRuntime, contextFor } = require('../src/lms/runtime');
const { db } = require('../src/db');
const storage = require('../src/services/storage');

(async () => {
  const { lms, store, schema, db: lmsDb } = await loadRuntime();
  const { eq } = require('drizzle-orm');
  const admin = await contextFor('staff:seed-script', 'admin');

  console.log('=== Contact 8 — third course, fully completed + certified ===');
  const [servingRow] = await lmsDb.select().from(schema.courses).where(eq(schema.courses.slug, 'serving-on-a-team'));
  const modules = await lmsDb.select().from(schema.modules).where(eq(schema.modules.courseId, servingRow.id));
  const whyServeModule = modules.find((m) => m.title === 'Why We Serve');
  const pickTeamModule = modules.find((m) => m.title === 'Pick a Team');
  const lessonsA = await lmsDb.select().from(schema.lessons).where(eq(schema.lessons.moduleId, whyServeModule.id));
  const lessonsB = await lmsDb.select().from(schema.lessons).where(eq(schema.lessons.moduleId, pickTeamModule.id));
  const servingCultureId = lessonsA[0].id;
  const teamAssignmentId = lessonsB[0].id;

  const cohorts = await lms.listCohorts(admin);
  const servingCohort = cohorts.find((c) => c.name === 'Serving Team Orientation');
  const members = await store.cohortMemberIds(servingCohort.id);
  if (!members.includes('8')) { await lms.addMember(admin, servingCohort.id, '8'); console.log('  Enrolled contact 8 in "Serving Team Orientation"'); }

  const ctx8 = await contextFor('8', 'learner');
  await lms.completeLesson(ctx8, servingCultureId).catch(() => {});
  const paper = await lms.getQuizPaper(ctx8, servingCultureId);
  if (paper && paper.attemptsTaken === 0) {
    const answers = {}; for (const q of paper.questions) answers[q.id] = q.options[0].id;
    await lms.submitAttempt(ctx8, { quizId: paper.id, answers });
    console.log('  Passed the quiz');
  }
  let [[sub]] = await db.query('SELECT id, status FROM lms_lesson_submissions WHERE lesson_id = :l AND contact_id = 8', { l: teamAssignmentId });
  if (!sub) {
    const [ins] = await db.query(
      `INSERT INTO lms_lesson_submissions (lesson_id, contact_id, body_text) VALUES (:l, 8, :b)`,
      { l: teamAssignmentId, b: 'Served on the parking team this week — directing traffic and helping people find spots on a rainy Sunday!' }
    );
    sub = { id: ins.insertId, status: 'pending' };
  }
  if (sub.status === 'pending') {
    await db.query(`UPDATE lms_lesson_submissions SET status='graded', score=97, feedback='Fantastic first shift!', graded_at=NOW() WHERE id=:id`, { id: sub.id });
    const result = await lms.completeLesson(ctx8, teamAssignmentId);
    console.log('  Graded + completed — courseCompleted:', result?.courseCompleted);
    if (result?.courseCompleted) {
      const { issueCertificateIfComplete } = require('../src/services/lmsCertificates');
      const certId = await issueCertificateIfComplete({ courseId: servingRow.id, contactId: 8 });
      console.log(`  -> Certificate issued (id ${certId}) for contact 8`);
    }
  } else {
    console.log('  Already graded — course should already be complete.');
  }

  console.log('\n=== Sample lesson attachment ===');
  const attachments = await store.attachmentsFor(servingCultureId);
  if (attachments.some((a) => a.label === 'Serving Team Handbook.pdf')) {
    console.log('  Sample attachment already exists — skipping.');
  } else {
    const buffer = Buffer.from('%PDF-1.4\n% Sample placeholder PDF for LMS demo seed data.\n%%EOF', 'utf8');
    const { key } = await storage.put({ entity_type: 'lms_lesson_attachment', entity_id: servingCultureId, originalName: 'Serving Team Handbook.pdf', contentType: 'application/pdf', buffer });
    await lms.addAttachment(admin, { lessonId: servingCultureId, label: 'Serving Team Handbook.pdf', objectKey: key, contentType: 'application/pdf', sizeBytes: buffer.length });
    console.log('  Added "Serving Team Handbook.pdf" to the "Our Serving Culture" lesson');
  }

  console.log('\nAll done — every LMS screen should now have real data to show with no setup steps needed.');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
