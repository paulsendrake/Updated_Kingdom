#!/usr/bin/env node
// Creates lms_certificates — an app-owned record of completion certificates,
// auto-issued (never a staff button) the moment a learner's course progress
// hits 100%. One row per (course, contact); certificate_number is the
// human-readable serial shown on the PDF. No DB FK into the vendor's
// lms_courses (char(36), app-enforced only — same reasoning as every other
// LMS add-on table this app owns).
//
// Safe to re-run.
//
//   node scripts/ensure-lms-certificates-table.js --database my_local_db

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
    if (await tableExists(db, 'lms_certificates')) {
      console.log('lms_certificates already exists.');
    } else {
      await db.query(`
        CREATE TABLE lms_certificates (
          id INT AUTO_INCREMENT PRIMARY KEY,
          course_id CHAR(36) NOT NULL,
          contact_id INT NOT NULL,
          certificate_number VARCHAR(40) NOT NULL UNIQUE,
          issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_course_contact (course_id, contact_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('Created lms_certificates.');
    }
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
