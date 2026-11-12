#!/usr/bin/env node
// Seeds the PAID side of the LMS demo — /admin/lms/enrollments has been
// empty until now (no real checkout has ever completed locally; the one
// live attempt earlier this session used a deliberately fake card token and
// failed before an invoice was even created). This inserts realistic
// invoice/payment/subscription rows directly (same approach any seed script
// in this app takes — not a live gateway charge) so Enrollments, the
// self-serve cohorts, and the portal's "Browse Courses" all have something
// real to show for both access types:
//   - a captured ONE-TIME purchase (Growing in Prayer, $25)
//   - an ACTIVE recurring subscription (Serving on a Team, $10/month) — this
//     course is given pricing for the first time here
//   - a REFUNDED one-time purchase, to show that state too (and confirms
//     the refund-revokes-access path by actually removing cohort membership,
//     same as routes/payments.js's /:id/refund route would)
//
// Idempotent-ish: checks for an existing invoice with the same memo before
// inserting, so re-running won't pile up duplicates for the same contact.
//
//   node scripts/seed-lms-paid-enrollment-demo.js

const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { loadRuntime, contextFor } = require('../src/lms/runtime');
const { db } = require('../src/db');

function today() { return new Date().toISOString().slice(0, 10); }

async function nextInvoiceNumber() {
  const year = new Date().getUTCFullYear();
  const [rows] = await db.query(`SELECT invoice_number FROM invoices WHERE invoice_number LIKE :p ORDER BY id DESC LIMIT 1`, { p: `INV-${year}-%` });
  const last = rows[0]?.invoice_number;
  const seq = last ? Number(last.split('-').pop()) + 1 : 1;
  return `INV-${year}-${String(seq).padStart(6, '0')}`;
}

