const { queryOne, queryAll } = require('../db');
const { requireAuth } = require('../middleware/auth');

function generateCode(length) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < length; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function partnerRoutes(fastify) {

  // ── PARTNER APPLICATION ──
  fastify.post('/api/partners/apply', async (request, reply) => {
    const { fullName, email, phone, businessName, city, state } = request.body || {};
    if (!fullName || !email) return reply.status(400).send({ error: 'fullName and email required' });

    const partnerCode = generateCode(6);
    let user = await queryOne('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (!user) {
      const bcrypt = require('bcryptjs');
      const tempPw = await bcrypt.hash(partnerCode + '_partner', 12);
      user = await queryOne('INSERT INTO users (email, password_hash, full_name, role) VALUES ($1,$2,$3,$4) RETURNING id', [email.toLowerCase().trim(), tempPw, fullName, 'partner']);
    }

    try {
      const partner = await queryOne(
        `INSERT INTO partner_accounts (user_id, full_name, email, phone, business_name, city, state, partner_code, promotional_period_ends)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW() + INTERVAL '30 days') RETURNING *`,
        [user.id, fullName, email.toLowerCase().trim(), phone || null, businessName || null, city || null, state || null, partnerCode]
      );
      return reply.send({ success: true, partner });
    } catch (err) {
      if (err.message?.includes('unique')) return reply.status(409).send({ error: 'Email already registered as partner' });
      throw err;
    }
  });

  // ── PARTNER DASHBOARD ──
  fastify.get('/api/partners/dashboard', { preHandler: requireAuth }, async (request, reply) => {
    const partner = await queryOne('SELECT * FROM partner_accounts WHERE email = $1', [request.user.email]);
    if (!partner) return reply.status(404).send({ error: 'Not a partner' });

    const consultants = await queryAll('SELECT * FROM reps WHERE partner_id = $1 ORDER BY created_at DESC', [partner.id]);
    const commissions = await queryAll('SELECT * FROM partner_commissions WHERE partner_id = $1 ORDER BY created_at DESC LIMIT 50', [partner.id]);
    const alerts = await queryAll('SELECT * FROM partner_alerts WHERE partner_id = $1 AND is_read = FALSE ORDER BY created_at DESC', [partner.id]);
    const payouts = await queryAll('SELECT * FROM partner_payouts WHERE partner_id = $1 ORDER BY created_at DESC LIMIT 20', [partner.id]);

    const stats = await queryOne(`
      SELECT
        COALESCE(SUM(override_amount) FILTER (WHERE status = 'paid'), 0) as total_paid,
        COALESCE(SUM(override_amount) FILTER (WHERE status = 'pending'), 0) as pending_amount,
        COALESCE(SUM(override_amount) FILTER (WHERE buffer_status = 'buffering'), 0) as buffering_amount,
        COALESCE(SUM(override_amount), 0) as total_earned,
        COUNT(*) as total_transactions
      FROM partner_commissions WHERE partner_id = $1
    `, [partner.id]);

    return reply.send({
      partner,
      consultants: consultants || [],
      commissions: commissions || [],
      alerts: alerts || [],
      payouts: payouts || [],
      stats: {
        total_consultants: consultants?.length || 0,
        total_paid: parseFloat(stats.total_paid),
        pending: parseFloat(stats.pending_amount),
        buffering: parseFloat(stats.buffering_amount),
        total_earned: parseFloat(stats.total_earned),
        total_transactions: parseInt(stats.total_transactions),
      },
    });
  });

  // ── PARTNER: DISMISS ALERT ──
  fastify.post('/api/partners/alerts/:id/read', { preHandler: requireAuth }, async (request, reply) => {
    const partner = await queryOne('SELECT id FROM partner_accounts WHERE email = $1', [request.user.email]);
    if (!partner) return reply.status(403).send({ error: 'Not a partner' });
    await queryOne('UPDATE partner_alerts SET is_read = TRUE WHERE id = $1 AND partner_id = $2', [request.params.id, partner.id]);
    return reply.send({ success: true });
  });

  // ── PARTNER: MY PAYOUTS ──
  fastify.get('/api/partners/payouts', { preHandler: requireAuth }, async (request, reply) => {
    const partner = await queryOne('SELECT id FROM partner_accounts WHERE email = $1', [request.user.email]);
    if (!partner) return reply.status(403).send({ error: 'Not a partner' });
    const payouts = await queryAll('SELECT * FROM partner_payouts WHERE partner_id = $1 ORDER BY created_at DESC LIMIT 50', [partner.id]);
    return reply.send(payouts || []);
  });

  // ── PARTNER: GENERATE CONSULTANT INVITE LINK ──
  fastify.get('/api/partners/invite-link', { preHandler: requireAuth }, async (request, reply) => {
    const partner = await queryOne('SELECT partner_code FROM partner_accounts WHERE email = $1', [request.user.email]);
    if (!partner) return reply.status(403).send({ error: 'Not a partner' });
    const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
    return reply.send({ link: `${frontendUrl}/join?partner=${partner.partner_code}` });
  });

  // ── ADMIN: ALL PARTNERS ──
  fastify.get('/api/admin/partners', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: 'Admin access required' });
    const partners = await queryAll(`
      SELECT p.*, COUNT(DISTINCT r.id) as consultant_count
      FROM partner_accounts p
      LEFT JOIN reps r ON r.partner_id = p.id
      GROUP BY p.id ORDER BY p.created_at DESC
    `);
    return reply.send({ partners: partners || [] });
  });

  // ── ADMIN: APPROVE PARTNER ──
  fastify.patch('/api/admin/partners/:id/approve', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: 'Admin access required' });
    await queryOne('UPDATE partner_accounts SET status = $1, approved_at = NOW(), approved_by = $2 WHERE id = $3', ['active', request.user.id, request.params.id]);
    return reply.send({ success: true });
  });

  // ── ADMIN: SUSPEND PARTNER ──
  fastify.patch('/api/admin/partners/:id/suspend', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: 'Admin access required' });
    const { reason } = request.body || {};
    await queryOne('UPDATE partner_accounts SET status = $1, suspension_reason = $2 WHERE id = $3', ['suspended', reason || null, request.params.id]);
    return reply.send({ success: true });
  });

  // ── ADMIN: GENERATE PARTNER PAYOUT BATCHES ──
  fastify.post('/api/admin/partners/payouts/generate', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: 'Admin access required' });

    const pending = await queryAll(`
      SELECT partner_id, SUM(override_amount) as total, COUNT(*) as count
      FROM partner_commissions
      WHERE buffer_status = 'released' AND payment_status = 'customer_paid' AND status = 'pending' AND payout_id IS NULL
      GROUP BY partner_id HAVING SUM(override_amount) >= 20
    `);

    const payouts = [];
    for (const batch of pending) {
      const partner = await queryOne('SELECT * FROM partner_accounts WHERE id = $1', [batch.partner_id]);
      if (!partner) continue;
      const promoEnded = new Date() > new Date(partner.promotional_period_ends);
      const licenseFee = promoEnded ? parseFloat(partner.platform_license_fee) : 0;
      const finalAmount = Math.max(parseFloat(batch.total) - licenseFee, 0);
      if (finalAmount < 20) continue;

      const payout = await queryOne(
        `INSERT INTO partner_payouts (partner_id, gross_amount, license_fee_deduction, final_payout_amount, week_start_date, week_end_date)
         VALUES ($1, $2, $3, $4, DATE_TRUNC('week', NOW()), DATE_TRUNC('week', NOW()) + INTERVAL '6 days') RETURNING *`,
        [batch.partner_id, parseFloat(batch.total), licenseFee, finalAmount]
      );
      payouts.push(payout);
    }
    return reply.send({ success: true, count: payouts.length, payouts });
  });

  // ── ADMIN: UPDATE PARTNER PAYOUT STATUS ──
  fastify.patch('/api/admin/partners/payouts/:id', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: 'Admin access required' });
    const { status, payment_method, payment_reference, notes } = request.body || {};
    const updates = ['status = $1'];
    const params = [status];
    let idx = 2;
    if (status === 'approved') { updates.push('approved_at = NOW()'); updates.push(`approved_by = $${idx}`); params.push(request.user.id); idx++; }
    if (status === 'paid') { updates.push('paid_at = NOW()'); if (payment_method) { updates.push(`payment_method = $${idx}`); params.push(payment_method); idx++; } if (payment_reference) { updates.push(`payment_reference = $${idx}`); params.push(payment_reference); idx++; } }
    if (notes) { updates.push(`notes = $${idx}`); params.push(notes); idx++; }
    params.push(request.params.id);
    const payout = await queryOne(`UPDATE partner_payouts SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    return reply.send({ success: true, payout });
  });

  // ── PUBLIC: LOOKUP PARTNER BY CODE ──
  fastify.get('/api/partners/lookup/:code', async (request, reply) => {
    const partner = await queryOne('SELECT id, partner_code, full_name, business_name FROM partner_accounts WHERE partner_code = $1 AND status = $2', [request.params.code.toUpperCase().trim(), 'active']);
    return reply.send({ partner: partner || null });
  });
}

module.exports = partnerRoutes;
