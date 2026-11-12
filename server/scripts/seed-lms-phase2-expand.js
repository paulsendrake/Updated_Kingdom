#!/usr/bin/env node
// Further expands the LMS demo data (run seed-lms-demo.js and
// seed-lms-phase2-demo.js first) for a richer dashboard/portal demo:
//   - a 4th published course ("Serving on a Team") with its own cohort,
//     bringing in a contact (Eve Patel) not yet used anywhere in the LMS
//   - grades two of the existing pending submissions for real (through the
//     actual grade pipeline, not a raw UPDATE), producing real "graded"
//     history and a second auto-issued certificate — so Marking/Gradebook/
//     Transcript all show a mix of pending AND graded, not just one or the
//     other
//   - a sample AI curriculum draft row inserted directly (bypassing the
//     real Anthropic call, since no API key is configured locally) so
//     /admin/lms/curriculum/:id's review/edit/accept UI has something real
//     to exercise without needing AI configured
//
// Idempotent — matches by slug/title/existing rows, safe to re-run.
//
//   node scripts/seed-lms-phase2-expand.js

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { loadRuntime, contextFor } = require('../src/lms/runtime');
const { db } = require('../src/db');

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function ensureCourse(admin, lms, input) {
  const slug = slugify(input.title);
  let course = await admin.store.findCourseBySlug(slug);
  if (!course) {
    const created = await lms.createCourse(admin, input);
    course = await admin.store.findCourseById(created.id);
    console.log(`Created course "${course.title}" (${course.id})`);
  } else {
    console.log(`Course already exists: "${course.title}" (${course.id})`);
  }
  return course;
}
async function ensureModule(admin, lms, course, title, summary) {
  const existing = (await admin.store.outlineFor(course.id, 'staff:seed-script')).find((r) => r.moduleTitle === title);
  if (existing) return existing.moduleId;
  const { id } = await lms.createModule(admin, { courseId: course.id, title, summary });
  return id;
}
async function ensureLesson(admin, lms, course, moduleId, input) {
  const outline = await admin.store.outlineFor(course.id, 'staff:seed-script');
  const existing = outline.find((r) => r.moduleId === moduleId && r.lessonTitle === input.title);
  if (existing) return existing.lessonId;
  const created = await lms.createLesson(admin, { moduleId, ...input });
  await lms.updateLesson(admin, created.id, { isPublished: true });
  return created.id;
}
async function ensureQuiz(admin, lms, lessonId, input) {
  const existing = await admin.store.findQuizByLesson(lessonId);
  if (existing) return existing.id;
  const { id } = await lms.upsertQuiz(admin, { lessonId, ...input });
  return id;
}
async function ensureCohort(admin, lms, name, description) {
  const cohorts = await lms.listCohorts(admin);
  let cohort = cohorts.find((c) => c.name === name);
  if (!cohort) {
    const created = await lms.createCohort(admin, { name, description });
    cohort = { id: created.id, name };
    console.log(`Created cohort "${name}" (${created.id})`);
  }
  return cohort;
}

async function gradeSubmission(lms, store, submissionId, score, feedback) {
  const [[sub]] = await db.query('SELECT * FROM lms_lesson_submissions WHERE id = :id', { id: submissionId });
  if (!sub || sub.status === 'graded') { console.log(`  Submission #${submissionId} already graded or missing — skipping.`); return; }
  await db.query(
    `UPDATE lms_lesson_submissions SET status='graded', score=:score, feedback=:feedback, graded_at=NOW() WHERE id=:id`,
    { score, feedback, id: submissionId }
  );
  const ctx = await contextFor(String(sub.contact_id), 'learner');
  const result = await lms.completeLesson(ctx, sub.lesson_id);
  console.log(`  Graded submission #${submissionId} (score ${score}) — courseCompleted: ${result?.courseCompleted}`);
  if (result?.courseCompleted) {
    const found = await store.findLessonById(sub.lesson_id);
    if (found?.courseId) {
      const { issueCertificateIfComplete } = require('../src/services/lmsCertificates');
      const certId = await issueCertificateIfComplete({ courseId: found.courseId, contactId: sub.contact_id });
      console.log(`  -> Certificate issued (id ${certId}) for contact ${sub.contact_id}`);
    }
  }
}

