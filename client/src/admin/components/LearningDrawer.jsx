// Content for the portal's "Learning" nav button (see PortalLayout.jsx) — a
// left-side drawer rather than a page nav, so a learner's whole LMS picture
// (what they're enrolled in + what else is on offer) is reachable from one
// entry point. Clicking into an actual course closes the drawer and hands off
// to the existing full-page views, which need the room a drawer doesn't have.
import { useEffect, useRef, useState } from 'react';
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
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [browseFailed, setBrowseFailed] = useState(false);
  const firstLoad = useRef(true);

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    api.get('/portal/lms/courses')
      .then((mine) => { if (!cancelled) setMyCourses(mine.data || []); })
      .catch((e) => { if (!cancelled) setError(parseApiError(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [show]);

  /*
   * Browsing asks the server rather than the browser.
   *
   * This used to fetch /lms-checkout/courses — every published course, with
   * the whole pricing table — and filter out the enrolled ones here. That is
   * fine for a dozen courses and gets worse with every one added. The
   * catalogue endpoint searches, pages, and marks what the learner is already
   * on, so none of that has to cross the wire to be thrown away.
   *
   * Debounced, because it now runs on every keystroke.
   */
  useEffect(() => {
    if (!show) return undefined;
    let cancelled = false;
    const wait = firstLoad.current ? 0 : 250;
    firstLoad.current = false;
    setSearching(true);
    const timer = setTimeout(() => {
      api.get('/portal/lms/catalogue', { params: query.trim() ? { query: query.trim() } : {} })
        .then((r) => {
          if (cancelled) return;
          const body = r.data || {};
          setCatalog((body.items || []).filter((c) => !c.enrolled));
          setTotal(body.total || 0);
          setBrowseFailed(false);
        })
        /*
         * A failed request is not an empty catalogue, and must not be shown
         * as one. Swallowing it would tell somebody there are no courses on
         * offer when the truth is that we could not find out — and they would
         * believe it, because the sentence reads like an answer.
         */
        .catch(() => { if (!cancelled) { setCatalog([]); setBrowseFailed(true); } })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, wait);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [show, query]);

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

          <div className="d-flex justify-content-between align-items-center mb-2">
            <h6 className="fw-bold mb-0">Browse Courses</h6>
            {/*
              `total` is what matches the current filters, not how many
              courses exist — so it cannot be labelled "published" once
              somebody has typed in the box. It also counts courses the
              learner is already enrolled on, which are filtered out of the
              list below, so it is deliberately described as the catalogue
              rather than as the number of cards on screen.
            */}
            {total > 0 && (
              <span className="text-muted small">
                {query.trim() ? `${total} match` : `${total} in the catalogue`}
              </span>
            )}
          </div>
          <div className="mb-2">
            <input
              type="search"
              className="form-control form-control-sm"
              placeholder="Search courses"
              aria-label="Search courses"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {searching && catalog.length === 0 ? (
            <div className="text-muted small">Searching&hellip;</div>
          ) : browseFailed ? (
            <div className="alert alert-warning py-2 small mb-0">
              Could not load the course list just now. Your own courses above are unaffected.
            </div>
          ) : catalog.length === 0 ? (
            <div className="text-muted small">
              {query.trim() ? 'Nothing matches that.' : 'No other courses are available right now.'}
            </div>
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
