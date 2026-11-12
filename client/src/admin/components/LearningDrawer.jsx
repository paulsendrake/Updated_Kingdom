// Content for the portal's "Learning" nav button (see PortalLayout.jsx) — a
// left-side drawer rather than a page nav, so a learner's whole LMS picture
// (what they're enrolled in + what else is on offer) is reachable from one
// entry point. Clicking into an actual course closes the drawer and hands off
// to the existing full-page views, which need the room a drawer doesn't have.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Modal from '../../components/Modal.jsx';
import api from '../../api/client.js';
import { parseApiError } from '../../utils/apiError.js';

function money(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export default function LearningDrawer({ show, onClose }) {
  const navigate = useNavigate();
  const [myCourses, setMyCourses] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([
      api.get('/portal/lms/courses').catch(() => ({ data: [] })),
      api.get('/lms-checkout/courses').catch(() => ({ data: [] })),
    ])
      .then(([mine, all]) => {
        if (cancelled) return;
        const enrolledIds = new Set((mine.data || []).map((c) => c.id));
        setMyCourses(mine.data || []);
        setCatalog((all.data || []).filter((c) => !enrolledIds.has(c.id)));
      })
      .catch((e) => { if (!cancelled) setError(parseApiError(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [show]);

  function goToCourse(slug) {
    onClose();
    navigate(`/portal/learning/${slug}`);
  }

  return (
    <Modal show={show} onClose={onClose} title="Learning" side="start" size="md">
      {loading && (
        <div className="text-center py-3 text-muted">
          <div className="spinner-border spinner-border-sm me-2"></div>Loading…
        </div>
      )}
      {error && <div className="alert alert-danger py-2 small">{error}</div>}

      {!loading && (
        <>
          <h6 className="fw-bold mb-2">My Courses</h6>
          {myCourses.length === 0 ? (
            <div className="card mb-4"><div className="card-body"><div className="empty-state">
              Nothing here yet — once you're enrolled in a course, it'll show up here.
            </div></div></div>
          ) : (
            <div className="d-flex flex-column gap-2 mb-4">
              {myCourses.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="card text-start border-0 shadow-sm"
                  style={{ cursor: 'pointer' }}
                  onClick={() => goToCourse(c.slug)}
                >
                  <div className="card-body py-2 px-3">
                    <div className="d-flex justify-content-between align-items-start">
                      <div className="fw-semibold">{c.title}</div>
                      {c.percent === 100 && (
                        <span className="badge bg-success-subtle text-success flex-shrink-0 ms-2">Complete</span>
                      )}
                    </div>
                    <div className="progress mt-1" style={{ height: 6 }}>
                      <div className="progress-bar" role="progressbar" style={{ width: `${c.percent}%` }}></div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          <h6 className="fw-bold mb-2">Browse Courses</h6>
          {catalog.length === 0 ? (
            <div className="text-muted small">No other courses are available right now.</div>
          ) : (
            <div className="d-flex flex-column gap-2">
              {catalog.map((c) => (
                <Link
                  key={c.id}
                  to={`/learn/${c.slug}`}
                  className="card text-start text-decoration-none text-reset border-0 shadow-sm"
                  onClick={onClose}
                >
                  <div className="card-body py-2 px-3 d-flex justify-content-between align-items-center">
                    <div className="fw-semibold">{c.title}</div>
                    <span className="badge bg-light text-dark border flex-shrink-0 ms-2">
                      {c.pricing?.access_type === 'free' || !c.pricing?.price ? 'Free' : money(c.pricing.price)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
