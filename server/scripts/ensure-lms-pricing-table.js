#!/usr/bin/env node
// Creates lms_course_pricing — the app-owned pricing/self-enrollment table
// that sits ALONGSIDE the vendored LMS engine (server/vendor/kcc-lms)
// without touching its schema or migrations. The vendor package has no
// concept of price; "paid access" here just means the checkout flow
// (routes/lmsCheckout.js) automates what a staff member already does by
// hand in LmsCohortsPage — adding the buyer to a cohort. `cohort_id` is the
// one dedicated, auto-managed cohort each paid course gets ("<title> —
// Self-Enrolled"), created the first time a course is marked non-free;
// staff-managed cohorts (live classes, groups) are untouched by this.
//
// No DB foreign key into lms_courses/lms_cohorts (char(36) ids owned by the
// vendor's own schema) — app-enforced only, same reasoning as the vendor's
// own contact-id columns (see vendor/kcc-lms/VENDORED.md).
//
// Safe to re-run.
//
//   node scripts/ensure-lms-pricing-table.js --database my_local_db

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

async function tableExists(db, table) {
  const [[row]] = await db.query(
    `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table`,
    { table }
  );
  return !!row;
}

(async () => {
  console.log(`Target: ${CONFIG.user}@${CONFIG.host}:${CONFIG.port}/${CONFIG.database}`);
  const db = await mysql.createConnection({ ...CONFIG, namedPlaceholders: true });
  try {
    if (await tableExists(db, 'lms_course_pricing')) {
      console.log('lms_course_pricing already exists.');
    } else {
      await db.query(`
        CREATE TABLE lms_course_pricing (
          id CHAR(36) NOT NULL PRIMARY KEY,
          course_id CHAR(36) NOT NULL UNIQUE,
          access_type ENUM('free','one_time','recurring') NOT NULL DEFAULT 'free',
          price DECIMAL(10,2) NULL,
          interval_unit ENUM('month','year') NOT NULL DEFAULT 'month',
          interval_count INT NOT NULL DEFAULT 1,
          allow_buyer_choice TINYINT(1) NOT NULL DEFAULT 0,
          cohort_id CHAR(36) NULL,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('Created lms_course_pricing.');
    }
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
