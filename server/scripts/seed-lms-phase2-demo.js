#!/usr/bin/env node
// Extends seed-lms-demo.js (run that first) with Phase 2 demo states: a live,
// ready-to-grade assignment submission queue for Marking, and a second
// course enrollment for the account used to demo this — froe4009@gmail.com
// (contact 8, "tim renfroe"), so both the portal (as a learner) and the
// admin console (as staff) have something real to click through.
//
// Deliberately does NOT pre-issue a certificate for contact 8's in-progress
// course — leaving their one remaining assignment lesson un-graded means a
// live demo can grade it on screen and watch the certificate get issued by
// the real pipeline, which is a better demo than seeing it already done.
//
// Idempotent: checks for an existing pending/graded submission before
// inserting another, and uncompleteLesson-then-resubmit is safe to re-run.
//
//   node scripts/seed-lms-phase2-demo.js

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { loadRuntime, contextFor } = require('../src/lms/runtime');
const { db } = require('../src/db');

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function ensurePendingSubmission(lessonId, contactId, bodyText) {
  const [[existing]] = await db.query(
    `SELECT id, status FROM lms_lesson_submissions WHERE lesson_id = :l AND contact_id = :c ORDER BY id DESC LIMIT 1`,
    { l: lessonId, c: contactId }
  );
  if (existing) {
    console.log(`  Submission already exists for contact ${contactId} on lesson ${lessonId} (status: ${existing.status}) — leaving as-is.`);
    return existing.id;
  }
  const [ins] = await db.query(
    `INSERT INTO lms_lesson_submissions (lesson_id, contact_id, body_text) VALUES (:l, :c, :b)`,
    { l: lessonId, c: contactId, b: bodyText }
  );
  console.log(`  Created pending submission #${ins.insertId} for contact ${contactId}`);
  return ins.insertId;
}

(async () => {
  const { lms, schema, db: lmsDb } = await loadRuntime();
  const { eq } = require('drizzle-orm');
  const admin = await contextFor('staff:seed-script', 'admin');

  const [course1] = await lmsDb.select().from(schema.courses).where(eq(schema.courses.slug, slugify('Foundations of Church Membership')));
  const [course2] = await lmsDb.select().from(schema.courses).where(eq(schema.courses.slug, slugify('Growing in Prayer')));
  if (!course1 || !course2) { console.error('Run scripts/seed-lms-demo.js first.'); process.exit(1); }

  const modules1 = await lmsDb.select().from(schema.modules).where(eq(schema.modules.courseId, course1.id));
  const involvedModule = modules1.find((m) => m.title === 'Getting Involved');
  const lessons1 = await lmsDb.select().from(schema.lessons).where(eq(schema.lessons.moduleId, involvedModule.id));
  const nextStepsId = lessons1.find((l) => l.title === 'Next Steps').id;

  const modules2 = await lmsDb.select().from(schema.modules).where(eq(schema.modules.courseId, course2.id));
  const whyPrayModule = modules2.find((m) => m.title === 'Why Pray');
  const lessons2 = await lmsDb.select().from(schema.lessons).where(eq(schema.lessons.moduleId, whyPrayModule.id));
  const prayerHabitId = lessons2.find((l) => l.title === 'Starting a Prayer Habit').id;
  const journalChallengeId = lessons2.find((l) => l.title === 'Prayer Journal Challenge').id;

  console.log('=== Contact 8 (tim renfroe / froe4009@gmail.com) ===');
  // They're already enrolled + 100% on course1 from seed-lms-demo.js's own
  // run (it completes every lesson including the assignment directly, since
  // it predates the submission model). Revert just the assignment lesson so
  // there's something real to submit/grade live — their other 3 lessons +
  // quiz stay completed, so the course view still looks mostly done.
  const ctx8 = await contextFor('8', 'learner');
  await lms.uncompleteLesson(ctx8, nextStepsId).catch(() => {});
  await ensurePendingSubmission(nextStepsId, 8, "I talked to Pastor Mike after service on Sunday and I'm joining the Thursday night small group starting next week. Looking forward to it!");
  console.log('  Reverted "Next Steps" to incomplete + left a pending submission ready to grade live.');

  // Second course enrollment, in a different state — enrolled + one reading
  // done, quiz passed, their own assignment also left pending for Marking.
  const cohorts = await lms.listCohorts(admin);
  const cohort2 = cohorts.find((c) => c.name === 'Prayer Team Training');
  const members2 = await (await loadRuntime()).store.cohortMemberIds(cohort2.id);
  if (!members2.includes('8')) {
    await lms.addMember(admin, cohort2.id, '8');
    console.log('  Enrolled in "Prayer Team Training" (Growing in Prayer)');
  }
  await lms.completeLesson(ctx8, prayerHabitId).catch(() => {});
  const paper = await lms.getQuizPaper(ctx8, prayerHabitId);
  if (paper && paper.attemptsTaken === 0) {
    const answers = {};
    for (const q of paper.questions) answers[q.id] = q.options[0].id;
    await lms.submitAttempt(ctx8, { quizId: paper.id, answers });
    console.log('  Passed "Prayer Basics Check-in" quiz');
  }
  await ensurePendingSubmission(journalChallengeId, 8, 'Day 1: Prayed for patience at work.\nDay 3: Prayed for my family.\nDay 7: Prayed for our prayer team.');
  console.log('  Left "Prayer Journal Challenge" as a second pending submission.');

  // A couple more pending submissions from the original seed's other
  // learners, so the Marking queue isn't a single-item demo.
  console.log('\n=== Filling out the Marking queue with other seeded learners ===');
  const ctxBrian = await contextFor('2', 'learner');
  await ensurePendingSubmission(nextStepsId, 2, "Spoke with the youth group leader — joining as a volunteer helper this month.");
  const ctxCarla = await contextFor('3', 'learner');
  await lms.completeLesson(ctxCarla, prayerHabitId).catch(() => {}); // Carla already failed the quiz once in the base seed; lesson itself may already be complete, harmless if so.
  await ensurePendingSubmission(journalChallengeId, 3, 'Prayed each morning this week before opening my laptop.');

  console.log('\nDone. Log into the portal as froe4009@gmail.com to see two in-progress courses with a pending assignment each, and check /admin/lms/marking as staff — 4 submissions should be waiting (contacts 8 x2, 2, 3). Grade contact 8\'s "Next Steps" submission to watch "Foundations of Church Membership" complete and auto-issue a certificate live.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
