import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../../../api/client.js';
import { parseApiError } from '../../../utils/apiError.js';
import { renderLessonBody } from '../../../utils/renderLessonBody.js';
import { toast } from '../../../components/Toast.jsx';

function QuizSection({ lessonId }) {
  const [paper, setPaper] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    setLoading(true);
    setResult(null);
    setAnswers({});
    api.get(`/portal/lms/lessons/${lessonId}/quiz`)
      .then((r) => setPaper(r.data))
      .catch((e) => setError(parseApiError(e)))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [lessonId]);

  async function submit() {
    if (paper.questions.some((q) => !answers[q.id])) {
      toast('Answer every question before submitting.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post(`/portal/lms/quizzes/${paper.id}/attempts`, { answers });
      setResult(data);
    } catch (e) {
      toast(parseApiError(e), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="text-muted small">Loading quiz…</div>;
  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!paper) return null;

  if (result) {
    const reviewByQuestion = new Map(result.review.map((r) => [r.questionId, r]));
    return (
      <div className="card mt-3">
        <div className="card-body">
          <div className={`alert ${result.passed ? 'alert-success' : 'alert-warning'} d-flex align-items-center gap-2`}>
            <iconify-icon icon={result.passed ? 'solar:check-circle-bold' : 'solar:danger-triangle-bold'} class="fs-4"></iconify-icon>
            <div>
              <strong>{result.passed ? 'Passed' : 'Not quite'}</strong> — scored {result.score}% (passing is {result.passingScore}%).
              {!result.passed && result.attemptsLeft !== null && ` ${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? '' : 's'} left.`}
            </div>
          </div>
          {paper.questions.map((q) => {
            const r = reviewByQuestion.get(q.id);
            return (
              <div key={q.id} className="mb-3">
                <div className="fw-semibold mb-1">{q.prompt}</div>
                {q.options.map((o) => {
                  const isChosen = r?.chosenOptionId === o.id;
                  const isCorrect = r?.correctOptionId === o.id;
                  let cls = 'list-group-item';
                  if (isCorrect) cls += ' list-group-item-success';
                  else if (isChosen && !isCorrect) cls += ' list-group-item-danger';
                  return <div key={o.id} className={cls}>{o.label}</div>;
                })}
                {r?.explanation && <div className="small text-muted mt-1">{r.explanation}</div>}
              </div>
            );
          })}
          {!result.passed && (result.attemptsLeft === null || result.attemptsLeft > 0) && (
            <button className="btn btn-primary" onClick={load}>Try Again</button>
          )}
        </div>
      </div>
    );
  }

  const outOfAttempts = paper.attemptsLeft !== null && paper.attemptsLeft <= 0;

  return (
    <div className="card mt-3">
      <div className="card-body">
        <h5 className="fw-bold mb-1">{paper.title}</h5>
        {paper.instructions && <p className="text-muted small">{paper.instructions}</p>}
        <div className="small text-muted mb-3">
          Passing score {paper.passingScore}%
          {paper.attemptsLeft !== null && ` · ${paper.attemptsLeft} attempt${paper.attemptsLeft === 1 ? '' : 's'} left`}
          {paper.hasPassed && <span className="badge bg-success-subtle text-success ms-2">Already passed</span>}
        </div>

        {outOfAttempts ? (
          <div className="alert alert-secondary mb-0">You've used all your attempts at this quiz.</div>
        ) : (
          <>
            {paper.questions.map((q, qi) => (
              <div key={q.id} className="mb-3">
                <div className="fw-semibold mb-1">{qi + 1}. {q.prompt}</div>
                {q.options.map((o) => (
                  <div key={o.id} className="form-check">
                    <input
                      className="form-check-input" type="radio" name={`q-${q.id}`} id={`opt-${o.id}`}
                      checked={answers[q.id] === o.id}
                      onChange={() => setAnswers({ ...answers, [q.id]: o.id })}
                    />
                    <label className="form-check-label" htmlFor={`opt-${o.id}`}>{o.label}</label>
                  </div>
                ))}
              </div>
            ))}
            <button className="btn btn-primary" onClick={submit} disabled={submitting}>Submit</button>
          </>
        )}
      </div>
    </div>
  );
}

// Assignment-kind lessons replace the generic Mark Complete toggle with
// this — completion for an assignment only happens once staff grades it
// (routes/lms.js's POST /submissions/:id/grade), since the mark is what the
// learner is actually waiting on. Submitting doesn't complete the lesson.
function AssignmentSubmission({ lessonId, onGraded }) {
  const [latest, setLatest] = useState(undefined); // undefined = loading
  const [bodyText, setBodyText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Returns its promise so submit() can wait for it; see below.
  function load() {
    return api.get(`/portal/lms/lessons/${lessonId}/submissions`)
      .then((r) => setLatest(r.data?.[0] || null))
      .catch(() => setLatest(null));
  }
  useEffect(() => { setLatest(undefined); setBodyText(''); load(); }, [lessonId]);

  async function submit() {
    if (!bodyText.trim()) return;
    setSubmitting(true);
    try {
      await api.post(`/portal/lms/lessons/${lessonId}/submissions`, { bodyText: bodyText.trim() });
      toast('Submitted — you’ll see your mark here once it’s reviewed.', 'success');
      /*
       * Awaited, and the box cleared, to close a double-submit window.
       *
       * `load()` used to be fired and not waited for, so `finally` re-enabled
       * the button while `latest` was still the old value — leaving the form
       * on screen, with the text still in it, for as long as the reload took.
       * A second click there is a second row: lms_lesson_submissions has no
       * unique key on (lesson_id, contact_id) and the insert is a plain
       * INSERT, so nothing below this line would have stopped it, and the
       * assignment would appear twice on a marker's queue.
       */
      setBodyText('');
      await load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  if (latest === undefined) return <div className="text-muted small">Loading submission…</div>;

  /*
   * What they wrote, shown back to them.
   *
   * Both states below used to be dead ends: "waiting to be marked" and
   * nothing else, or a score and feedback and nothing else. The work itself
   * was never shown back, so somebody reading "this does not answer the
   * second part" had no way to see what they had said, and somebody waiting
   * on a mark could not check what they had sent. The endpoint has been
   * returning body_text and submitted_at the whole time; the component
   * fetched them and used neither.
   *
   * Collapsed behind a <details> rather than always open, because the mark
   * and the feedback are what somebody came for and their own essay pushing
   * those off the screen would be a different complaint.
   */
  const submittedWork = latest?.body_text ? (
    <details className="mt-2">
      <summary className="small text-muted" style={{ cursor: 'pointer' }}>
        What you submitted
        {latest.submitted_at ? ` \u00b7 ${new Date(latest.submitted_at).toLocaleString()}` : ''}
      </summary>
      <div className="small mt-2 p-2 bg-body-secondary rounded" style={{ whiteSpace: 'pre-wrap' }}>
        {latest.body_text}
      </div>
    </details>
  ) : null;

  if (latest?.status === 'graded') {
    return (
      <div className="card mb-3">
        <div className="card-body">
          <div className="d-flex align-items-center gap-2 mb-2">
            <iconify-icon icon="solar:diploma-verified-bold" class="text-success fs-4"></iconify-icon>
            <h6 className="fw-bold mb-0">Marked — {latest.score}%</h6>
          </div>
          {latest.feedback && <p className="mb-0">{latest.feedback}</p>}
          {submittedWork}
        </div>
      </div>
    );
  }

  if (latest?.status === 'pending') {
    return (
      <div className="alert alert-secondary mb-3">
        <div>
          <iconify-icon icon="solar:clock-circle-line-duotone" class="me-1"></iconify-icon>
          Submitted — waiting to be marked.
        </div>
        {submittedWork}
      </div>
    );
  }

  return (
    <div className="card mb-3">
      <div className="card-body">
        <h6 className="fw-bold mb-2">Submit your assignment</h6>
        <textarea
          className="form-control mb-2" rows={6} value={bodyText}
          onChange={(e) => setBodyText(e.target.value)}
          placeholder="Write your response here…"
        />
        <button className="btn btn-primary" onClick={submit} disabled={submitting || !bodyText.trim()}>
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </div>
    </div>
  );
}

export default function PortalLessonView() {
  const { courseSlug, lessonSlug } = useParams();
  const navigate = useNavigate();
  const [lesson, setLesson] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const lastReportedRef = useRef(0);
  const currentTimeRef = useRef(0);
  const lessonIdRef = useRef(null);

  // Best-effort — never blocks playback or surfaces an error to the learner.
  // Throttled to once per 10s of actual progress, plus a final report on
  // pause/unmount so a short clip or an early pause isn't lost.
  function postProgress(lessonId, seconds) {
    const s = Math.floor(seconds);
    api.post(`/portal/lms/lessons/${lessonId}/progress`, { secondsWatched: s, lastPositionSeconds: s }).catch(() => {});
  }
  function reportProgress(seconds) {
    const s = Math.floor(seconds);
    currentTimeRef.current = s;
    if (s < lastReportedRef.current + 10 && s !== 0) return;
    lastReportedRef.current = s;
    postProgress(lesson.id, s);
  }
  /*
   * Flush the watch time when the lesson changes, not only on unmount.
   *
   * The final report used to hang off an effect with no dependencies, which
   * fires its cleanup only when the component actually unmounts. This route
   * is `learning/:courseSlug/:lessonSlug` with one element, so React Router
   * reuses the component when moving from one lesson to the next: it does
   * not unmount, and the cleanup did not run. Two things followed.
   *
   * Anything under the ten-second throttle was simply lost — watch seven
   * seconds, click the next lesson, and nothing was ever recorded.
   *
   * Worse, `currentTimeRef` was not cleared, so those seven seconds stayed in
   * it while `lessonIdRef` moved on to the new lesson. The next flush posted
   * one lesson's watch time against another. Progress that is wrong is worse
   * than progress that is missing: it is invisible, and it is what a report
   * to a cohort leader is built from.
   *
   * Keying the effect on the lesson id fixes both. The id is captured in the
   * closure, so the cleanup always posts to the lesson it belongs to, and
   * React runs it on a change and on unmount alike.
   */
  useEffect(() => {
    const id = lesson?.id;
    if (!id) return undefined;
    lessonIdRef.current = id;
    currentTimeRef.current = 0;
    lastReportedRef.current = 0;
    return () => {
      if (currentTimeRef.current > 0) postProgress(id, currentTimeRef.current);
      currentTimeRef.current = 0;
    };
  }, [lesson?.id]);

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get(`/portal/lms/courses/${courseSlug}/lessons/${lessonSlug}`)
      .then((r) => setLesson(r.data))
      .catch((e) => setError(parseApiError(e)))
      .finally(() => setLoading(false));
  }, [courseSlug, lessonSlug]);

  async function toggleComplete() {
    setBusy(true);
    try {
      if (lesson.progress?.status === 'completed') {
        await api.post(`/portal/lms/lessons/${lesson.id}/uncomplete`);
      } else {
        const { data } = await api.post(`/portal/lms/lessons/${lesson.id}/complete`);
        if (data.courseCompleted) toast('Course complete! 🎉', 'success');
      }
      const { data: fresh } = await api.get(`/portal/lms/courses/${courseSlug}/lessons/${lessonSlug}`);
      setLesson(fresh);
    } catch (e) {
      toast(parseApiError(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="text-muted">Loading…</div>;
  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!lesson) return <div className="empty-state">Lesson not found.</div>;

  const isCompleted = lesson.progress?.status === 'completed';

  return (
    <div>
      <Link to={`/portal/learning/${courseSlug}`} className="btn btn-sm btn-outline-dark mb-3">← {lesson.courseTitle}</Link>

      <div className="small text-muted mb-1">{lesson.moduleTitle}</div>
      <h3 className="fw-bolder mb-3">{lesson.title}</h3>

      {lesson.video?.url && (
        <video
          controls
          preload="metadata"
          poster={lesson.video.poster}
          className="w-100 rounded mb-3"
          style={{ maxHeight: 480, background: '#000' }}
          onTimeUpdate={(e) => reportProgress(e.currentTarget.currentTime)}
          onPause={(e) => reportProgress(e.currentTarget.currentTime)}
        >
          <source src={lesson.video.url} />
        </video>
      )}
      {lesson.kind === 'video' && lesson.videoStatus === 'processing' && !lesson.video?.url && (
        <div className="alert alert-secondary mb-3">Video is still processing — check back shortly.</div>
      )}

      {lesson.body && (
        <div
          className="mb-3"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: renderLessonBody(lesson.body, lesson.bodyFormat) }}
        />
      )}

      {lesson.keyPoints.length > 0 && (
        <div className="card mb-3">
          <div className="card-body">
            <h6 className="fw-bold mb-2">Key Points</h6>
            <ul className="mb-0">{lesson.keyPoints.map((k, i) => <li key={i}>{k}</li>)}</ul>
          </div>
        </div>
      )}

      {lesson.reflectionQuestions.length > 0 && (
        <div className="card mb-3">
          <div className="card-body">
            <h6 className="fw-bold mb-2">Reflect</h6>
            <ul className="mb-0">{lesson.reflectionQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul>
          </div>
        </div>
      )}

      {lesson.attachments.length > 0 && (
        <div className="card mb-3">
          <div className="card-body">
            <h6 className="fw-bold mb-2">Attachments</h6>
            <ul className="list-unstyled mb-0">
              {lesson.attachments.map((a) => (
                <li key={a.id}>
                  <a href={a.url} target="_blank" rel="noreferrer">
                    <iconify-icon icon="solar:paperclip-line-duotone" class="me-1"></iconify-icon>{a.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {lesson.kind === 'assignment' && <AssignmentSubmission lessonId={lesson.id} />}

      <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
        {lesson.kind !== 'assignment' && (
          <button className={`btn ${isCompleted ? 'btn-outline-success' : 'btn-success'}`} onClick={toggleComplete} disabled={busy}>
            <iconify-icon icon={isCompleted ? 'solar:check-circle-bold' : 'solar:check-circle-line-duotone'} class="me-1"></iconify-icon>
            {isCompleted ? 'Completed' : 'Mark Complete'}
          </button>
        )}
        {lesson.kind === 'assignment' && isCompleted && (
          <span className="badge bg-success-subtle text-success">
            <iconify-icon icon="solar:check-circle-bold" class="me-1"></iconify-icon>Completed
          </span>
        )}
        <div className="d-flex gap-2 ms-auto">
          {lesson.previousSlug && (
            <button className="btn btn-outline-dark" onClick={() => navigate(`/portal/learning/${courseSlug}/${lesson.previousSlug}`)}>← Previous</button>
          )}
          {lesson.nextSlug && (
            <button className="btn btn-outline-dark" onClick={() => navigate(`/portal/learning/${courseSlug}/${lesson.nextSlug}`)}>Next →</button>
          )}
        </div>
      </div>

      {lesson.hasQuiz && <QuizSection lessonId={lesson.id} />}
    </div>
  );
}
