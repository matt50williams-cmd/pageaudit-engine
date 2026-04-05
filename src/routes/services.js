const { queryOne, queryAll } = require('../db');
const { requireAuth } = require('../middleware/auth');

async function serviceRoutes(fastify) {

  // ── SUBMIT SERVICE REQUEST (public) ──
  fastify.post('/api/service-requests', async (request, reply) => {
    const { name, email, phone, service, bestTime, auditId, scanScore, rep_code } = request.body || {};
    if (!email || !service) return reply.status(400).send({ error: 'email and service are required' });

    // Find rep if code provided
    let repId = null;
    if (rep_code) {
      const rep = await queryOne('SELECT id FROM reps WHERE rep_code = $1', [rep_code]);
      if (rep) repId = rep.id;
    }

    const sr = await queryOne(
      `INSERT INTO service_requests (audit_id, customer_name, email, phone, service_requested, best_time, scan_score, rep_id, rep_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [auditId || null, name || null, email.toLowerCase().trim(), phone || null, service, bestTime || null, scanScore || null, repId, rep_code || null]
    );

    console.log(`[SERVICE REQUEST] New: ${service} from ${email} (score: ${scanScore || 'N/A'})`);

    return reply.send({ success: true, request: sr });
  });

  // ── ADMIN: LIST SERVICE REQUESTS ──
  fastify.get('/api/admin/service-requests', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: 'Admin access required' });
    const { status } = request.query;
    let where = '';
    const params = [];
    if (status) { where = 'WHERE sr.status = $1'; params.push(status); }
    const requests = await queryAll(
      `SELECT sr.*, r.full_name as rep_name FROM service_requests sr LEFT JOIN reps r ON sr.rep_id = r.id ${where} ORDER BY sr.created_at DESC LIMIT 200`,
      params
    );
    const stats = await queryOne(`
      SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'new') as new_count,
        COUNT(*) FILTER (WHERE status = 'contacted') as contacted, COUNT(*) FILTER (WHERE status = 'quoted') as quoted,
        COUNT(*) FILTER (WHERE status = 'closed') as closed FROM service_requests
    `);
    return reply.send({ requests, stats: { total: parseInt(stats.total), new: parseInt(stats.new_count), contacted: parseInt(stats.contacted), quoted: parseInt(stats.quoted), closed: parseInt(stats.closed) } });
  });

  // ── ADMIN: UPDATE SERVICE REQUEST STATUS ──
  fastify.patch('/api/admin/service-requests/:id', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: 'Admin access required' });
    const { status, notes } = request.body || {};
    const updates = [];
    const params = [];
    let idx = 1;
    if (status) { updates.push(`status = $${idx}`); params.push(status); idx++; }
    if (notes !== undefined) { updates.push(`notes = $${idx}`); params.push(notes); idx++; }
    if (!updates.length) return reply.status(400).send({ error: 'No fields to update' });
    params.push(request.params.id);
    const sr = await queryOne(`UPDATE service_requests SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    return reply.send({ success: true, request: sr });
  });
}

module.exports = serviceRoutes;
