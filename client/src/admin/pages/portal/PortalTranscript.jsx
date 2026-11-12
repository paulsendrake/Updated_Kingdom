import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../api/client.js';
import { parseApiError } from '../../../utils/apiError.js';

export default function PortalTranscript() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/portal/lms/transcript')
      .then((r) => setData(r.data))
      .catch((e) => setError(parseApiError(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-muted">Loading…</div>;
  if (error) return <div className="alert alert-danger">{error}</div>;

  const { courses = [], stats = {} } = data || {};

  return (
    <div>
      <div className="d-flex justify-content-between align-items-start mb-1">
        <h3 className="fw-bolder mb-1">My Transcript</h3>
        <Link to="/portal/learning" className="small">My Learning</Link>
      </div>
      <p className="text-muted">Every course you've been given, how far through it you are, and what's been marked.</p>

      <div className="row g-3 mb-4">
        <div className="col-6 col-md-3">
          <div className="card h-100"><div className="card-body">
            <div className="small text-muted mb-1">Courses</div>
            <div className="fs-4 fw-bold">{stats.courseCount ?? 0}</div>
          </div></div>
        </div>
        <div className="col-6 col-md-3">
          <div className="card h-100"><div className="card-body">
            <div className="small text-muted mb-1">Lessons completed</div>
            <div className="fs-4 fw-bold">{stats.lessonsCompleted ?? 0}</div>
          </div></div>
        </div>
        <div className="col-6 col-md-3">
          <div className="card h-100"><div className="card-body">
            <div className="small text-muted mb-1">Certificates</div>
            <div className="fs-4 fw-bold">{stats.certificateCount ?? 0}</div>
          </div></div>
        </div>
        <div className="col-6 col-md-3">
          <div className="card h-100"><div className="card-body">
            <div className="small text-muted mb-1">Average mark</div>
            {stats.averageMark == null ? (
              <span className="badge bg-secondary-subtle text-secondary">Nothing marked yet</span>
            ) : (
              <div className="fs-4 fw-bold">{stats.averageMark}%</div>
            )}
          </div></div>
        </div>
      </div>

      {courses.length === 0 ? (
        <div className="card"><div className="card-body"><div className="empty-state">
          Nothing on your record yet — once a cohort releases a course to you, it'll appear here with your progress and marks.
        </div></div></div>
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Cohort</th>
                  <th>Progress</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {courses.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div className="fw-semibold">{c.title}</div>
                      {c.subtitle && <div className="small text-muted">{c.subtitle}</div>}
                    </td>
                    <td className="small text-muted">{c.cohortName || '—'}</td>
                    <td style={{ minWidth: 160 }}>
                      <div className="d-flex align-items-center gap-2">
                        <div className="progress flex-grow-1" style={{ height: 8 }}>
                          <div className="progress-bar" role="progressbar" style={{ width: `${c.percent}%` }} aria-valuenow={c.percent} aria-valuemin="0" aria-valuemax="100"></div>
                        </div>
                        <span className="small text-muted flex-shrink-0">{c.percent}%</span>
                      </div>
                    </td>
                    <td className="text-end">
                      <Link to={`/portal/learning/${c.slug}`} className="btn btn-sm btn-outline-dark">View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
