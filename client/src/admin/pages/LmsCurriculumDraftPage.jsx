import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

function linesToList(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
}
function listToLines(list) {
  return Array.isArray(list) ? list.join('\n') : '';
}

export default function LmsCurriculumDraftPage() {
  const { draftId } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [accepting, setAccepting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get(`/lms/curriculum-drafts/${draftId}`);
      setDraft(data.draft_json);
      setStatus(data.status);
    } catch (e) {
      toast(parseApiError(e), 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [draftId]);

  async function save() {
    setSaving(true);
    try {
      await api.put(`/lms/curriculum-drafts/${draftId}`, { draft });
      toast('Draft saved.', 'success');
    } catch (e) {
      toast(parseApiError(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function accept() {
    setAccepting(true);
    try {
      await save();
      const { data } = await api.post(`/lms/curriculum-drafts/${draftId}/accept`);
      toast('Course created from this draft.', 'success');
      navigate(`/admin/lms/courses/${data.courseId}`);
    } catch (e) {
      toast(parseApiError(e), 'error');
      setAccepting(false);
    }
  }

  function setModule(i, patch) {
    setDraft((d) => {
      const modules = [...d.modules];
      modules[i] = { ...modules[i], ...patch };
      return { ...d, modules };
    });
  }
  function setLesson(mi, li, patch) {
    setDraft((d) => {
      const modules = [...d.modules];
      const lessons = [...modules[mi].lessons];
      lessons[li] = { ...lessons[li], ...patch };
      modules[mi] = { ...modules[mi], lessons };
      return { ...d, modules };
    });
  }

  if (loading) return <div className="text-muted p-4">Loading draft…</div>;
  if (!draft) return <div className="text-muted p-4">Draft not found.</div>;

  return (
    <div>
      <PageHeader
        title="Review AI Draft"
        subtitle="Edit the generated outline, then create the course from it"
        actions={<>
          <button className="btn btn-outline-dark" onClick={save} disabled={saving || accepting}>
            {saving ? 'Saving…' : 'Save draft'}
          </button>
          <button className="btn btn-primary" onClick={accept} disabled={status !== 'draft' || accepting}>
            {accepting ? 'Creating…' : status !== 'draft' ? 'Already accepted' : 'Create course from this'}
          </button>
        </>}
      />

      <div className="card mb-3">
        <div className="card-body">
          <div className="row g-2">
            <div className="col-12">
              <label className="form-label">Title</label>
              <input className="form-control" value={draft.title || ''} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </div>
            <div className="col-12">
              <label className="form-label">Subtitle</label>
              <input className="form-control" value={draft.subtitle || ''} onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })} />
            </div>
            <div className="col-12">
              <label className="form-label">Summary</label>
              <textarea className="form-control" rows="2" value={draft.summary || ''} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
            </div>
          </div>
        </div>
      </div>

      {(draft.modules || []).map((mod, mi) => (
        <div className="card mb-3" key={mi}>
          <div className="card-header bg-light">
            <input
              className="form-control form-control-sm fw-semibold mb-1"
              value={mod.title || ''}
              onChange={(e) => setModule(mi, { title: e.target.value })}
              placeholder="Module title"
            />
            <input
              className="form-control form-control-sm text-muted"
              value={mod.summary || ''}
              onChange={(e) => setModule(mi, { summary: e.target.value })}
              placeholder="Module summary"
            />
          </div>
          <div className="card-body">
            {(mod.lessons || []).map((lesson, li) => (
              <div className="border rounded p-2 mb-2" key={li}>
                <div className="row g-2">
                  <div className="col-md-6">
                    <label className="form-label small">Lesson title</label>
                    <input className="form-control form-control-sm" value={lesson.title || ''} onChange={(e) => setLesson(mi, li, { title: e.target.value })} />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small">Kind</label>
                    <select className="form-select form-select-sm" value={lesson.kind || 'reading'} onChange={(e) => setLesson(mi, li, { kind: e.target.value })}>
                      <option value="reading">Reading</option>
                      <option value="video">Video</option>
                      <option value="assignment">Assignment</option>
                    </select>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small">Minutes</label>
                    <input type="number" min="1" className="form-control form-control-sm" value={lesson.estimatedMinutes || ''} onChange={(e) => setLesson(mi, li, { estimatedMinutes: Number(e.target.value) || null })} />
                  </div>
                  <div className="col-12">
                    <label className="form-label small">Summary</label>
                    <textarea className="form-control form-control-sm" rows="2" value={lesson.summary || ''} onChange={(e) => setLesson(mi, li, { summary: e.target.value })} />
                  </div>
                  <div className="col-12">
                    <label className="form-label small">Key points <span className="text-muted">(one per line)</span></label>
                    <textarea className="form-control form-control-sm" rows="2" value={listToLines(lesson.keyPoints)} onChange={(e) => setLesson(mi, li, { keyPoints: linesToList(e.target.value) })} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
