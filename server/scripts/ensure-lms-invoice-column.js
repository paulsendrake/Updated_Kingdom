#!/usr/bin/env node
// Adds invoices.lms_course_pricing_id. subscriptions already carries this FK
// (ensure-lms-subscription-column.js) for recurring course purchases, but a
// ONE-TIME course purchase (routes/lmsCheckout.js, services/membershipTerms.js's
// 'once' terms) never creates a subscriptions row at all — without this
// column there would be no way to trace a refunded invoice back to which
// course/cohort to revoke access from. Set on every LMS invoice regardless
// of frequency, so refund-time revocation (routes/payments.js's /:id/refund)
// has one place to look, not two.
//
// Safe to re-run.
//
//   node scripts/ensure-lms-invoice-column.js --database my_local_db

const path = require('path');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
}

const CONFIG = {
  host: arg('host', process.env.DB_HOST),
  port: Number(arg('port', process.env.DB_PORT || 3306)),
  user: arg('user', process.env.DB_USER),
  password: arg('password', process.env.DB_PASSWORD),
  database: arg('database', process.env.DB_NAME),
};

async function columnExists(db, table, column) {
  const [[row]] = await db.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column`,
    { table, column }
  );
  return !!row;
}

(async () => {
  console.log(`Target: ${CONFIG.user}@${CONFIG.host}:${CONFIG.port}/${CONFIG.database}`);
  const db = await mysql.createConnection({ ...CONFIG, namedPlaceholders: true });
  try {
    if (await columnExists(db, 'invoices', 'lms_course_pricing_id')) {
      console.log('invoices.lms_course_pricing_id already exists.');
    } else {
      await db.query(`ALTER TABLE invoices ADD COLUMN lms_course_pricing_id CHAR(36) NULL`);
      console.log('Added invoices.lms_course_pricing_id.');
    }
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
