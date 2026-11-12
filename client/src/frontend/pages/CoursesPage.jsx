import { useEffect, useState } from 'react';
import api from '../../api/client.js';
import CourseCatalogGrid from '../components/CourseCatalogGrid.jsx';

export default function CoursesPage() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/lms-checkout/courses')
      .then((r) => setCourses(Array.isArray(r.data) ? r.data : []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="ns-section">
      <div className="ns-grid">
        <div className="ns-block" style={{ '--col-start': 1, '--col-span': 12 }}>
          <div className="section-heading">
            <p className="eyebrow">Grow With Us</p>
            <h2>Courses</h2>
            <p>Learn at your own pace — browse what&rsquo;s available and pick up where you left off.</p>
          </div>

          {loading ? (
            <p style={{ textAlign: 'center' }}>Loading courses…</p>
          ) : courses.length === 0 ? (
            <p style={{ textAlign: 'center' }}>No courses are published yet — check back soon.</p>
          ) : (
            <CourseCatalogGrid courses={courses} />
          )}
        </div>
      </div>
    </div>
  );
}
