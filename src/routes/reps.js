const { queryOne, queryAll } = require('../db');
const { requireAuth } = require('../middleware/auth');

async function repRoutes(fastify) {

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
}

module.exports = repRoutes;
