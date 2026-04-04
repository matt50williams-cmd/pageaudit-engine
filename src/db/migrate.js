require('dotenv').config();
const { pool } = require('./index');

const SQL = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  full_name TEXT, role TEXT DEFAULT 'user', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS audits (
  id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  customer_name TEXT, email TEXT NOT NULL, facebook_url TEXT, account_type TEXT DEFAULT 'Business',
  goals TEXT, posting_frequency TEXT, content_type TEXT, status TEXT DEFAULT 'pending',
  report_text TEXT, analysis JSONB, overall_score NUMERIC, visibility_score NUMERIC,
  content_score NUMERIC, consistency_score NUMERIC, engagement_score NUMERIC, growth_score NUMERIC,
  data_confidence TEXT, scraper_status TEXT, scraper_data JSONB, stripe_session_id TEXT,
  paid BOOLEAN DEFAULT FALSE, amount_paid NUMERIC, website TEXT, city TEXT,
  business_name TEXT, seo_score NUMERIC, facebook_not_found BOOLEAN DEFAULT FALSE, utm_source TEXT, utm_campaign TEXT,
  utm_adset TEXT, utm_ad TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS funnel_events (
  id SERIAL PRIMARY KEY, event_type TEXT NOT NULL, email TEXT, report_id INTEGER,
  facebook_url TEXT, utm_source TEXT, utm_campaign TEXT, utm_adset TEXT, utm_ad TEXT,
  metadata JSONB, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY, audit_id INTEGER REFERENCES audits(id) ON DELETE CASCADE,
  email TEXT NOT NULL, customer_name TEXT, business_name TEXT,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  feedback TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audits_email ON audits(email);
CREATE INDEX IF NOT EXISTS idx_audits_status ON audits(status);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_reviews_email ON reviews(email);
CREATE INDEX IF NOT EXISTS idx_reviews_audit_id ON reviews(audit_id);
`;

async function migrate() {
  console.log('Running migration...');
  try { await pool.query(SQL); console.log('Migration complete.'); }
  catch (err) { console.error('Migration failed:', err.message); process.exit(1); }
  finally { await pool.end(); }
}
migrate();