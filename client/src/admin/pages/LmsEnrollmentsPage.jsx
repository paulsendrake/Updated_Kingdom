import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import FormErrorBanner from '../../components/FormErrorBanner.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';

const STATUS_TONE = {
  sent: 'secondary', paid: 'success', partial: 'warning', overdue: 'danger', void: 'secondary',
};

function fmtMoney(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Staff "comp enroll" — adds a contact to a paid course's self-serve cohort
// with no charge, by calling the exact same cohort-member endpoint
// LmsCohortsPage's own enrollment UI uses. No separate "free enrollment"
// concept exists server-side; this is just that same action from a
// course-first rather than cohort-first starting point.
function CompEnrollModal({ onClose, onDone }) {
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState('');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/lms-checkout/courses').then(({ data }) => {
      setCourses(data.filter((c) => c.pricing?.cohort_id));
    }).catch(() => {});
  }, []);

  async function searchContacts(q) {
    setSearch(q);
    if (!q.trim()) { setResults([]); return; }
    const { data } = await api.get('/contacts', { params: { q, pageSize: 10 } });
    setResults(data?.rows || []);
  }

  async function enroll(contact) {
    const course = courses.find((c) => c.id === courseId);
    if (!course) { setError('Choose a course first.'); return; }
    try {
      await api.post(`/lms/cohorts/${course.pricing.cohort_id}/members`, { contactId: contact.id });
      toast(`Enrolled ${contact.first_name} ${contact.last_name} in "${course.title}" at no charge.`, 'success');
      onDone();
      onClose();
    } catch (e) {
      setError(parseApiError(e));
    }
  }

  return (
    <Modal show onClose={onClose} title="Comp-Enroll a Contact" size="md"
      footer={<button className="btn btn-outline-dark" onClick={onClose}>Close</button>}>
      <FormErrorBanner error={error} />
      <div className="mb-3">
        <label className="form-label">Course</label>
        <select className="form-select" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          <option value="">Choose a paid course…</option>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </div>
      <div className="mb-2">
        <label className="form-label">Contact</label>
        <input
          type="text" className="form-control" placeholder="Search by name, email, or phone…"
          value={search} onChange={(e) => searchContacts(e.target.value)} disabled={!courseId}
        />
      </div>
      {results.length > 0 && (
        <ul className="list-group" style={{ maxHeight: 220, overflowY: 'auto' }}>
          {results.map((c) => (
            <li key={c.id} className="list-group-item d-flex align-items-center justify-content-between py-1 px-2">
              <span className="small">{c.first_name} {c.last_name} <span className="text-muted">{c.email || ''}</span></span>
              <button className="btn btn-sm btn-primary" onClick={() => enroll(c)}>Enroll free</button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export default function LmsEnrollmentsPage() {
  const { can } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showEnroll, setShowEnroll] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/lms/enrollments');
      setRows(data);
    } catch (e) {
      toast(parseApiError(e), 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function removeAccess(row) {
    if (!row.cohort_id) return;
    if (!(await confirm(`Remove ${row.contact_name}'s access to "${row.course_title}"? Their invoice and payment history is unaffected.`, { danger: true }))) return;
    try {
      await api.delete(`/lms/cohorts/${row.cohort_id}/members/${row.contact_id}`);
      toast('Access removed.', 'success');
      load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  return (
    <div>
      {confirmDialog}
      <PageHeader
        title="Enrollments"
        subtitle="Everyone who has purchased access to a paid course"
        actions={<>
          <Link to="/admin/lms/courses" className="btn btn-outline-dark">← Courses</Link>
          {can('lms.write') && (
            <button className="btn btn-primary ms-2" onClick={() => setShowEnroll(true)}>
              <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> Comp-Enroll
            </button>
          )}
        </>}
      />

      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Course</th>
                  <th>Type</th>
                  <th className="text-end">Amount</th>
                  <th>Invoice</th>
                  <th>Payment</th>
                  {can('lms.write') && <th style={{ width: 100 }} className="text-end">Access</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.invoice_id}>
                    <td>
                      <div className="fw-semibold">{r.contact_name || '—'}</div>
                      <div className="text-muted small">{r.contact_email}</div>
                    </td>
                    <td>{r.course_title || '—'}</td>
                    <td>
                      <span className="badge bg-light text-dark">
                        {r.access_type === 'recurring' ? 'Recurring' : 'One-time'}
                      </span>
                    </td>
                    <td className="text-end fw-semibold">{fmtMoney(r.total)}</td>
                    <td>
                      <Link to={`/admin/invoices/${r.invoice_id}`} className="text-decoration-none">
                        {r.invoice_number}
                      </Link>
                      <div><span className={`badge bg-${STATUS_TONE[r.invoice_status] || 'secondary'}-subtle text-${STATUS_TONE[r.invoice_status] || 'secondary'}`}>{r.invoice_status}</span></div>
                    </td>
                    <td>
                      {r.payment_status
                        ? <span className={`badge ${r.payment_status === 'captured' ? 'bg-success-subtle text-success' : r.payment_status === 'refunded' || r.payment_status === 'voided' ? 'bg-secondary-subtle text-secondary' : 'bg-warning-subtle text-warning'}`}>{r.payment_status}</span>
                        : '—'}
                    </td>
                    {can('lms.write') && (
                      <td className="text-end">
                        <button className="btn btn-sm btn-outline-danger" onClick={() => removeAccess(r)} title="Remove access">
                          <iconify-icon icon="solar:user-cross-line-duotone"></iconify-icon>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan="7"><div className="empty-state">No course purchases yet.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showEnroll && <CompEnrollModal onClose={() => setShowEnroll(false)} onDone={load} />}
    </div>
  );
}
