// Public course marketing + self-serve checkout page, routed at /learn/:slug
// (see App.jsx). Pulls from the new public catalog API
// (routes/lmsCheckout.js) — not the portal's /portal/lms/* routes, which
// require a login and cohort entitlement. A free course has no self-serve
// cohort to join yet (access_type 'free' means staff-managed only), so this
// page shows marketing content and a "contact us" note rather than a CTA
// that would 400 against the checkout API.
//
// Checkout form shape (step 1: choice + name/email, step 2: the iframe)
// mirrors builder/nodes/GiveWidgetBlock.jsx's own step-1/step-2 flow, just
// simplified for one course instead of a tab/tier picker.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../api/client.js';
import CourseCheckout from '../components/CourseCheckout.jsx';

function money(n) {
  return `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

export default function CoursePage() {
  const { slug } = useParams();
  const [course, setCourse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [frequency, setFrequency] = useState('once');
  const [donor, setDonor] = useState({ first_name: '', last_name: '', email: '' });
  const [checkoutError, setCheckoutError] = useState('');
  const [signup, setSignup] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    api.get(`/lms-checkout/courses/${slug}`)
      .then(({ data }) => { if (!cancelled) setCourse(data); })
      .catch(() => { if (!cancelled) setLoadError('This course could not be found.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  if (loading) {
    return <div className="container py-5 text-center text-muted">Loading…</div>;
  }
  if (loadError || !course) {
    return <div className="container py-5"><div className="alert alert-danger">{loadError || 'Course not found.'}</div></div>;
  }

  const pricing = course.pricing || { access_type: 'free' };
  const isPaid = pricing.access_type === 'one_time' || pricing.access_type === 'recurring';

  function toStepTwo(e) {
    e.preventDefault();
    setCheckoutError('');
    if (!donor.email) return setCheckoutError('Email is required.');
    setSignup({ courseSlug: slug, donor, frequency: pricing.allow_buyer_choice ? frequency : (pricing.access_type === 'recurring' ? 'monthly' : 'once') });
  }

  return (
    <div className="container py-5" style={{ maxWidth: 760 }}>
      <h1>{course.title}</h1>
      {course.subtitle && <p className="lead">{course.subtitle}</p>}
      {course.description && <p>{course.description}</p>}

      {course.outcomes?.length > 0 && (
        <>
          <h3>What you'll learn</h3>
          <ul className="list-diamond">
            {course.outcomes.map((o, i) => <li key={i}>{o}</li>)}
          </ul>
        </>
      )}

      {course.outline?.length > 0 && (
        <>
          <h3>Course outline</h3>
          {course.outline.map((m, i) => (
            <div key={i} className="mb-3">
              <h5>{m.title}</h5>
              {m.summary && <p className="text-muted">{m.summary}</p>}
              <ul>
                {m.lessons.map((l, j) => (
                  <li key={j}>
                    {l.title}
                    {l.estimatedMinutes ? ` — ${l.estimatedMinutes} min` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}

      <hr />

      {done ? (
        <div className="form-note">
          You're enrolled! Sign in to the portal to start the course under My Learning.
        </div>
      ) : !isPaid ? (
        <div className="form-note">
          This course is available by invitation — contact us to enroll.
        </div>
      ) : signup ? (
        <CourseCheckout
          signup={signup}
          onSuccess={() => setDone(true)}
          onError={(msg) => setCheckoutError(msg || 'That enrollment could not be completed.')}
          onCancel={() => setSignup(null)}
        />
      ) : (
        <form className="donate-step-panel" onSubmit={toStepTwo}>
          <h2>Enroll in this course</h2>
          <p className="donate-lead">{money(pricing.price)}{pricing.access_type === 'recurring' ? ` / ${pricing.interval_unit}` : ' one-time'}</p>

          {pricing.allow_buyer_choice && (
            <div className="freq-toggle">
              <label>
                <input type="radio" name="course-freq" checked={frequency === 'once'} onChange={() => setFrequency('once')} />
                One-time
              </label>
              <label>
                <input type="radio" name="course-freq" checked={frequency === 'monthly'} onChange={() => setFrequency('monthly')} />
                Monthly
              </label>
            </div>
          )}

          <div className="form-grid two-col">
            <div className="form-field">
              <label htmlFor="course-first">First name</label>
              <input id="course-first" value={donor.first_name} onChange={(e) => setDonor({ ...donor, first_name: e.target.value })} />
            </div>
            <div className="form-field">
              <label htmlFor="course-last">Last name</label>
              <input id="course-last" value={donor.last_name} onChange={(e) => setDonor({ ...donor, last_name: e.target.value })} />
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="course-email">Email <span className="required">*</span></label>
            <input id="course-email" type="email" required value={donor.email} onChange={(e) => setDonor({ ...donor, email: e.target.value })} />
          </div>

          {checkoutError && <div className="form-error">{checkoutError}</div>}

          <div className="donate-nav-btns">
            <span />
            <button type="submit" className="btn btn--gold">Continue</button>
          </div>
          <p className="donate-secure">Payments processed securely. A receipt is sent to your email automatically.</p>
        </form>
      )}
    </div>
  );
}