(async () => {
  const { lms, store } = await loadRuntime();
  const admin = await contextFor('staff:seed-script', 'admin');

  console.log('=== Course 4: Serving on a Team ===');
  const course4 = await ensureCourse(admin, lms, {
    title: 'Serving on a Team',
    subtitle: 'Finding the right serving team and getting started well',
    summary: 'What it looks like to serve here, and how to pick a team that fits you.',
    level: 'foundation',
    language: 'English',
    audience: 'Anyone ready to start serving',
    outcomes: ['Understand our serving culture', 'Pick a team that fits your gifting'],
    estimatedMinutes: 25,
  });
  const whyServeId = await ensureModule(admin, lms, course4, 'Why We Serve', 'The heart behind serving here.');
  const servingCultureId = await ensureLesson(admin, lms, course4, whyServeId, {
    title: 'Our Serving Culture', kind: 'reading', bodyFormat: 'markdown', estimatedMinutes: 8,
    body: 'Everyone has a gift worth contributing — serving is how the church actually functions, not an extra.',
    keyPoints: ['Every member, not just staff, serves', 'Serving is formational, not just functional'],
  });
  await ensureQuiz(admin, lms, servingCultureId, {
    title: 'Serving Culture Check-in', instructions: 'A quick check.', passingScore: 70, maxAttempts: 3,
    questions: [{ prompt: 'Who is expected to serve here?', options: [
      { label: 'Every member, not just staff', isCorrect: true },
      { label: 'Only paid staff', isCorrect: false },
    ] }],
  });
  const pickTeamId = await ensureModule(admin, lms, course4, 'Pick a Team', 'Finding your fit.');
  const teamAssignmentId = await ensureLesson(admin, lms, course4, pickTeamId, {
    title: 'Your First Serving Shift', kind: 'assignment', bodyFormat: 'markdown', estimatedMinutes: 5,
    body: 'Sign up for one serving shift this month and tell us how it went.',
  });
  if (course4.status !== 'published') { await lms.setCourseStatus(admin, course4.id, 'published'); console.log('  Published course'); }

  const cohort4 = await ensureCohort(admin, lms, 'Serving Team Orientation', 'New volunteers getting oriented to a serving team.');
  for (const contactId of [5, 2, 4, 6]) {
    const ids = await store.cohortMemberIds(cohort4.id);
    if (!ids.includes(String(contactId))) { await lms.addMember(admin, cohort4.id, String(contactId)); console.log(`  Enrolled contact ${contactId}`); }
  }
  await lms.releaseCourse(admin, { cohortId: cohort4.id, courseId: course4.id }).catch(() => {});

  // Eve: finishes the reading + quiz, submits the assignment, and we grade
  // it right away — a full, already-complete, already-certified example on
  // a course nobody else has touched, so Gradebook/Transcript both have a
  // clean "done" row to show alongside the in-progress ones elsewhere.
  const ctxEve = await contextFor('5', 'learner');
  await lms.completeLesson(ctxEve, servingCultureId).catch(() => {});
  const paper = await lms.getQuizPaper(ctxEve, servingCultureId);
  if (paper && paper.attemptsTaken === 0) {
    const answers = {}; for (const q of paper.questions) answers[q.id] = q.options[0].id;
    await lms.submitAttempt(ctxEve, { quizId: paper.id, answers });
  }
  const [[existingSub]] = await db.query('SELECT id FROM lms_lesson_submissions WHERE lesson_id=:l AND contact_id=5', { l: teamAssignmentId });
  let eveSubId = existingSub?.id;
  if (!eveSubId) {
    const [ins] = await db.query(
      `INSERT INTO lms_lesson_submissions (lesson_id, contact_id, body_text) VALUES (:l, 5, :b)`,
      { l: teamAssignmentId, b: 'Served on the welcome team this Sunday — handed out programs and helped new families find seats. Would love to do it again!' }
    );
    eveSubId = ins.insertId;
  }
  await gradeSubmission(lms, store, eveSubId, 95, 'Great first shift, Eve — welcome team loved having you!');

  // Brian: on course 4 too, left in-progress (not started the assignment) —
  // another "in progress" row rather than everyone being done or pending.
  const ctxBrian = await contextFor('2', 'learner');
  await lms.completeLesson(ctxBrian, servingCultureId).catch(() => {});

  console.log('\n=== Grading two of the existing pending submissions for real history ===');
  // Contact 3 (Carla) on "Prayer Journal Challenge" — grade it, completing
  // "Growing in Prayer" for her and issuing her first certificate.
  const [[carlaSub]] = await db.query(
    `SELECT id FROM lms_lesson_submissions WHERE contact_id = 3 AND status = 'pending' ORDER BY id DESC LIMIT 1`
  );
  if (carlaSub) await gradeSubmission(lms, store, carlaSub.id, 88, 'Good consistency — keep the journal going.');

  // Contact 2 (Brian) on "Next Steps" — grade it (course 1 still won't hit
  // 100% for him since he hasn't done the other readings — a realistic
  // "one graded assignment, course still in progress" state).
  const [[brianSub]] = await db.query(
    `SELECT id FROM lms_lesson_submissions WHERE contact_id = 2 AND status = 'pending' ORDER BY id DESC LIMIT 1`
  );
  if (brianSub) await gradeSubmission(lms, store, brianSub.id, 80, "Good first step — let's keep it going.");

  console.log('\n=== Sample AI curriculum draft (no API key needed to view/edit/accept this) ===');
  const sampleDraft = {
    title: 'Understanding Baptism', subtitle: 'What it means and why we practice it',
    summary: 'A short course for anyone considering baptism here.',
    modules: [
      { title: 'What Baptism Means', summary: 'The biblical picture.', lessons: [
        { title: 'Why We Baptize', summary: 'The meaning behind the practice.', kind: 'reading', estimatedMinutes: 10, keyPoints: ['A public step of faith', 'Not required for salvation, but commanded by Jesus'] },
        { title: 'Questions People Ask', summary: 'Common questions answered.', kind: 'reading', estimatedMinutes: 8, keyPoints: ['Infant vs. believer baptism', 'What if I was baptized before?'] },
      ] },
      { title: 'Getting Ready', summary: 'Practical next steps.', lessons: [
        { title: 'Sign Up for a Baptism Date', summary: 'How to get on the schedule.', kind: 'assignment', estimatedMinutes: 5, keyPoints: ['Talk to a staff member', 'Invite your people to come watch'] },
      ] },
    ],
  };
  const [[existingDraft]] = await db.query(`SELECT id FROM lms_curriculum_drafts WHERE JSON_EXTRACT(draft_json, '$.title') = :t`, { t: sampleDraft.title });
  if (existingDraft) {
    console.log(`  Sample draft already exists (id ${existingDraft.id}) — visit /admin/lms/curriculum/${existingDraft.id}`);
  } else {
    const [ins] = await db.query(
      `INSERT INTO lms_curriculum_drafts (prompt_input, draft_json) VALUES (CAST(:input AS JSON), CAST(:draft AS JSON))`,
      { input: JSON.stringify({ topic: 'Understanding Baptism', audience: 'New believers', goals: 'Explain the practice and get people scheduled' }), draft: JSON.stringify(sampleDraft) }
    );
    console.log(`  Created sample draft (id ${ins.insertId}) — visit /admin/lms/curriculum/${ins.insertId}`);
  }

  console.log('\nDone.');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
