require('dotenv').config();
const { pool } = require('./index');

const SQL = `
ALTER TABLE audits ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS business_name TEXT;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS seo_score NUMERIC;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS facebook_not_found BOOLEAN DEFAULT FALSE;
`;

async function run() {
  console.log('Adding missing columns to audits table...');
  try {
    await pool.query(SQL);
    console.log('Done. Columns added successfully.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
