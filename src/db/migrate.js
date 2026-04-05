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
ALTER TABLE audits ADD COLUMN IF NOT EXISTS rep_code TEXT;

CREATE TABLE IF NOT EXISTS reps (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rep_code TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  commission_audit NUMERIC DEFAULT 60,
  commission_monthly_monitor NUMERIC DEFAULT 15,
  commission_pro_monitor NUMERIC DEFAULT 20,
  commission_pro_plus NUMERIC DEFAULT 30,
  total_earned NUMERIC DEFAULT 0,
  total_paid NUMERIC DEFAULT 0,
  total_earned_ytd NUMERIC DEFAULT 0,
  w9_submitted BOOLEAN DEFAULT FALSE,
  w9_submitted_at TIMESTAMPTZ,
  agreement_signed BOOLEAN DEFAULT FALSE,
  agreement_signed_at TIMESTAMPTZ,
  agreement_ip_address TEXT,
  agreement_full_name TEXT,
  contractor_acknowledgment BOOLEAN DEFAULT FALSE,
  approved_at TIMESTAMPTZ,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rep_commissions (
  id SERIAL PRIMARY KEY,
  rep_id INTEGER REFERENCES reps(id) ON DELETE CASCADE NOT NULL,
  audit_id INTEGER REFERENCES audits(id) ON DELETE SET NULL,
  customer_email TEXT,
  customer_name TEXT,
  business_name TEXT,
  product_type TEXT NOT NULL,
  sale_amount NUMERIC NOT NULL,
  commission_amount NUMERIC NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','held','cancelled')),
  payment_status TEXT DEFAULT 'customer_paid' CHECK (payment_status IN ('customer_paid','payment_failed','refunded')),
  held_reason TEXT CHECK (held_reason IN (NULL,'payment_failed','customer_churned','refund','chargeback')),
  buffer_release_date TIMESTAMPTZ,
  buffer_status TEXT DEFAULT 'buffering' CHECK (buffer_status IN ('buffering','released','held','cancelled')),
  cleared_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rep_alerts (
  id SERIAL PRIMARY KEY,
  rep_id INTEGER REFERENCES reps(id) ON DELETE CASCADE NOT NULL,
  customer_email TEXT,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('payment_failed','customer_at_risk','commission_held','payout_ready')),
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rep_payouts (
  id SERIAL PRIMARY KEY,
  rep_id INTEGER REFERENCES reps(id) ON DELETE CASCADE NOT NULL,
  week_start_date DATE NOT NULL,
  week_end_date DATE NOT NULL,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  commission_ids INTEGER[] DEFAULT '{}',
  status TEXT DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','approved','processing','paid','cancelled')),
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  paid_at TIMESTAMPTZ,
  payment_method TEXT CHECK (payment_method IN (NULL,'stripe','manual','venmo','zelle')),
  payment_reference TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scan_results (
  id SERIAL PRIMARY KEY,
  audit_id INTEGER REFERENCES audits(id) ON DELETE CASCADE,
  business_name TEXT,
  city TEXT,
  state TEXT,
  overall_score INTEGER,
  google_score INTEGER,
  website_score INTEGER,
  yelp_score INTEGER,
  nap_score INTEGER,
  facebook_score INTEGER,
  raw_data JSONB,
  ai_insights JSONB,
  confidence VARCHAR(10),
  scanned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scan_findings (
  id SERIAL PRIMARY KEY,
  scan_result_id INTEGER REFERENCES scan_results(id) ON DELETE CASCADE,
  platform VARCHAR(50),
  severity VARCHAR(20),
  title VARCHAR(255),
  description TEXT,
  impact TEXT,
  fix TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scan_results_audit_id ON scan_results(audit_id);
CREATE INDEX IF NOT EXISTS idx_scan_findings_scan_result_id ON scan_findings(scan_result_id);

CREATE INDEX IF NOT EXISTS idx_rep_payouts_rep_id ON rep_payouts(rep_id);
CREATE INDEX IF NOT EXISTS idx_rep_payouts_status ON rep_payouts(status);

CREATE INDEX IF NOT EXISTS idx_audits_email ON audits(email);
CREATE INDEX IF NOT EXISTS idx_audits_status ON audits(status);
CREATE INDEX IF NOT EXISTS idx_audits_rep_code ON audits(rep_code);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_reviews_email ON reviews(email);
CREATE INDEX IF NOT EXISTS idx_reviews_audit_id ON reviews(audit_id);
CREATE INDEX IF NOT EXISTS idx_reps_rep_code ON reps(rep_code);
CREATE INDEX IF NOT EXISTS idx_reps_email ON reps(email);
CREATE INDEX IF NOT EXISTS idx_rep_commissions_rep_id ON rep_commissions(rep_id);
CREATE INDEX IF NOT EXISTS idx_rep_commissions_status ON rep_commissions(status);
CREATE INDEX IF NOT EXISTS idx_rep_alerts_rep_id ON rep_alerts(rep_id);
`;

async function migrate() {
  console.log('Running migration...');
  try { await pool.query(SQL); console.log('Migration complete.'); }
  catch (err) { console.error('Migration failed:', err.message); process.exit(1); }
  finally { await pool.end(); }
}
migrate();