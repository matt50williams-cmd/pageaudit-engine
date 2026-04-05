const axios = require('axios');
const { queryOne, queryAll } = require('../db');
const { requireAuth } = require('../middleware/auth');

async function repRoutes(fastify) {

  // ── REP: LOG A VISIT ──
  fastify.post('/api/reps/visits', { preHandler: requireAuth }, async (request, reply) => {
    const rep = await queryOne('SELECT id, rep_code FROM reps WHERE email = $1', [request.user.email]);
    if (!rep) return reply.status(403).send({ error: 'Not a registered rep' });
    const { business_name, owner_name, phone, address, industry, outcome, notes, follow_up_date, rep_link_sent, lat, lng, scan_score } = request.body || {};
    if (!business_name || !outcome) return reply.status(400).send({ error: 'business_name and outcome required' });

    const visit = await queryOne(
      `INSERT INTO rep_visits (rep_id, rep_code, business_name, owner_name, phone, address, industry, outcome, notes, follow_up_date, rep_link_sent, lat, lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [rep.id, rep.rep_code, business_name, owner_name || null, phone || null, address || null, industry || null, outcome, notes || null, follow_up_date || null, rep_link_sent || false, lat || null, lng || null]
    );

    // Update daily stats
    const todayDate = new Date().toISOString().split('T')[0];
    const isClose = outcome === 'closed';
    const isDemo = outcome === 'demo_shown';
    const isFollowUp = outcome === 'follow_up';
    const isNotInterested = outcome === 'not_interested';
    await queryOne(
      `INSERT INTO rep_daily_stats (rep_id, rep_code, date, visits_count, closes_count, demos_count, follow_ups_count, not_interested_count, earnings)
       VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8)
       ON CONFLICT (rep_id, date) DO UPDATE SET
         visits_count = rep_daily_stats.visits_count + 1,
         closes_count = rep_daily_stats.closes_count + $4,
         demos_count = rep_daily_stats.demos_count + $5,
         follow_ups_count = rep_daily_stats.follow_ups_count + $6,
         not_interested_count = rep_daily_stats.not_interested_count + $7,
         earnings = rep_daily_stats.earnings + $8`,
      [rep.id, rep.rep_code, todayDate, isClose ? 1 : 0, isDemo ? 1 : 0, isFollowUp ? 1 : 0, isNotInterested ? 1 : 0, isClose ? 60 : 0]
    );

    return reply.send({ success: true, visit_id: visit.id });
  });

  // ── REP: GET MY VISITS ──
  fastify.get('/api/reps/visits', { preHandler: requireAuth }, async (request, reply) => {
    const rep = await queryOne('SELECT id FROM reps WHERE email = $1', [request.user.email]);
    if (!rep) return reply.status(403).send({ error: 'Not a registered rep' });
    const { date, outcome, limit } = request.query;
    let where = 'WHERE rep_id = $1';
    const params = [rep.id];
    let idx = 2;
    if (date) { where += ` AND DATE(visited_at) = $${idx}`; params.push(date); idx++; }
    if (outcome) { where += ` AND outcome = $${idx}`; params.push(outcome); idx++; }
    const visits = await queryAll(`SELECT * FROM rep_visits ${where} ORDER BY visited_at DESC LIMIT ${parseInt(limit) || 100}`, params);
    return reply.send({ visits });
  });

  // ── REP: GET MY STATS ──
  fastify.get('/api/reps/stats', { preHandler: requireAuth }, async (request, reply) => {
    const rep = await queryOne('SELECT id FROM reps WHERE email = $1', [request.user.email]);
    if (!rep) return reply.status(403).send({ error: 'Not a registered rep' });
    const todayDate = new Date().toISOString().split('T')[0];
    const todayStats = await queryOne('SELECT * FROM rep_daily_stats WHERE rep_id = $1 AND date = $2', [rep.id, todayDate]) || { visits_count: 0, closes_count: 0, demos_count: 0, follow_ups_count: 0, earnings: 0 };
    const weekStats = await queryOne(`SELECT COALESCE(SUM(visits_count),0) as visits, COALESCE(SUM(closes_count),0) as closes, COALESCE(SUM(earnings),0) as earnings FROM rep_daily_stats WHERE rep_id = $1 AND date >= CURRENT_DATE - INTERVAL '7 days'`, [rep.id]);
    const allTime = await queryOne('SELECT COALESCE(SUM(visits_count),0) as visits, COALESCE(SUM(closes_count),0) as closes, COALESCE(SUM(earnings),0) as earnings FROM rep_daily_stats WHERE rep_id = $1', [rep.id]);
    const streak = await queryAll('SELECT date FROM rep_daily_stats WHERE rep_id = $1 AND visits_count > 0 ORDER BY date DESC LIMIT 30', [rep.id]);
    let streakCount = 0;
    const d = new Date(); d.setHours(0, 0, 0, 0);
    for (const row of streak) {
      const rd = new Date(row.date + 'T00:00:00'); rd.setHours(0, 0, 0, 0);
      if (Math.abs(d - rd) <= 86400000) { streakCount++; d.setDate(d.getDate() - 1); } else break;
    }
    const totalCloses = parseInt(allTime.closes) || 0;
    const totalVisits = parseInt(allTime.visits) || 0;
    return reply.send({
      today: { visits: parseInt(todayStats.visits_count), closes: parseInt(todayStats.closes_count), demos: parseInt(todayStats.demos_count), follow_ups: parseInt(todayStats.follow_ups_count), earnings: parseFloat(todayStats.earnings) },
      this_week: { visits: parseInt(weekStats.visits), closes: parseInt(weekStats.closes), earnings: parseFloat(weekStats.earnings) },
      all_time: { visits: totalVisits, closes: totalCloses, earnings: parseFloat(allTime.earnings), close_rate: totalVisits > 0 ? Math.round((totalCloses / totalVisits) * 100) : 0 },
      streak: streakCount,
      total_closes: totalCloses,
    });
  });

  // ── REP: MORNING STATS ──
  fastify.get('/api/reps/morning-stats', { preHandler: requireAuth }, async (request, reply) => {
    const rep = await queryOne('SELECT id FROM reps WHERE email = $1', [request.user.email]);
    if (!rep) return reply.status(403).send({ error: 'Not a registered rep' });
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const yd = yesterday.toISOString().split('T')[0];
    const yStats = await queryOne('SELECT * FROM rep_daily_stats WHERE rep_id = $1 AND date = $2', [rep.id, yd]);
    const followUps = await queryAll("SELECT * FROM rep_visits WHERE rep_id = $1 AND outcome = 'follow_up' AND follow_up_done = FALSE AND follow_up_date <= CURRENT_DATE ORDER BY follow_up_date ASC", [rep.id]);
    return reply.send({
      yesterday: yStats ? { visits: parseInt(yStats.visits_count), closes: parseInt(yStats.closes_count), earnings: parseFloat(yStats.earnings) } : null,
      follow_ups_due: followUps.length,
      follow_ups: followUps.slice(0, 10),
    });
  });

  // ── PUBLIC: LEADERBOARD ──
  fastify.get('/api/reps/leaderboard', async (request, reply) => {
    const todayDate = new Date().toISOString().split('T')[0];
    const leaders = await queryAll(
      `SELECT r.full_name as name, r.rep_code, ds.visits_count as visits_today, ds.closes_count as closes_today, ds.earnings as earnings_today
       FROM rep_daily_stats ds JOIN reps r ON ds.rep_id = r.id
       WHERE ds.date = $1 ORDER BY ds.closes_count DESC, ds.visits_count DESC LIMIT 10`,
      [todayDate]
    );
    return reply.send({ leaderboard: leaders });
  });

  // ── ADMIN: REPS OVERVIEW ──
  fastify.get('/api/admin/reps/overview', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: 'Admin access required' });
    const todayDate = new Date().toISOString().split('T')[0];
    const reps = await queryAll(`
      SELECT r.id, r.full_name as name, r.rep_code, r.status, r.created_at,
        COALESCE(td.visits_count, 0) as today_visits, COALESCE(td.closes_count, 0) as today_closes, COALESCE(td.earnings, 0) as today_earnings,
        COALESCE(wk.visits, 0) as week_visits, COALESCE(wk.closes, 0) as week_closes, COALESCE(wk.earnings, 0) as week_earnings,
        COALESCE(at.visits, 0) as all_time_visits, COALESCE(at.closes, 0) as all_time_closes, COALESCE(at.earnings, 0) as all_time_earnings
      FROM reps r
      LEFT JOIN rep_daily_stats td ON td.rep_id = r.id AND td.date = $1
      LEFT JOIN LATERAL (SELECT SUM(visits_count) as visits, SUM(closes_count) as closes, SUM(earnings) as earnings FROM rep_daily_stats WHERE rep_id = r.id AND date >= CURRENT_DATE - INTERVAL '7 days') wk ON true
      LEFT JOIN LATERAL (SELECT SUM(visits_count) as visits, SUM(closes_count) as closes, SUM(earnings) as earnings FROM rep_daily_stats WHERE rep_id = r.id) at ON true
      ORDER BY td.closes_count DESC NULLS LAST, r.full_name ASC
    `, [todayDate]);
    return reply.send(reps);
  });

  // ── ADMIN: REP ACTIVITY ──
  fastify.get('/api/admin/reps/:repId/activity', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: 'Admin access required' });
    const visits = await queryAll('SELECT * FROM rep_visits WHERE rep_id = $1 ORDER BY visited_at DESC LIMIT 50', [request.params.repId]);
    const daily = await queryAll('SELECT * FROM rep_daily_stats WHERE rep_id = $1 ORDER BY date DESC LIMIT 30', [request.params.repId]);
    return reply.send({ visits, daily_stats: daily });
  });

  // ── REP DASHBOARD DATA (rep must be logged in) ──
  fastify.get('/api/rep/dashboard', { preHandler: requireAuth }, async (request, reply) => {
    const rep = await queryOne('SELECT * FROM reps WHERE email = $1 AND status = $2', [request.user.email, 'active']);
    if (!rep) return reply.status(403).send({ error: 'Not a registered rep' });

    const commissions = await queryAll(
      'SELECT * FROM rep_commissions WHERE rep_id = $1 ORDER BY created_at DESC LIMIT 100',
      [rep.id]
    );

    const alerts = await queryAll(
      'SELECT * FROM rep_alerts WHERE rep_id = $1 AND is_read = FALSE ORDER BY created_at DESC LIMIT 50',
      [rep.id]
    );

    const stats = await queryOne(`
      SELECT
        COUNT(*) as total_sales,
        COALESCE(SUM(commission_amount), 0) as total_earned,
        COALESCE(SUM(commission_amount) FILTER (WHERE status = 'pending'), 0) as pending_amount,
        COALESCE(SUM(commission_amount) FILTER (WHERE status = 'approved'), 0) as approved_amount,
        COALESCE(SUM(commission_amount) FILTER (WHERE status = 'paid'), 0) as paid_amount,
        COALESCE(SUM(commission_amount) FILTER (WHERE status = 'held'), 0) as held_amount,
        COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
        COUNT(*) FILTER (WHERE status = 'approved') as approved_count,
        COUNT(*) FILTER (WHERE status = 'paid') as paid_count,
        COUNT(*) FILTER (WHERE status = 'held') as held_count,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_count
      FROM rep_commissions WHERE rep_id = $1
    `, [rep.id]);

    return reply.send({
      rep: { id: rep.id, rep_code: rep.rep_code, full_name: rep.full_name, email: rep.email, phone: rep.phone, status: rep.status },
      commissions,
      alerts,
      stats: {
        total_sales: parseInt(stats.total_sales),
        total_earned: parseFloat(stats.total_earned),
        pending: { count: parseInt(stats.pending_count), amount: parseFloat(stats.pending_amount) },
        approved: { count: parseInt(stats.approved_count), amount: parseFloat(stats.approved_amount) },
        paid: { count: parseInt(stats.paid_count), amount: parseFloat(stats.paid_amount) },
        held: { count: parseInt(stats.held_count), amount: parseFloat(stats.held_amount) },
        cancelled: parseInt(stats.cancelled_count),
      },
    });
  });

  // ── DISMISS ALERT ──
  fastify.post('/api/rep/alerts/:id/read', { preHandler: requireAuth }, async (request, reply) => {
    const rep = await queryOne('SELECT id FROM reps WHERE email = $1', [request.user.email]);
    if (!rep) return reply.status(403).send({ error: 'Not a registered rep' });
    await queryOne('UPDATE rep_alerts SET is_read = TRUE WHERE id = $1 AND rep_id = $2', [request.params.id, rep.id]);
    return reply.send({ success: true });
  });

  // ── ADMIN: LIST ALL REPS ──
  fastify.get('/api/admin/reps', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: 'Admin access required' });
    const reps = await queryAll('SELECT * FROM reps ORDER BY created_at DESC');
    return reply.send(reps);
  });

  // ── ADMIN: CREATE REP ──
  fastify.post('/api/admin/reps', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: 'Admin access required' });
    const { full_name, email, phone, rep_code } = request.body || {};
    if (!full_name || !email || !rep_code) return reply.status(400).send({ error: 'full_name, email, and rep_code are required' });

    // Create user account for rep if not exists
    let user = await queryOne('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (!user) {
      const bcrypt = require('bcryptjs');
      const tempPassword = await bcrypt.hash(rep_code + '_temp', 12);
      user = await queryOne(
        'INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id',
        [email.toLowerCase().trim(), tempPassword, full_name, 'rep']
      );
    }

    try {
      const rep = await queryOne(
        'INSERT INTO reps (user_id, rep_code, full_name, email, phone) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [user.id, rep_code.toLowerCase().trim(), full_name, email.toLowerCase().trim(), phone || null]
      );
      return reply.send({ success: true, rep });
    } catch (err) {
      if (err.message?.includes('unique')) return reply.status(409).send({ error: 'Rep code or email already exists' });
      throw err;
    }
  });

  // ── ADMIN: UPDATE COMMISSION STATUS ──
  fastify.post('/api/admin/commissions/:id/status', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: 'Admin access required' });
    const { status, held_reason } = request.body || {};
    const validStatuses = ['pending', 'approved', 'paid', 'held', 'cancelled'];
    if (!validStatuses.includes(status)) return reply.status(400).send({ error: 'Invalid status' });

    const updates = ['status = $1', 'updated_at = NOW()'];
    const params = [status];
    let idx = 2;

    if (status === 'paid') { updates.push(`paid_at = NOW()`); }
    if (status === 'held' && held_reason) { updates.push(`held_reason = $${idx}`); params.push(held_reason); idx++; }
    if (status === 'pending' && held_reason === null) { updates.push('held_reason = NULL', 'cleared_at = NOW()'); }

    params.push(request.params.id);
    const commission = await queryOne(
      `UPDATE rep_commissions SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );

    // Create alert for rep if held
    if (status === 'held' && commission) {
      await queryOne(
        'INSERT INTO rep_alerts (rep_id, customer_email, alert_type, message) VALUES ($1, $2, $3, $4)',
        [commission.rep_id, commission.customer_email, 'commission_held',
          `Commission of $${commission.commission_amount} for ${commission.business_name || commission.customer_email} has been held: ${held_reason || 'payment issue'}`]
      ).catch(() => null);
    }
    if (status === 'approved' && commission) {
      await queryOne(
        'INSERT INTO rep_alerts (rep_id, customer_email, alert_type, message) VALUES ($1, $2, $3, $4)',
        [commission.rep_id, commission.customer_email, 'payout_ready',
          `$${commission.commission_amount} commission for ${commission.business_name || commission.customer_email} is approved and ready to pay!`]
      ).catch(() => null);
    }

    return reply.send({ success: true, commission });
  });

  // ── ADMIN: ALL COMMISSIONS ──
  fastify.get('/api/admin/commissions', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: 'Admin access required' });
    const commissions = await queryAll(`
      SELECT rc.*, r.full_name as rep_name, r.rep_code
      FROM rep_commissions rc
      JOIN reps r ON rc.rep_id = r.id
      ORDER BY rc.created_at DESC LIMIT 200
    `);
    return reply.send(commissions);
  });

  // ── ADMIN: RELEASE BUFFERED COMMISSIONS (run manually or via cron) ──
  fastify.post('/api/admin/commissions/release-buffer', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: 'Admin access required' });
    const released = await queryAll(
      `UPDATE rep_commissions SET buffer_status = 'released', updated_at = NOW()
       WHERE buffer_status = 'buffering' AND buffer_release_date <= NOW() AND payment_status = 'customer_paid'
       RETURNING id, rep_id, commission_amount`
    );
    console.log(`[REP] Released ${released.length} commissions from buffer`);
    return reply.send({ success: true, released_count: released.length, released });
  });

  // ── ADMIN: CREATE WEEKLY PAYOUT BATCH ──
  fastify.post('/api/admin/payouts/create-batch', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: 'Admin access required' });

    // Find all released commissions not yet in a payout, grouped by rep
    const eligible = await queryAll(`
      SELECT rep_id, array_agg(id) as commission_ids, SUM(commission_amount) as total
      FROM rep_commissions
      WHERE buffer_status = 'released' AND status = 'pending' AND payment_status = 'customer_paid'
        AND id NOT IN (SELECT unnest(commission_ids) FROM rep_payouts WHERE status != 'cancelled')
      GROUP BY rep_id
      HAVING SUM(commission_amount) >= 20
    `);

    const now = new Date();
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay() + 1); weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6); weekEnd.setHours(23, 59, 59, 999);

    const payouts = [];
    for (const row of eligible) {
      const payout = await queryOne(
        `INSERT INTO rep_payouts (rep_id, week_start_date, week_end_date, total_amount, commission_ids, status)
         VALUES ($1, $2, $3, $4, $5, 'pending_approval') RETURNING *`,
        [row.rep_id, weekStart.toISOString(), weekEnd.toISOString(), parseFloat(row.total), row.commission_ids]
      );
      payouts.push(payout);
    }

    return reply.send({ success: true, batches_created: payouts.length, payouts });
  });

  // ── ADMIN: LIST PAYOUTS ──
  fastify.get('/api/admin/payouts', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: 'Admin access required' });
    const filter = request.query.filter || 'all';
    let dateFilter = '';
    if (filter === 'this_week') dateFilter = "AND p.week_start_date >= date_trunc('week', CURRENT_DATE)";
    else if (filter === 'last_week') dateFilter = "AND p.week_start_date >= date_trunc('week', CURRENT_DATE) - INTERVAL '7 days' AND p.week_end_date < date_trunc('week', CURRENT_DATE)";
    else if (filter === 'this_month') dateFilter = "AND p.week_start_date >= date_trunc('month', CURRENT_DATE)";

    const payouts = await queryAll(`
      SELECT p.*, r.full_name as rep_name, r.rep_code, r.email as rep_email
      FROM rep_payouts p JOIN reps r ON p.rep_id = r.id
      WHERE 1=1 ${dateFilter}
      ORDER BY p.created_at DESC LIMIT 200
    `);

    const stats = await queryOne(`
      SELECT
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'pending_approval'), 0) as pending_total,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'approved' OR status = 'processing'), 0) as approved_total,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'paid' AND paid_at >= date_trunc('month', CURRENT_DATE)), 0) as paid_this_month,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'paid'), 0) as paid_all_time
      FROM rep_payouts
    `);

    return reply.send({
      payouts,
      stats: {
        pending_total: parseFloat(stats.pending_total),
        approved_total: parseFloat(stats.approved_total),
        paid_this_month: parseFloat(stats.paid_this_month),
        paid_all_time: parseFloat(stats.paid_all_time),
      },
    });
  });

  // ── ADMIN: UPDATE PAYOUT STATUS ──
  fastify.post('/api/admin/payouts/:id/status', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: 'Admin access required' });
    const { status, payment_method, payment_reference, notes } = request.body || {};
    const valid = ['pending_approval', 'approved', 'processing', 'paid', 'cancelled'];
    if (!valid.includes(status)) return reply.status(400).send({ error: 'Invalid status' });

    const updates = ['status = $1'];
    const params = [status];
    let idx = 2;
    if (status === 'approved') { updates.push('approved_at = NOW()', `approved_by = $${idx}`); params.push(request.user.id); idx++; }
    if (status === 'paid') {
      updates.push('paid_at = NOW()');
      if (payment_method) { updates.push(`payment_method = $${idx}`); params.push(payment_method); idx++; }
      if (payment_reference) { updates.push(`payment_reference = $${idx}`); params.push(payment_reference); idx++; }
    }
    if (notes) { updates.push(`notes = $${idx}`); params.push(notes); idx++; }

    params.push(request.params.id);
    const payout = await queryOne(`UPDATE rep_payouts SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`, params);

    // When paid, mark all included commissions as paid
    if (status === 'paid' && payout?.commission_ids?.length) {
      await queryOne(
        `UPDATE rep_commissions SET status = 'paid', paid_at = NOW(), updated_at = NOW() WHERE id = ANY($1)`,
        [payout.commission_ids]
      ).catch(() => null);

      // Alert the rep
      await queryOne(
        'INSERT INTO rep_alerts (rep_id, alert_type, message) VALUES ($1, $2, $3)',
        [payout.rep_id, 'payout_ready', `Your payout of $${payout.total_amount} has been paid!`]
      ).catch(() => null);
    }

    // When cancelled, release commissions back to pool
    if (status === 'cancelled' && payout?.commission_ids?.length) {
      await queryOne(
        `UPDATE rep_commissions SET status = 'pending', updated_at = NOW() WHERE id = ANY($1) AND status != 'paid'`,
        [payout.commission_ids]
      ).catch(() => null);
    }

    return reply.send({ success: true, payout });
  });

  // ── REP: MY PAYOUTS ──
  fastify.get('/api/rep/payouts', { preHandler: requireAuth }, async (request, reply) => {
    const rep = await queryOne('SELECT id FROM reps WHERE email = $1', [request.user.email]);
    if (!rep) return reply.status(403).send({ error: 'Not a registered rep' });
    const payouts = await queryAll('SELECT * FROM rep_payouts WHERE rep_id = $1 ORDER BY created_at DESC LIMIT 50', [rep.id]);
    return reply.send(payouts);
  });

  // ── LOOKUP REP BY CODE (public, used during checkout) ──
  fastify.get('/api/rep/lookup/:code', async (request, reply) => {
    const rep = await queryOne('SELECT id, rep_code, full_name FROM reps WHERE rep_code = $1 AND status = $2', [request.params.code.toLowerCase().trim(), 'active']);
    return reply.send({ rep: rep || null });
  });

  // ══════════════════════════════════════════════
  // BUSINESS RECORDS CRM
  // ══════════════════════════════════════════════

  // ── UPSERT BUSINESS RECORD ──
  fastify.post('/api/reps/businesses', { preHandler: requireAuth }, async (request, reply) => {
    const rep = await queryOne('SELECT id, rep_code FROM reps WHERE email = $1', [request.user.email]);
    if (!rep) return reply.status(403).send({ error: 'Not a registered rep' });
    const d = request.body || {};
    if (!d.business_name) return reply.status(400).send({ error: 'business_name required' });

    // Check if record exists by place_id or name+address
    let existing = null;
    if (d.google_place_id) existing = await queryOne('SELECT id FROM rep_business_records WHERE rep_id = $1 AND google_place_id = $2', [rep.id, d.google_place_id]);
    if (!existing && d.business_name) existing = await queryOne('SELECT id FROM rep_business_records WHERE rep_id = $1 AND LOWER(business_name) = LOWER($2) AND LOWER(COALESCE(city,\'\')) = LOWER($3)', [rep.id, d.business_name, d.city || '']);

    if (existing) {
      // Update
      const record = await queryOne(
        `UPDATE rep_business_records SET
          business_name = COALESCE($1, business_name), address = COALESCE($2, address), city = COALESCE($3, city), state = COALESCE($4, state),
          phone = COALESCE($5, phone), website = COALESCE($6, website), industry = COALESCE($7, industry),
          owner_first_name = COALESCE($8, owner_first_name), owner_last_name = COALESCE($9, owner_last_name),
          owner_direct_phone = COALESCE($10, owner_direct_phone), owner_email = COALESCE($11, owner_email),
          owner_preferred_contact = COALESCE($12, owner_preferred_contact), best_time_to_reach = COALESCE($13, best_time_to_reach),
          is_decision_maker = COALESCE($14, is_decision_maker), gatekeeper_name = COALESCE($15, gatekeeper_name),
          google_place_id = COALESCE($16, google_place_id), last_scan_score = COALESCE($17, last_scan_score),
          last_scan_data = COALESCE($18, last_scan_data), last_scanned_at = COALESCE($19, last_scanned_at),
          status = COALESCE($20, status), interest_level = COALESCE($21, interest_level),
          follow_up_date = COALESCE($22, follow_up_date), follow_up_notes = COALESCE($23, follow_up_notes),
          follow_up_hook = COALESCE($24, follow_up_hook), follow_up_method = COALESCE($25, follow_up_method),
          notes = COALESCE($26, notes), total_consultations = total_consultations + 1,
          last_contacted_at = NOW(), contact_attempts = contact_attempts + 1, updated_at = NOW()
        WHERE id = $27 RETURNING *`,
        [d.business_name, d.address, d.city, d.state, d.phone, d.website, d.industry,
         d.owner_first_name, d.owner_last_name, d.owner_direct_phone, d.owner_email,
         d.owner_preferred_contact, d.best_time_to_reach, d.is_decision_maker, d.gatekeeper_name,
         d.google_place_id, d.last_scan_score, d.last_scan_data ? JSON.stringify(d.last_scan_data) : null,
         d.last_scanned_at, d.status, d.interest_level, d.follow_up_date, d.follow_up_notes,
         d.follow_up_hook, d.follow_up_method, d.notes, existing.id]
      );
      // Update score history if score changed
      if (d.last_scan_score && record) {
        const history = record.score_history || [];
        history.push({ date: new Date().toISOString().split('T')[0], score: d.last_scan_score });
        await queryOne('UPDATE rep_business_records SET score_history = $1 WHERE id = $2', [JSON.stringify(history.slice(-20)), record.id]);
      }
      return reply.send({ success: true, record, updated: true });
    }

    // Create new
    const record = await queryOne(
      `INSERT INTO rep_business_records (rep_id, rep_code, business_name, address, city, state, phone, website, industry,
        owner_first_name, owner_last_name, owner_direct_phone, owner_email, owner_preferred_contact, best_time_to_reach,
        is_decision_maker, gatekeeper_name, google_place_id, last_scan_score, last_scan_data, last_scanned_at,
        status, interest_level, follow_up_date, follow_up_notes, follow_up_hook, follow_up_method, notes,
        assigned_rep_id, assigned_rep_code, claim_expires_at, total_consultations, last_contacted_at, contact_attempts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,NOW()+INTERVAL'30 days',1,NOW(),1) RETURNING *`,
      [rep.id, rep.rep_code, d.business_name, d.address || null, d.city || null, d.state || null, d.phone || null, d.website || null, d.industry || null,
       d.owner_first_name || null, d.owner_last_name || null, d.owner_direct_phone || null, d.owner_email || null,
       d.owner_preferred_contact || null, d.best_time_to_reach || null, d.is_decision_maker ?? true, d.gatekeeper_name || null,
       d.google_place_id || null, d.last_scan_score || null, d.last_scan_data ? JSON.stringify(d.last_scan_data) : null,
       d.last_scanned_at || null, d.status || 'prospect', d.interest_level || null,
       d.follow_up_date || null, d.follow_up_notes || null, d.follow_up_hook || null, d.follow_up_method || null,
       d.notes || null, rep.id, rep.rep_code]
    );
    return reply.send({ success: true, record });
  });

  // ── GET ALL BUSINESS RECORDS ──
  fastify.get('/api/reps/businesses', { preHandler: requireAuth }, async (request, reply) => {
    const rep = await queryOne('SELECT id FROM reps WHERE email = $1', [request.user.email]);
    if (!rep) return reply.status(403).send({ error: 'Not a registered rep' });
    const { status, city, industry, search, sort } = request.query;
    let where = 'WHERE rep_id = $1';
    const params = [rep.id];
    let idx = 2;
    if (status) { where += ` AND status = $${idx}`; params.push(status); idx++; }
    if (city) { where += ` AND LOWER(city) = LOWER($${idx})`; params.push(city); idx++; }
    if (industry) { where += ` AND industry = $${idx}`; params.push(industry); idx++; }
    if (search) { where += ` AND (LOWER(business_name) LIKE LOWER($${idx}) OR LOWER(owner_first_name) LIKE LOWER($${idx}) OR LOWER(owner_last_name) LIKE LOWER($${idx}))`; params.push(`%${search}%`); idx++; }
    const orderBy = sort === 'follow_up' ? 'follow_up_date ASC NULLS LAST' : sort === 'score' ? 'last_scan_score ASC NULLS LAST' : sort === 'recent' ? 'last_contacted_at DESC NULLS LAST' : 'updated_at DESC';
    const records = await queryAll(`SELECT * FROM rep_business_records ${where} ORDER BY ${orderBy} LIMIT 200`, params);
    return reply.send({ records });
  });

  // ── GET FOLLOW-UPS DUE ──
  fastify.get('/api/reps/businesses/follow-ups-due', { preHandler: requireAuth }, async (request, reply) => {
    const rep = await queryOne('SELECT id FROM reps WHERE email = $1', [request.user.email]);
    if (!rep) return reply.status(403).send({ error: 'Not a registered rep' });
    const records = await queryAll(
      "SELECT * FROM rep_business_records WHERE rep_id = $1 AND follow_up_date <= CURRENT_DATE AND status NOT IN ('client','not_a_fit','do_not_contact') ORDER BY follow_up_date ASC",
      [rep.id]
    );
    return reply.send({ records });
  });

  // ── UPDATE BUSINESS RECORD ──
  fastify.patch('/api/reps/businesses/:id', { preHandler: requireAuth }, async (request, reply) => {
    const rep = await queryOne('SELECT id FROM reps WHERE email = $1', [request.user.email]);
    if (!rep) return reply.status(403).send({ error: 'Not a registered rep' });
    const d = request.body || {};
    const fields = [];
    const params = [];
    let idx = 1;
    const allowedFields = ['status','interest_level','follow_up_date','follow_up_notes','follow_up_hook','follow_up_method','notes','owner_first_name','owner_last_name','owner_direct_phone','owner_email','best_time_to_reach','gatekeeper_name','is_do_not_contact'];
    for (const key of allowedFields) {
      if (d[key] !== undefined) { fields.push(`${key} = $${idx}`); params.push(d[key]); idx++; }
    }
    if (fields.length === 0) return reply.status(400).send({ error: 'No fields to update' });
    fields.push('updated_at = NOW()');
    params.push(request.params.id); params.push(rep.id);
    const record = await queryOne(`UPDATE rep_business_records SET ${fields.join(', ')} WHERE id = $${idx} AND rep_id = $${idx + 1} RETURNING *`, params);
    return reply.send({ success: true, record });
  });

  // ── GET SINGLE BUSINESS RECORD WITH VISIT HISTORY ──
  fastify.get('/api/reps/businesses/:id', { preHandler: requireAuth }, async (request, reply) => {
    const rep = await queryOne('SELECT id FROM reps WHERE email = $1', [request.user.email]);
    if (!rep) return reply.status(403).send({ error: 'Not a registered rep' });
    const record = await queryOne('SELECT * FROM rep_business_records WHERE id = $1 AND rep_id = $2', [request.params.id, rep.id]);
    if (!record) return reply.status(404).send({ error: 'Record not found' });
    const visits = await queryAll('SELECT * FROM rep_visits WHERE rep_id = $1 AND LOWER(business_name) = LOWER($2) ORDER BY visited_at DESC LIMIT 20', [rep.id, record.business_name]);
    return reply.send({ record, visits });
  });

  // ── ADMIN: ALL BUSINESS RECORDS ──
  fastify.get('/api/admin/businesses', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: 'Admin access required' });
    const { status, rep_id, city, industry, search, limit: lim } = request.query;
    let where = 'WHERE 1=1';
    const params = [];
    let idx = 1;
    if (status) { where += ` AND b.status = $${idx}`; params.push(status); idx++; }
    if (rep_id) { where += ` AND b.rep_id = $${idx}`; params.push(parseInt(rep_id)); idx++; }
    if (city) { where += ` AND LOWER(b.city) = LOWER($${idx})`; params.push(city); idx++; }
    if (industry) { where += ` AND b.industry = $${idx}`; params.push(industry); idx++; }
    if (search) { where += ` AND (LOWER(b.business_name) LIKE LOWER($${idx}) OR LOWER(b.owner_first_name) LIKE LOWER($${idx}) OR LOWER(b.owner_direct_phone) LIKE $${idx})`; params.push(`%${search}%`); idx++; }
    const records = await queryAll(`SELECT b.*, r.full_name as rep_name FROM rep_business_records b LEFT JOIN reps r ON b.rep_id = r.id ${where} ORDER BY b.updated_at DESC LIMIT ${parseInt(lim) || 200}`, params);
    const stats = await queryOne(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_customer) as customers, COUNT(*) FILTER (WHERE status = 'following_up') as follow_ups, COUNT(*) FILTER (WHERE status = 'not_a_fit') as not_a_fit FROM rep_business_records`);
    return reply.send({ records, stats: { total: parseInt(stats.total), customers: parseInt(stats.customers), follow_ups: parseInt(stats.follow_ups), not_a_fit: parseInt(stats.not_a_fit) } });
  });
}

module.exports = repRoutes;
