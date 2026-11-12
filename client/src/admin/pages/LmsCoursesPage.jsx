import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import FormErrorBanner from '../../components/FormErrorBanner.jsx';
import AiDraftButton from '../../components/AiDraftButton.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { useAuth } from '../../auth/AuthContext.jsx';

const LEVELS = ['foundation', 'intermediate', 'advanced'];
const STATUS_BADGE = {
  draft:     'bg-secondary-subtle text-secondary',
  published: 'bg-success-subtle text-success',
  archived:  'bg-warning-subtle text-warning',
};

function linesToList(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
}
function listToLines(list) {
  return (list || []).join('\n');
}

function blankCourse() {
  return {
    id: null, title: '', subtitle: '', summary: '', description: '',
    level: 'foundation', language: 'English', audience: '',
    outcomes: '', prerequisites: '', topics: '', estimatedMinutes: '',
  };
}

// "Draft with AI" prompt dialog — asks what the course should cover, then
// kicks off server/src/services/ai.js's draftCurriculum() and hands off to
// the review page (LmsCurriculumDraftPage) rather than creating anything
// here directly — a draft is always staged for review before it becomes a
// real course.
function DraftWithAiModal({ onClose }) {
  const navigate = useNavigate();
  const [topic, setTopic] = useState('');
  const [audience, setAudience] = useState('');
  const [goals, setGoals] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function generate() {
    if (!topic.trim()) { setError('A topic is required.'); return; }
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/lms/curriculum-drafts', {
        topic: topic.trim(), audience: audience.trim() || null, goals: goals.trim() || null,
      });
      navigate(`/admin/lms/curriculum/${data.id}`);
    } catch (e) {
      setError(parseApiError(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      show onClose={onClose} title="Draft with AI" size="md"
      footer={<>
        <button className="btn btn-outline-dark" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={generate} disabled={busy}>
          {busy ? 'Drafting…' : 'Generate outline'}
        </button>
      </>}
    >
      <FormErrorBanner error={error} />
      <div className="row g-2">
        <div className="col-12">
          <label className="form-label">Topic</label>
          <input className="form-control" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Financial stewardship for new believers" autoFocus />
        </div>
        <div className="col-12">
          <label className="form-label">Audience <span className="text-muted small">(optional)</span></label>
          <input className="form-control" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="New members, small group leaders…" />
        </div>
        <div className="col-12">
          <label className="form-label">Goals <span className="text-muted small">(optional)</span></label>
          <textarea className="form-control" rows="2" value={goals} onChange={(e) => setGoals(e.target.value)} />
        </div>
      </div>
      <div className="form-text mt-2">
        You'll review and edit the generated outline before any course is created.
      </div>
    </Modal>
  );
}

export default function LmsCoursesPage() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [showDraftAi, setShowDraftAi] = useState(false);
  const [form, setForm] = useState(blankCourse());
  const [formError, setFormError] = useState('');
  const [busyId, setBusyId] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/lms/courses');
      setRows(data);
    } catch (e) {
      toast(parseApiError(e), 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  function openNew() { setForm(blankCourse()); setFormError(''); setShow(true); }
  function openEdit(c) {
    setForm({
      id: c.id, title: c.title, subtitle: c.subtitle || '', summary: c.summary || '',
      description: c.description || '', level: c.level, language: c.language,
      audience: c.audience || '', outcomes: listToLines(c.outcomes),
      prerequisites: listToLines(c.prerequisites), topics: listToLines(c.topics),
      estimatedMinutes: c.estimatedMinutes ?? '',
    });
    setFormError('');
    setShow(true);
  }

  async function save() {
    if (!form.title.trim()) { setFormError('A title is required.'); return; }
    const payload = {
      title: form.title.trim(),
      subtitle: form.subtitle.trim() || null,
      summary: form.summary.trim() || null,
      description: form.description.trim() || null,
      level: form.level,
      language: form.language.trim() || 'English',
      audience: form.audience.trim() || null,
      outcomes: linesToList(form.outcomes),
      prerequisites: linesToList(form.prerequisites),
      topics: linesToList(form.topics),
      estimatedMinutes: form.estimatedMinutes ? Number(form.estimatedMinutes) : null,
    };
    try {
      if (form.id) await api.put(`/lms/courses/${form.id}`, payload);
      else await api.post('/lms/courses', payload);
      setShow(false);
      load();
    } catch (e) {
      setFormError(parseApiError(e));
    }
  }

  async function setStatus(course, status) {
    setBusyId(course.id);
    try {
      await api.post(`/lms/courses/${course.id}/status`, { status });
      load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Courses"
        subtitle="The Learning module's course catalog"
        actions={can('lms.write') && (<>
          <button className="btn btn-outline-dark" onClick={() => setShowDraftAi(true)}>
            <iconify-icon icon="solar:stars-line-duotone" class="me-1"></iconify-icon> Draft with AI
          </button>
          <button className="btn btn-primary" onClick={openNew}>
            <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> New Course
          </button>
        </>)}
      />

      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Level</th>
                  <th>Status</th>
                  <th style={{ width: 160 }} className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/admin/lms/courses/${c.id}`} className="fw-semibold text-decoration-none">{c.title}</Link>
                      {c.subtitle && <div className="text-muted small">{c.subtitle}</div>}
                    </td>
                    <td className="text-capitalize">{c.level}</td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[c.status] || 'bg-secondary-subtle text-secondary'} text-capitalize`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="text-end">
                      <div className="d-flex gap-1 justify-content-end flex-wrap">
                        <Link to={`/admin/lms/courses/${c.id}`} className="btn btn-sm btn-outline-dark" title="Modules & lessons">
                          <iconify-icon icon="solar:widget-5-line-duotone"></iconify-icon>
                        </Link>
                        {can('lms.write') && (<>
                          <button className="btn btn-sm btn-outline-dark" onClick={() => openEdit(c)} title="Edit">
                            <iconify-icon icon="solar:pen-line-duotone"></iconify-icon>
                          </button>
                          {c.status !== 'published' && (
                            <button
                              className="btn btn-sm btn-outline-dark"
                              disabled={busyId === c.id}
                              onClick={() => setStatus(c, 'published')}
                              title="Publish — needs at least one published lesson"
                            >
                              <iconify-icon icon="solar:play-circle-line-duotone"></iconify-icon>
                            </button>
                          )}
                          {c.status !== 'archived' && (
                            <button className="btn btn-sm btn-outline-dark" disabled={busyId === c.id} onClick={() => setStatus(c, 'archived')} title="Archive">
                              <iconify-icon icon="solar:archive-line-duotone"></iconify-icon>
                            </button>
                          )}
                          {c.status === 'archived' && (
                            <button className="btn btn-sm btn-outline-dark" disabled={busyId === c.id} onClick={() => setStatus(c, 'draft')} title="Restore to draft">
                              <iconify-icon icon="solar:restart-line-duotone"></iconify-icon>
                            </button>
                          )}
                        </>)}
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan="4"><div className="empty-state">No courses yet — create one to start building the catalog.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="text-muted small mt-2">
        Click a course to build out its modules, lessons and quizzes — a course needs at least one
        published lesson before it can be published. See <Link to="/admin/lms/cohorts">Cohorts</Link> to
        enroll contacts and release courses once ready.
      </div>

      <Modal
        show={show}
        onClose={() => setShow(false)}
        title={form.id ? 'Edit Course' : 'New Course'}
        size="lg"
        footer={<>
          <button className="btn btn-outline-dark" onClick={() => setShow(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </>}
      >
        <FormErrorBanner error={formError} />
        <div className="row g-2">
          <div className="col-12">
            <label className="form-label">Title</label>
            <input className="form-control" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Foundations of Pastoral Care" />
          </div>
          <div className="col-12">
            <label className="form-label">Subtitle</label>
            <input className="form-control" value={form.subtitle} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} />
          </div>
          <div className="col-12">
            <label className="form-label">Summary</label>
            <textarea className="form-control" rows="2" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
          </div>
          <div className="col-12">
            <label className="form-label">Description</label>
            <textarea className="form-control" rows="3" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <div className="mt-1">
              <AiDraftButton
                fieldLabel="course description"
                context={form.title ? `Course title: ${form.title}${form.summary ? `. Summary: ${form.summary}` : ''}` : form.summary}
                existingText={form.description}
                onGenerated={(text) => setForm((f) => ({ ...f, description: text }))}
              />
            </div>
          </div>
          <div className="col-md-4">
            <label className="form-label">Level</label>
            <select className="form-select" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>
              {LEVELS.map((l) => <option key={l} value={l} className="text-capitalize">{l}</option>)}
            </select>
          </div>
          <div className="col-md-4">
            <label className="form-label">Language</label>
            <input className="form-control" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} />
          </div>
          <div className="col-md-4">
            <label className="form-label">Estimated Minutes</label>
            <input type="number" min="1" className="form-control" value={form.estimatedMinutes} onChange={(e) => setForm({ ...form, estimatedMinutes: e.target.value })} />
          </div>
          <div className="col-12">
            <label className="form-label">Audience</label>
            <input className="form-control" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} placeholder="New members, small group leaders…" />
          </div>
          <div className="col-md-4">
            <label className="form-label">Outcomes <span className="text-muted small">(one per line)</span></label>
            <textarea className="form-control" rows="4" value={form.outcomes} onChange={(e) => setForm({ ...form, outcomes: e.target.value })} />
          </div>
          <div className="col-md-4">
            <label className="form-label">Prerequisites <span className="text-muted small">(one per line)</span></label>
            <textarea className="form-control" rows="4" value={form.prerequisites} onChange={(e) => setForm({ ...form, prerequisites: e.target.value })} />
          </div>
          <div className="col-md-4">
            <label className="form-label">Topics <span className="text-muted small">(one per line)</span></label>
            <textarea className="form-control" rows="4" value={form.topics} onChange={(e) => setForm({ ...form, topics: e.target.value })} />
          </div>
        </div>
      </Modal>

      {showDraftAi && <DraftWithAiModal onClose={() => setShowDraftAi(false)} />}
    </div>
  );
}
