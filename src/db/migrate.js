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

ALTER TABLE reps ADD COLUMN IF NOT EXISTS partner_id INTEGER;

CREATE TABLE IF NOT EXISTS partner_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20),
  business_name VARCHAR(255),
  business_ein VARCHAR(20),
  city VARCHAR(100),
  state VARCHAR(50),
  partner_code VARCHAR(10) UNIQUE NOT NULL,
  partner_agreement_signed BOOLEAN DEFAULT FALSE,
  partner_agreement_signed_at TIMESTAMPTZ,
  partner_agreement_ip VARCHAR(50),
  partner_agreement_name VARCHAR(255),
  noncompete_acknowledged BOOLEAN DEFAULT FALSE,
  equipment_agreement_signed BOOLEAN DEFAULT FALSE,
  platform_license_fee DECIMAL(10,2) DEFAULT 299.00,
  promotional_period_ends DATE,
  override_audit DECIMAL(10,2) DEFAULT 10.00,
  override_monthly_monitor DECIMAL(10,2) DEFAULT 5.00,
  override_pro_monitor DECIMAL(10,2) DEFAULT 8.00,
  override_pro_plus DECIMAL(10,2) DEFAULT 12.00,
  override_website DECIMAL(10,2) DEFAULT 150.00,
  override_seo DECIMAL(10,2) DEFAULT 50.00,
  total_consultants INTEGER DEFAULT 0,
  active_consultants INTEGER DEFAULT 0,
  total_clients INTEGER DEFAULT 0,
  total_earned_ytd DECIMAL(10,2) DEFAULT 0,
  total_paid_lifetime DECIMAL(10,2) DEFAULT 0,
  territory_cities TEXT[],
  territory_zips TEXT[],
  status VARCHAR(20) DEFAULT 'pending',
  approved_at TIMESTAMPTZ,
  approved_by INTEGER,
  suspension_reason TEXT,
  w9_submitted BOOLEAN DEFAULT FALSE,
  annual_earnings_ytd DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS partner_payouts (
  id SERIAL PRIMARY KEY,
  partner_id INTEGER REFERENCES partner_accounts(id),
  week_start_date DATE,
  week_end_date DATE,
  gross_amount DECIMAL(10,2),
  license_fee_deduction DECIMAL(10,2) DEFAULT 0,
  clawback_deductions DECIMAL(10,2) DEFAULT 0,
  final_payout_amount DECIMAL(10,2),
  audit_override_count INTEGER DEFAULT 0,
  monthly_override_count INTEGER DEFAULT 0,
  status VARCHAR(30) DEFAULT 'pending_approval',
  approved_at TIMESTAMPTZ,
  approved_by INTEGER,
  paid_at TIMESTAMPTZ,
  payment_method VARCHAR(50),
  payment_reference VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS partner_commissions (
  id SERIAL PRIMARY KEY,
  partner_id INTEGER REFERENCES partner_accounts(id),
  rep_id INTEGER,
  customer_email TEXT,
  transaction_type VARCHAR(50),
  plan_type VARCHAR(50),
  amount_charged DECIMAL(10,2),
  override_amount DECIMAL(10,2),
  buffer_start_date TIMESTAMPTZ,
  buffer_release_date TIMESTAMPTZ,
  buffer_status VARCHAR(20) DEFAULT 'buffering',
  payment_status VARCHAR(30) DEFAULT 'customer_paid',
  status VARCHAR(20) DEFAULT 'pending',
  payout_id INTEGER REFERENCES partner_payouts(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS partner_alerts (
  id SERIAL PRIMARY KEY,
  partner_id INTEGER REFERENCES partner_accounts(id),
  alert_type VARCHAR(50),
  message TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_code ON partner_accounts(partner_code);
CREATE INDEX IF NOT EXISTS idx_partner_commissions_partner ON partner_commissions(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_payouts_partner ON partner_payouts(partner_id);
CREATE INDEX IF NOT EXISTS idx_reps_partner_id ON reps(partner_id);

CREATE TABLE IF NOT EXISTS rep_business_records (
  id SERIAL PRIMARY KEY,
  rep_id INTEGER,
  rep_code VARCHAR(20),
  business_name VARCHAR(255),
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(10),
  phone VARCHAR(50),
  website VARCHAR(255),
  industry VARCHAR(100),
  owner_first_name VARCHAR(100),
  owner_last_name VARCHAR(100),
  owner_direct_phone VARCHAR(20),
  owner_email VARCHAR(255),
  owner_preferred_contact VARCHAR(50),
  best_time_to_reach VARCHAR(100),
  is_decision_maker BOOLEAN DEFAULT TRUE,
  gatekeeper_name VARCHAR(100),
  gatekeeper_role VARCHAR(100),
  google_place_id VARCHAR(100),
  google_rating DECIMAL(3,1),
  google_review_count INTEGER,
  website_url VARCHAR(255),
  facebook_url VARCHAR(255),
  yelp_url VARCHAR(255),
  last_scan_score INTEGER,
  last_scan_data JSONB,
  last_scanned_at TIMESTAMPTZ,
  score_history JSONB DEFAULT '[]',
  total_consultations INTEGER DEFAULT 0,
  last_contacted_at TIMESTAMPTZ,
  contact_attempts INTEGER DEFAULT 0,
  status VARCHAR(50) DEFAULT 'prospect',
  pipeline_stage INTEGER DEFAULT 1,
  interest_level VARCHAR(20),
  estimated_close_date DATE,
  follow_up_date DATE,
  follow_up_notes TEXT,
  follow_up_hook TEXT,
  follow_up_method VARCHAR(20),
  assigned_rep_id INTEGER,
  assigned_rep_code VARCHAR(20),
  claimed_at TIMESTAMPTZ DEFAULT NOW(),
  claim_expires_at TIMESTAMPTZ,
  claim_status VARCHAR(20) DEFAULT 'active',
  is_customer BOOLEAN DEFAULT FALSE,
  customer_since DATE,
  customer_audit_id INTEGER,
  monthly_value DECIMAL(10,2),
  lifetime_value DECIMAL(10,2),
  is_do_not_contact BOOLEAN DEFAULT FALSE,
  do_not_contact_reason VARCHAR(255),
  notes TEXT,
  internal_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rep_biz_rep_id ON rep_business_records(rep_id);
CREATE INDEX IF NOT EXISTS idx_rep_biz_status ON rep_business_records(status);
CREATE INDEX IF NOT EXISTS idx_rep_biz_place_id ON rep_business_records(google_place_id);
CREATE INDEX IF NOT EXISTS idx_rep_biz_city ON rep_business_records(city);
CREATE INDEX IF NOT EXISTS idx_rep_biz_follow_up ON rep_business_records(follow_up_date);

CREATE TABLE IF NOT EXISTS rep_visits (
  id SERIAL PRIMARY KEY,
  rep_id INTEGER,
  rep_code VARCHAR(20),
  business_name VARCHAR(255),
  owner_name VARCHAR(255),
  phone VARCHAR(50),
  address TEXT,
  industry VARCHAR(100),
  outcome VARCHAR(30) CHECK (outcome IN ('closed','follow_up','demo_shown','not_interested','not_available')),
  notes TEXT,
  follow_up_date DATE,
  follow_up_done BOOLEAN DEFAULT FALSE,
  rep_link_sent BOOLEAN DEFAULT FALSE,
  lat DECIMAL,
  lng DECIMAL,
  visited_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rep_daily_stats (
  id SERIAL PRIMARY KEY,
  rep_id INTEGER,
  rep_code VARCHAR(20),
  date DATE NOT NULL,
  visits_count INTEGER DEFAULT 0,
  closes_count INTEGER DEFAULT 0,
  demos_count INTEGER DEFAULT 0,
  follow_ups_count INTEGER DEFAULT 0,
  not_interested_count INTEGER DEFAULT 0,
  earnings DECIMAL DEFAULT 0,
  streak_day INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(rep_id, date)
);

CREATE INDEX IF NOT EXISTS idx_rep_visits_rep_id ON rep_visits(rep_id);
CREATE INDEX IF NOT EXISTS idx_rep_visits_date ON rep_visits(visited_at);
CREATE INDEX IF NOT EXISTS idx_rep_visits_outcome ON rep_visits(outcome);
CREATE INDEX IF NOT EXISTS idx_rep_daily_stats_rep_id ON rep_daily_stats(rep_id);
CREATE INDEX IF NOT EXISTS idx_rep_daily_stats_date ON rep_daily_stats(date);

CREATE TABLE IF NOT EXISTS service_requests (
  id SERIAL PRIMARY KEY,
  audit_id INTEGER,
  customer_name VARCHAR(255),
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  service_requested VARCHAR(100) NOT NULL,
  best_time VARCHAR(100),
  scan_score INTEGER,
  rep_id INTEGER,
  rep_code VARCHAR(20),
  status VARCHAR(30) DEFAULT 'new' CHECK (status IN ('new','contacted','quoted','closed','lost')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_requests_status ON service_requests(status);

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

ALTER TABLE audits ADD COLUMN IF NOT EXISTS verified_website_url TEXT;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS verified_facebook_url TEXT;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS verified_yelp_url TEXT;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

ALTER TABLE audits ADD COLUMN IF NOT EXISTS website_snapshot_url TEXT;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS facebook_snapshot_url TEXT;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS yelp_snapshot_url TEXT;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS snapshot_captured_at TIMESTAMPTZ;

ALTER TABLE audits ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'basic';

ALTER TABLE audits ADD COLUMN IF NOT EXISTS selected_competitors JSONB;
`;

async function migrate() {
  console.log('Running migration...');
  try { await pool.query(SQL); console.log('Migration complete.'); }
  catch (err) { console.error('Migration failed:', err.message); process.exit(1); }
  finally { await pool.end(); }
}
migrate();