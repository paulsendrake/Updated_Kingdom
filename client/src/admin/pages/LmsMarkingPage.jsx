import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import FormErrorBanner from '../../components/FormErrorBanner.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

function GradeModal({ submission, onClose, onGraded }) {
  const [score, setScore] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const n = Number(score);
    if (!Number.isInteger(n) || n < 0 || n > 100) { setError('Enter a score from 0 to 100.'); return; }
    setBusy(true);
    try {
      await api.post(`/lms/submissions/${submission.id}/grade`, { score: n, feedback: feedback.trim() || null });
      toast('Graded — the lesson is now marked complete for this learner.', 'success');
      onGraded();
      onClose();
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      show onClose={onClose} title="Grade Submission" size="lg"
      footer={<>
        <button className="btn btn-outline-dark" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save grade'}</button>
      </>}
    >
      <FormErrorBanner error={error} />
      <div className="mb-3">
        <div className="fw-semibold">{submission.contact_name}</div>
        <div className="text-muted small">{submission.contact_email}</div>
        <div className="text-muted small mt-1">
          {submission.course_title} — {submission.lesson_title}
        </div>
        <div className="text-muted small">
          Submitted {new Date(submission.submitted_at).toLocaleString()}
        </div>
      </div>
      <div className="card bg-light mb-3">
        <div className="card-body" style={{ whiteSpace: 'pre-wrap' }}>
          {submission.body_text || <span className="text-muted">No text submitted.</span>}
        </div>
      </div>
      {submission.attachment_object_key && (
        <div className="mb-3">
          <a href={`/api/lms/files/${submission.attachment_object_key}`} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline-dark">
            <iconify-icon icon="solar:paperclip-line-duotone" class="me-1"></iconify-icon> View attachment
          </a>
        </div>
      )}
      <div className="row g-2">
        <div className="col-md-4">
          <label className="form-label">Score <span className="text-muted small">(0-100)</span></label>
          <input type="number" min="0" max="100" className="form-control" value={score} onChange={(e) => setScore(e.target.value)} autoFocus />
        </div>
        <div className="col-12">
          <label className="form-label">Feedback <span className="text-muted small">(optional)</span></label>
          <textarea className="form-control" rows="3" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

export default function LmsMarkingPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [grading, setGrading] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/lms/submissions', { params: { status: 'pending' } });
      setRows(data);
    } catch (e) {
      toast(parseApiError(e), 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  return (
    <div>
      <PageHeader
        title="Marking"
        subtitle="Assignments handed in and not yet marked, oldest first"
        actions={<Link to="/admin/lms/gradebook" className="btn btn-outline-dark">Gradebook</Link>}
      />

      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Course / Lesson</th>
                  <th>Submitted</th>
                  <th style={{ width: 120 }} className="text-end">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="fw-semibold">{r.contact_name || '—'}</div>
                      <div className="text-muted small">{r.contact_email}</div>
                    </td>
                    <td>
                      <div>{r.course_title || '—'}</div>
                      <div className="text-muted small">{r.lesson_title}</div>
                    </td>
                    <td className="text-muted small">{new Date(r.submitted_at).toLocaleString()}</td>
                    <td className="text-end">
                      <button className="btn btn-sm btn-primary" onClick={() => setGrading(r)}>
                        <iconify-icon icon="solar:pen-new-square-line-duotone" class="me-1"></iconify-icon> Grade
                      </button>
                    </td>
                  </tr>
                ))}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan="4">
                    <div className="empty-state">
                      <div className="fw-semibold">Nothing waiting</div>
                      <div className="text-muted small">Every assignment handed in has been marked.</div>
                    </div>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {grading && <GradeModal submission={grading} onClose={() => setGrading(null)} onGraded={load} />}
    </div>
  );
}
