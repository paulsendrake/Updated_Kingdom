// Course catalog — pulls published courses from the Learning module and
// renders them with the site's own .card styling, same split as
// EventListBlock.jsx (this block only links out to /learn/:slug for the
// actual pricing/enrollment — a course can be free, one-time, or recurring,
// so there's no sensible inline "enroll" affordance on a grid card).

import { useEffect, useState } from 'react';
import { useNode } from '@craftjs/core';
import api from '../../api/client.js';
import CourseCatalogGrid from '../../frontend/components/CourseCatalogGrid.jsx';
import { FieldGroup, NumberField, TextField, TextareaField } from '../fields/index.jsx';
import { IDENTITY_DEFAULTS, cx, useDomIdentity, useIsEditing, useNodeRef } from './nodeUtils.js';

export default function CourseCatalogBlock({ heading, blurb, limit, emptyText }) {
  const ref = useNodeRef();
  const editing = useIsEditing();
  const { domId, customClass } = useDomIdentity('courses');
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get('/lms-checkout/courses')
      .then(({ data }) => setCourses(Array.isArray(data) ? data : []))
      .catch(() => setCourses([]))
      .finally(() => setLoading(false));
  }, []);

  const visible = limit ? courses.slice(0, limit) : courses;

  return (
    <div ref={ref} id={domId} className={cx(customClass)}>
      {heading && <h2>{heading}</h2>}
      {blurb && <p>{blurb}</p>}

      {loading && <div className="bx-editor-note">Loading courses…</div>}
      {!loading && !visible.length && <div className="bx-editor-note">{emptyText}</div>}

      {/* Inside the canvas a react-router <Link> would try to navigate the
          iframe, so the shared grid renders plain divs while editing. */}
      <CourseCatalogGrid courses={visible} asLink={!editing} />

      {editing && visible.length > 0 && (
        <div className="bx-editor-note" style={{ marginTop: 16 }}>
          <i className="fa-solid fa-shield-halved" /> Course cards link to /learn/:slug on the live site. Courses shown are live from Admin → Learning.
        </div>
      )}
    </div>
  );
}

function CourseCatalogSettings() {
  const { props, actions: { setProp } } = useNode((node) => ({ props: node.data.props }));
  const p = (key) => (value) => setProp((s) => { s[key] = value; });
  return (
    <>
      <FieldGroup title="Content">
        <TextField label="Heading" value={props.heading} onChange={p('heading')} hint="Leave blank if a Heading block already sits above this one." />
        <TextareaField label="Intro text" value={props.blurb} onChange={p('blurb')} rows={2} />
        <TextField label="Empty message" value={props.emptyText} onChange={p('emptyText')} />
      </FieldGroup>

      <FieldGroup title="Courses shown">
        <NumberField label="Maximum to show" value={props.limit} onChange={p('limit')} min={0} hint="0 shows every published course." />
      </FieldGroup>

      <FieldGroup title="Identity" defaultOpen={false}>
        <TextField label="Custom ID" value={props.customId} onChange={p('customId')} />
        <TextField label="Custom CSS class" value={props.customClass} onChange={p('customClass')} />
      </FieldGroup>
    </>
  );
}

CourseCatalogBlock.craft = {
  displayName: 'Course Catalog',
  props: {
    ...IDENTITY_DEFAULTS,
    heading: '',
    blurb: '',
    limit: 0,
    emptyText: 'No courses are published yet — check back soon.',
  },
  related: { settings: CourseCatalogSettings },
};