async function seedPurchase({ lms, pricing, contactId, memo, amount, status, refunded, intervalUnit, intervalCount }) {
  const [[already]] = await db.query('SELECT id FROM invoices WHERE memo = :m AND contact_id = :c', { m: memo, c: contactId });
  if (already) { console.log(`  Already seeded: "${memo}" for contact ${contactId}`); return; }

  const number = await nextInvoiceNumber();
  const [inv] = await db.query(
    `INSERT INTO invoices (payment_token, invoice_number, contact_id, issue_date, due_date, currency,
       subtotal, tax_rate, tax_amount, discount_rate, discount_amount, total, amount_paid, balance_due,
       status, memo, lms_course_pricing_id)
     VALUES (:tok, :num, :cid, :today, :today, 'USD', :amt, 0, 0, 0, 0, :amt, :paid, :due, :status, :memo, :pid)`,
    {
      tok: crypto.randomBytes(32).toString('hex'), num: number, cid: contactId, today: today(), amt: amount,
      paid: refunded ? 0 : amount, due: refunded ? amount : 0, status: refunded ? 'sent' : 'paid', memo, pid: pricing.id,
    }
  );
  await db.query(
    `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort_order) VALUES (:iid, :d, 1, :a, :a, 0)`,
    { iid: inv.insertId, d: memo, a: amount }
  );
  const [pay] = await db.query(
    `INSERT INTO payments (invoice_id, gateway, method, amount, currency, status, external_txn_id, card_last4, card_brand, received_at, receipt_token
       ${refunded ? ', refunded_at, refund_amount' : ''})
     VALUES (:iid, 'valor', 'card', :amt, 'USD', :status, :txn, '4242', 'Visa', NOW(), :rtok
       ${refunded ? ', NOW(), :amt' : ''})`,
    { iid: inv.insertId, amt: amount, status: refunded ? 'refunded' : 'captured', txn: `seed-${crypto.randomBytes(4).toString('hex')}`, rtok: crypto.randomBytes(32).toString('hex') }
  );

  let subscriptionId = null;
  if (intervalUnit) {
    const [sub] = await db.query(
      `INSERT INTO subscriptions (name, contact_id, currency, interval_unit, interval_count, start_date, next_run_date,
         status, auto_charge, gateway, gateway_profile_id, lms_course_pricing_id)
       VALUES (:name, :cid, 'USD', :unit, :count, :today, :next, 'active', 1, 'valor', 'seed-no-vault', :pid)`,
      { name: memo, cid: contactId, unit: intervalUnit, count: intervalCount, today: today(), next: today(), pid: pricing.id }
    );
    subscriptionId = sub.insertId;
  }

  console.log(`  Seeded ${refunded ? 'REFUNDED' : status} $${amount} purchase for contact ${contactId} (invoice ${number}${subscriptionId ? `, subscription #${subscriptionId}` : ''})`);
  return { paymentId: pay.insertId, subscriptionId };
}

(async () => {
  const { lms, store } = await loadRuntime();
  const admin = await contextFor('staff:seed-script', 'admin');

  console.log('=== Giving "Serving on a Team" recurring pricing (first time) ===');
  const { schema, db: lmsDb } = await loadRuntime();
  const { eq } = require('drizzle-orm');
  const [servingRow] = await lmsDb.select().from(schema.courses).where(eq(schema.courses.slug, 'serving-on-a-team'));
  let [[servingPricing]] = await db.query('SELECT * FROM lms_course_pricing WHERE course_id = :id', { id: servingRow.id });
  if (!servingPricing) {
    const cohort = await lms.createCohort(admin, { name: 'Serving on a Team — Self-Enrolled' });
    await lms.releaseCourse(admin, { cohortId: cohort.id, courseId: servingRow.id, availableFrom: new Date() });
    const pricingId = crypto.randomUUID();
    await db.query(
      `INSERT INTO lms_course_pricing (id, course_id, access_type, price, interval_unit, interval_count, allow_buyer_choice, cohort_id)
       VALUES (:id, :cid, 'recurring', 10.00, 'month', 1, 1, :cohort_id)`,
      { id: pricingId, cid: servingRow.id, cohort_id: cohort.id }
    );
    servingPricing = { id: pricingId, cohort_id: cohort.id };
    console.log(`  Created recurring $10/mo pricing + self-serve cohort for "Serving on a Team"`);
  } else {
    console.log('  Pricing already exists for "Serving on a Team"');
  }

  const [prayerRow] = await lmsDb.select().from(schema.courses).where(eq(schema.courses.slug, 'growing-in-prayer'));
  const [[prayerPricing]] = await db.query('SELECT * FROM lms_course_pricing WHERE course_id = :id', { id: prayerRow.id });

  console.log('\n=== Seeding purchase history ===');
  // Derek (contact 4) — captured one-time purchase of Growing in Prayer.
  const r1 = await seedPurchase({ lms, pricing: prayerPricing, contactId: 4, memo: 'Course — Growing in Prayer (one-time, 1 year)', amount: 25, status: 'paid' });
  if (r1) { const ids = await store.cohortMemberIds(prayerPricing.cohort_id); if (!ids.includes('4')) await lms.addMember(admin, prayerPricing.cohort_id, '4'); }

  // Maan (contact 6) — active recurring subscription to Serving on a Team.
  const r2 = await seedPurchase({ lms, pricing: servingPricing, contactId: 6, memo: 'Course — Serving on a Team (every month)', amount: 10, status: 'paid', intervalUnit: 'month', intervalCount: 1 });
  if (r2) { const ids = await store.cohortMemberIds(servingPricing.cohort_id); if (!ids.includes('6')) await lms.addMember(admin, servingPricing.cohort_id, '6'); }

  // Test Donor (contact 7) — REFUNDED one-time purchase, access correctly
  // revoked (never added to the cohort — mirrors what routes/payments.js's
  // refund route does for a real refund).
  await seedPurchase({ lms, pricing: prayerPricing, contactId: 7, memo: 'Course — Growing in Prayer (one-time, 1 year) [refunded demo]', amount: 25, status: 'paid', refunded: true });

  console.log('\nDone. Check /admin/lms/enrollments for 3 rows (1 one-time captured, 1 active recurring, 1 refunded), and /portal (contact 4 or 6) to confirm purchased access actually shows up.');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
