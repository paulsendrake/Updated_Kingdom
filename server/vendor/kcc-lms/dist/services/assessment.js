/**
 * Quizzes: sitting them, scoring them, and counting attempts.
 *
 * The rule that earns the care here is that **the correct answers never leave
 * the server before an attempt is submitted.** A quiz handed to the browser
 * with `isCorrect` on each option is a quiz anybody can pass by reading the
 * page source, and that is the normal way this gets built, because the
 * natural query selects the whole options table.
 *
 * So there are two shapes: `QuizPaper`, which is what a learner is given and
 * carries no answers, and `QuizResult`, which exists only after a submission.
 * The store enforces the first by naming its columns — see `paperFor()`.
 */
import { hasAtLeast } from '../ports.js';
import { LmsConflict, LmsForbidden, LmsInvalid, LmsNotFound } from '../errors.js';
import { emit } from '../context.js';
import { requireEntitlement } from './enrolment.js';
async function quizWithCourse(context, quizId) {
    const found = await context.store.findQuizById(quizId);
    if (!found)
        throw new LmsNotFound('No such quiz.');
    await requireEntitlement(context, found.courseId);
    if (!found.lessonPublished && context.viewer.role === 'learner')
        throw new LmsNotFound('No such quiz.');
    return found;
}
/** The paper, as a learner gets it. */
/**
 * Pick `count` of `ids`, without replacement.
 *
 * A Fisher-Yates shuffle over a copy, stopping once enough have been taken.
 * Deliberately not `sort(() => Math.random() - 0.5)`, which is the usual
 * shortcut and is not a shuffle: comparison sorts assume a consistent
 * comparator, and with a random one the result is biased towards the original
 * order — which on a question bank means the same questions coming up far
 * more often than the rest.
 */
function deal(ids, count, random) {
    const pool = [...ids];
    const take = Math.min(count, pool.length);
    for (let i = 0; i < take; i += 1) {
        const j = i + Math.floor(random() * (pool.length - i));
        // Written out rather than destructured: under noUncheckedIndexedAccess a
        // swap through index signatures is `string | undefined` on both sides.
        const here = pool[i];
        const there = pool[j];
        pool[i] = there;
        pool[j] = here;
    }
    return pool.slice(0, take);
}
/**
 * The paper this learner is sitting, which is not always the whole quiz.
 *
 * With `drawSize` unset the quiz behaves as it always has: every question, in
 * authoring order. With it set the quiz is a bank, and each learner is dealt
 * that many of its questions.
 *
 * The draw is stored rather than made on the fly, because the paper is read
 * in one request and answered in another. A draw made fresh each read would
 * deal a new hand on every refresh, and the answers posted back would be
 * marked against questions the learner was never shown. So: reuse the open
 * draw if there is one, otherwise deal and write it down.
 *
 * Order is the draw's order, not the bank's, so two learners do not get the
 * same questions in the same sequence either.
 */
async function dealtPaper(context, quiz) {
    const all = await context.store.paperFor(quiz.id);
    const size = quiz.drawSize;
    // No bank, or a bank smaller than the hand asked for: ask everything, and
    // do not write a draw for it — there is nothing to remember.
    if (size === null || size <= 0 || size >= all.length)
        return all;
    const open = await context.store.openDrawFor(quiz.id, context.viewer.id);
    let chosen = open?.questionIds ?? [];
    // A draw can outlive the questions it names, if authoring removed one
    // between the paper being dealt and it being sat. Treat a draw that no
    // longer resolves as spent and deal again rather than serving a short paper.
    const byId = new Map(all.map((question) => [question.id, question]));
    if (chosen.length === 0 || chosen.some((id) => !byId.has(id))) {
        chosen = deal(await context.store.questionIdsFor(quiz.id), size, context.random);
        await context.store.insertDraw({
            id: context.store.newId(),
            quizId: quiz.id,
            userId: context.viewer.id,
            questionIds: chosen,
            drawnAt: context.clock.now(),
        });
    }
    return chosen.map((id) => byId.get(id)).filter((q) => q !== undefined);
}
export async function getQuizPaper(context, lessonId) {
    const quiz = await context.store.findQuizByLesson(lessonId);
    if (!quiz)
        return null;
    await quizWithCourse(context, quiz.id);
    const questions = await dealtPaper(context, quiz);
    const attempts = await context.store.attemptsFor(quiz.id, context.viewer.id);
    const attemptsTaken = attempts.length;
    const bestScore = attempts.length === 0 ? null : Math.max(...attempts.map((a) => a.score));
    return {
        id: quiz.id,
        lessonId: quiz.lessonId,
        title: quiz.title,
        instructions: quiz.instructions,
        passingScore: quiz.passingScore,
        maxAttempts: quiz.maxAttempts,
        attemptsTaken,
        // Zero means unlimited, and `null` says so rather than reporting a
        // negative number of attempts left.
        attemptsLeft: quiz.maxAttempts === 0 ? null : Math.max(0, quiz.maxAttempts - attemptsTaken),
        bestScore,
        hasPassed: attempts.some((a) => a.passed),
        questions,
    };
}
/**
 * Marks an attempt, as a pure function over the stored questions and options.
 *
 * Separated from the writes so the arithmetic can be read and checked on its
 * own. Nothing the client sends about correctness reaches it — only which
 * option was chosen per question.
 */
