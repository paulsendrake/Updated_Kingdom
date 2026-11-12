#!/usr/bin/env node
// Creates lms_curriculum_drafts — staging for AI-assisted course authoring
// ("Draft with AI"). The draft is never a shortcut around the vendor's own
// authoring functions: accepting a draft (routes/lms.js's
// POST /curriculum-drafts/:id/accept) walks draft_json and calls
// createCourse/createModule/createLesson for real, same as a human typing it
// in by hand. This table only holds the generated outline while staff review
// and edit it.
//
// Safe to re-run.
//
//   node scripts/ensure-lms-curriculum-drafts-table.js --database my_local_db

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
    if (await tableExists(db, 'lms_curriculum_drafts')) {
      console.log('lms_curriculum_drafts already exists.');
    } else {
      await db.query(`
        CREATE TABLE lms_curriculum_drafts (
          id INT AUTO_INCREMENT PRIMARY KEY,
          prompt_input JSON NOT NULL,
          draft_json JSON NOT NULL,
          status ENUM('draft','accepted','discarded') NOT NULL DEFAULT 'draft',
          created_by_user_id INT NULL,
          created_course_id CHAR(36) NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('Created lms_curriculum_drafts.');
    }
  } finally {
    await db.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
