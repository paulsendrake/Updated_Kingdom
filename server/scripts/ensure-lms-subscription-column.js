#!/usr/bin/env node
// Adds subscriptions.lms_course_pricing_id — parallel to the existing
// membership_tier_id/fund_id columns, so a recurring paid-course purchase
// (routes/lmsCheckout.js) rides the exact same subscriptions/billing-cron
// pipeline as memberships, tagged with this FK instead. No DB foreign key
// (lms_course_pricing.id is app-owned, created by
// ensure-lms-pricing-table.js — run that first).
//
// Safe to re-run.
//
//   node scripts/ensure-lms-subscription-column.js --database my_local_db

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
    if (await columnExists(db, 'subscriptions', 'lms_course_pricing_id')) {
      console.log('subscriptions.lms_course_pricing_id already exists.');
    } else {
      await db.query(
        `ALTER TABLE subscriptions ADD COLUMN lms_course_pricing_id CHAR(36) NULL AFTER membership_tier_id`
      );
      console.log('Added subscriptions.lms_course_pricing_id.');
    }
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