export function markAttempt(input) {
    const correctByQuestion = new Map();
    const optionsByQuestion = new Map();
    for (const option of input.options) {
        if (!optionsByQuestion.has(option.questionId))
            optionsByQuestion.set(option.questionId, new Set());
        optionsByQuestion.get(option.questionId).add(option.id);
        if (option.isCorrect)
            correctByQuestion.set(option.questionId, option.id);
    }
    /*
     * Answers are filtered to this quiz's own options before anything is
     * stored. Without it, a submission can carry an option id from a different
     * quiz — or an arbitrary string — and the stored attempt becomes a record
     * of something that never happened.
     */
    const clean = {};
    for (const question of input.questions) {
        const chosen = input.answers[question.id];
        if (chosen && optionsByQuestion.get(question.id)?.has(chosen))
            clean[question.id] = chosen;
    }
    const review = input.questions.map((question) => {
        const chosen = clean[question.id] ?? null;
        const correct = correctByQuestion.get(question.id) ?? null;
        return {
            questionId: question.id,
            prompt: question.prompt,
            chosenOptionId: chosen,
            correctOptionId: correct,
            wasCorrect: chosen !== null && chosen === correct,
            explanation: question.explanation,
        };
    });
    /*
     * Divided by every question, not by the ones answered. An unanswered
     * question counts as wrong rather than being skipped, because otherwise
     * leaving out the questions you do not know raises your percentage —
     * answer one of twenty correctly and score 100%.
     */
    const right = review.filter((row) => row.wasCorrect).length;
    const score = Math.round((right / input.questions.length) * 100);
    return { score, passed: score >= input.passingScore, clean, review };
}
/** Scores an attempt and records it. */
export async function submitAttempt(context, input) {
    const quiz = await quizWithCourse(context, input.quizId);
    const attemptsTaken = await context.store.countAttempts(quiz.id, context.viewer.id);
    if (quiz.maxAttempts > 0 && attemptsTaken >= quiz.maxAttempts) {
        throw new LmsConflict('You have used all your attempts at this quiz.');
    }
    const whole = await context.store.scoringQuestions(quiz.id);
    if (whole.length === 0)
        throw new LmsInvalid('That quiz has no questions yet.');
    const options = await context.store.scoringOptions(quiz.id);
    /*
     * Mark the paper they sat, not the bank it came from.
     *
     * On a quiz with a draw, scoring against every question would count the
     * ones they were never shown as unanswered and wrong — a learner could
     * answer all ten of their ten correctly and be told they scored thirty per
     * cent. So the open draw decides the question set, and spending it below
     * ties it to this attempt.
     */
    const draw = quiz.drawSize === null ? null : await context.store.openDrawFor(quiz.id, context.viewer.id);
    const drawn = draw === null ? null : new Set(draw.questionIds);
    const questions = drawn === null ? whole : whole.filter((question) => drawn.has(question.id));
    if (questions.length === 0)
        throw new LmsInvalid('That quiz has no questions yet.');
    const marked = markAttempt({
        questions,
        options,
        answers: input.answers,
        passingScore: quiz.passingScore,
    });
    const attemptId = context.store.newId();
    await context.store.insertAttempt({
        id: attemptId,
        quizId: quiz.id,
        userId: context.viewer.id,
        score: marked.score,
        passed: marked.passed,
        answers: marked.clean,
        submittedAt: context.clock.now(),
    });
    // Closed only after the attempt exists, so a failure above leaves the draw
    // open and the learner sitting the same paper rather than a new one.
    if (draw !== null)
        await context.store.spendDraw(draw.id, attemptId);
    const attemptsLeft = quiz.maxAttempts === 0 ? null : Math.max(0, quiz.maxAttempts - (attemptsTaken + 1));
    emit(context, marked.passed
        ? { kind: 'quiz.passed', userId: context.viewer.id, quizId: quiz.id, score: marked.score }
        : {
            kind: 'quiz.failed',
            userId: context.viewer.id,
            quizId: quiz.id,
            score: marked.score,
            attemptsLeft: attemptsLeft ?? 0,
        });
    return {
        attemptId,
        score: marked.score,
        passed: marked.passed,
        passingScore: quiz.passingScore,
        attemptsLeft,
        review: marked.review,
    };
}
/** Somebody's attempts at one quiz. Their own, or anybody's if staff. */
export async function attemptsFor(context, quizId, userId) {
    if (userId !== context.viewer.id && !hasAtLeast(context.viewer, 'instructor')) {
        throw new LmsForbidden('You can only see your own attempts.');
    }
    await quizWithCourse(context, quizId);
    return context.store.attemptsFor(quizId, userId);
}
