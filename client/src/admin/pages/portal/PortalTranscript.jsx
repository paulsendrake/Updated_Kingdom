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

  const { courses = [], certificates = [], quizAttempts = [], assignments = [], stats = {} } = data || {};

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
                  <th>Marked</th>
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
                    <td style={{ minWidth: 110 }}>
                      {c.markedCount ? (
                        <>
                          <span className="fw-semibold">{c.averageMark}%</span>
                          <div className="small text-muted">
                            {c.markedCount} {c.markedCount === 1 ? 'piece' : 'pieces'} marked
                          </div>
                        </>
                      ) : (
                        <span className="small text-muted">&mdash;</span>
                      )}
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

      {/*
        What is still owed, split by whose move it is. An assignment never
        handed in is the learner's; one handed in and not yet marked is not,
        and showing them as one list makes somebody chase work that is sitting
        on a marker's desk.
      */}
      {assignments.length > 0 && (
        <>
          <h5 className="fw-bolder mt-4 mb-2">Assignments</h5>
          <div className="card">
            <ul className="list-group list-group-flush">
              {assignments.map((a) => (
                <li key={a.lessonId} className="list-group-item d-flex justify-content-between align-items-center gap-3">
                  <div style={{ minWidth: 0 }}>
                    <div className="fw-semibold text-truncate">{a.lessonTitle}</div>
                    <div className="small text-muted text-truncate">{a.courseTitle}</div>
                  </div>
                  <div className="d-flex align-items-center gap-2 flex-shrink-0">
                    {a.state === 'awaiting_marking' ? (
                      <span className="badge bg-info-subtle text-info">Waiting to be marked</span>
                    ) : (
                      <span className="badge bg-warning-subtle text-warning">To do</span>
                    )}
                    <Link
                      to={`/portal/learning/${a.courseSlug}/${a.lessonSlug}`}
                      className="btn btn-sm btn-outline-dark"
                    >
                      Open
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {/*
        Quiz results after the day they were sat. These were shown once, at
        the moment of submitting, and then there was nowhere to see them
        again.
      */}
      {quizAttempts.length > 0 && (
        <>
          <h5 className="fw-bolder mt-4 mb-2">Quiz results</h5>
          <div className="card">
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0">
                <thead>
                  <tr>
                    <th>Quiz</th>
                    <th>Course</th>
                    <th>Sat</th>
                    <th className="text-end">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {quizAttempts.map((a, i) => (
                    <tr key={`${a.courseSlug}-${a.lessonSlug}-${a.submittedAt}-${i}`}>
                      <td>
                        <Link
                          to={`/portal/learning/${a.courseSlug}/${a.lessonSlug}`}
                          className="text-decoration-none text-reset fw-semibold"
                        >
                          {a.quizTitle || a.lessonTitle}
                        </Link>
                      </td>
                      <td className="small text-muted">{a.courseTitle}</td>
                      <td className="small text-muted">
                        {a.submittedAt ? new Date(a.submittedAt).toLocaleDateString() : '\u2014'}
                      </td>
                      <td className="text-end">
                        <span className={`badge ${a.passed ? 'bg-success-subtle text-success' : 'bg-danger-subtle text-danger'}`}>
                          {a.score}%
                        </span>
                        {a.passingScore != null && (
                          <div className="small text-muted">pass {a.passingScore}%</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/*
        The certificates, not just how many there are. The stat above counts
        them; this is where somebody can actually see one. Each links to the
        course it came from, which is where the download already lives, rather
        than repeating the blob-download dance here.
      */}
      {certificates.length > 0 && (
        <>
          <h5 className="fw-bolder mt-4 mb-2">Certificates</h5>
          <div className="card">
            <ul className="list-group list-group-flush">
              {certificates.map((cert) => (
                <li key={cert.certificateNumber} className="list-group-item d-flex justify-content-between align-items-center gap-3">
                  <div style={{ minWidth: 0 }}>
                    <div className="fw-semibold text-truncate">{cert.courseTitle}</div>
                    <div className="small text-muted">
                      {cert.certificateNumber}
                      {cert.issuedAt ? ` \u00b7 ${new Date(cert.issuedAt).toLocaleDateString()}` : ''}
                    </div>
                  </div>
                  <Link to={`/portal/learning/${cert.courseSlug}`} className="btn btn-sm btn-outline-success flex-shrink-0">
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
