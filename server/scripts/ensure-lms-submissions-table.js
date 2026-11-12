#!/usr/bin/env node
// Creates lms_lesson_submissions — the data model the vendor engine never had
// (confirmed: its schema has no field for a learner to submit anything for an
// assignment-kind lesson). A submission sits 'pending' until a staff member
// grades it (routes/lms.js's POST /submissions/:id/grade), which is also the
// moment that lesson is marked complete for that learner (via the vendor's
// own completeLesson(), called with a context acting as that learner).
//
// Safe to re-run.
//
//   node scripts/ensure-lms-submissions-table.js --database my_local_db

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
    if (await tableExists(db, 'lms_lesson_submissions')) {
      console.log('lms_lesson_submissions already exists.');
    } else {
      await db.query(`
        CREATE TABLE lms_lesson_submissions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          lesson_id CHAR(36) NOT NULL,
          contact_id INT NOT NULL,
          body_text TEXT,
          attachment_object_key VARCHAR(500),
          submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          status ENUM('pending','graded') NOT NULL DEFAULT 'pending',
          score INT NULL,
          feedback TEXT,
          graded_at TIMESTAMP NULL,
          graded_by_user_id INT NULL,
          INDEX idx_lesson (lesson_id),
          INDEX idx_contact (contact_id),
          INDEX idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('Created lms_lesson_submissions.');
    }
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
