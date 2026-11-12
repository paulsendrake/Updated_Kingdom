import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

function average(nums) {
  if (!nums || !nums.length) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

export default function LmsGradebookPage() {
  const [cohorts, setCohorts] = useState([]);
  const [courses, setCourses] = useState([]);
  const [cohortId, setCohortId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/lms/cohorts').then(({ data }) => setCohorts(data)).catch((e) => toast(parseApiError(e), 'error'));
  }, []);

  useEffect(() => {
    setCourseId('');
    setCourses([]);
    setData(null);
    if (!cohortId) return;
    api.get(`/lms/cohorts/${cohortId}/courses`).then(({ data }) => setCourses(data)).catch(() => {});
  }, [cohortId]);

  async function show() {
    if (!cohortId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/lms/cohorts/${cohortId}/progress`);
      setData(data);
    } catch (e) {
      toast(parseApiError(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  const rows = (data?.members || []).map((m) => {
    const percent = courseId ? (data.progress?.[m.id]?.[courseId]?.percent ?? 0) : null;
    const marks = courseId ? data.marks?.[m.id]?.[courseId] : null;
    return { ...m, percent, averageMark: average(marks) };
  });

  return (
    <div>
      <PageHeader
        title="Gradebook"
        subtitle="Assessment scores and assignment marks for a cohort, on one course at a time"
        actions={<Link to="/admin/lms/marking" className="btn btn-outline-dark">Marking</Link>}
      />

      <div className="card mb-3">
        <div className="card-body">
          <div className="row g-2 align-items-end">
            <div className="col-md-5">
              <label className="form-label">Cohort</label>
              <select className="form-select" value={cohortId} onChange={(e) => setCohortId(e.target.value)}>
                <option value="">{cohorts.length ? 'Choose a cohort…' : 'No cohorts yet'}</option>
                {cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="col-md-5">
              <label className="form-label">Course</label>
              <select className="form-select" value={courseId} onChange={(e) => setCourseId(e.target.value)} disabled={!cohortId}>
                <option value="">{courses.length ? 'Choose a course…' : 'No courses released'}</option>
                {courses.map((c) => <option key={c.courseId} value={c.courseId}>{c.title}</option>)}
              </select>
            </div>
            <div className="col-md-2">
              <button className="btn btn-primary w-100" onClick={show} disabled={!cohortId || loading}>
                {loading ? 'Loading…' : 'Show'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {!data || !courseId ? (
        <div className="card">
          <div className="card-body">
            <div className="empty-state">
              <div className="fw-semibold">Nothing to mark up yet</div>
              <div className="text-muted small">Create a cohort and release a course to it, and its marks appear here.</div>
              <Link to="/admin/lms/cohorts" className="btn btn-primary mt-2">Cohorts</Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-body">
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Completion</th>
                    <th>Average Mark</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <div className="fw-semibold">{r.first_name} {r.last_name}</div>
                        <div className="text-muted small">{r.email}</div>
                      </td>
                      <td>
                        <div className="progress" style={{ height: 8, width: 140 }}>
                          <div className="progress-bar" style={{ width: `${r.percent}%` }}></div>
                        </div>
                        <div className="text-muted small">{r.percent}%</div>
                      </td>
                      <td>{r.averageMark == null ? <span className="text-muted">—</span> : r.averageMark}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan="3"><div className="empty-state">No members in this cohort yet.</div></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
