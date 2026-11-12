// Shared card-grid rendering for the course catalog — used by both the
// Craft.js builder block (CourseCatalogBlock.jsx, which needs a div/Link
// toggle for editing-mode) and the standalone public /courses page
// (CoursesPage.jsx, which never renders inside the builder iframe and so
// always wants real links).
import { Link } from 'react-router-dom';

function priceLabel(pricing) {
  if (!pricing || pricing.access_type === 'free' || !pricing.price) return 'Free';
  const amount = `$${Number(pricing.price).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  return pricing.access_type === 'recurring' ? `${amount} / ${pricing.interval_unit}` : amount;
}

export default function CourseCatalogGrid({ courses, asLink = true }) {
  return (
    <div className="events-grid">
      {courses.map((course) => {
        const Wrap = asLink ? Link : 'div';
        const wrapProps = asLink ? { to: `/learn/${course.slug}` } : {};
        return (
          <Wrap {...wrapProps} key={course.id} className="card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
            <span className="card__tag">{priceLabel(course.pricing)}</span>
            <h3>{course.title}</h3>
            {course.subtitle && <p>{course.subtitle}</p>}
            <span className="btn btn--outline-dark btn--sm" style={{ marginTop: 'var(--space-3)' }}>
              Learn More
            </span>
          </Wrap>
        );
      })}
    </div>
  );
}
