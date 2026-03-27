const { queryOne, queryAll } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { runAnalyzer } = require('../services/analyzer');
const { runWriter } = require('../services/reportWriter');

async function auditRoutes(fastify) {
  fastify.post('/api/audits', async (request, reply) => {
    const { customer_name, email, facebook_url, account_type, goals, posting_frequency, content_type, utm_source, utm_campaign, utm_adset, utm_ad } = request.body || {};
    if (!email || !facebook_url) return reply.status(400).send({ error: 'Email and Facebook URL are required' });
    const audit = await queryOne(
      'INSERT INTO audits (customer_name, email, facebook_url, account_type, goals, posting_frequency, content_type, status, utm_source, utm_campaign, utm_adset, utm_ad) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',
      [customer_name, email.toLowerCase().trim(), facebook_url, account_type||'Business', goals, posting_frequency, content_type, 'pending', utm_source, utm_campaign, utm_adset, utm_ad]
    );
    return reply.send({ success: true, audit });
  });

  fastify.post('/api/audits/:id/run', async (request, reply) => {
    const { id } = request.params;
    const audit = await queryOne('SELECT * FROM audits WHERE id = $1', [id]);
    if (!audit) return reply.status(404).send({ error: 'Audit not found' });
    try {
      await queryOne('UPDATE audits SET status = $1, updated_at = NOW() WHERE id = $2', ['analyzing', id]);
      const order = {
        name: audit.customer_name,
        email: audit.email,
        pageUrl: audit.facebook_url,
        mainGoal: audit.goals,
        postingFrequency: audit.posting_frequency,
        contentType: audit.content_type
      };
      const analyzerResult = await runAnalyzer(order);
      const writerResult = await runWriter(order, analyzerResult.analysis);
      const overallScore = calculateOverallScore(analyzerResult.analysis);
      const updated = await queryOne(
        'UPDATE audits SET report_text=$1, analysis=$2, overall_score=$3, visibility_score=$4, content_score=$5, consistency_score=$6, engagement_score=$7, growth_score=$8, status=$9, scraper_status=$10, updated_at=NOW() WHERE id=$11 RETURNING *',
        [writerResult.reportText, JSON.stringify(analyzerResult.analysis), overallScore, 60, 60, 50, analyzerResult.analysis?.verified_metrics?.engagement_level==='high'?80:50, 60, 'completed', analyzerResult.scraperStatus, id]
      );
      return reply.send({ success: true, audit_id: updated.id, report_text: writerResult.reportText, analysis: analyzerResult.analysis, scores: { overall: overallScore }, scraper_status: analyzerResult.scraperStatus });
    } catch (err) {
      await queryOne('UPDATE audits SET status = $1, updated_at = NOW() WHERE id = $2', ['failed', id]);
      return reply.status(500).send({ error: err.message || 'Audit generation failed' });
    }
  });

  fastify.get('/api/audits/:id', async (request, reply) => {
    const audit = await queryOne('SELECT * FROM audits WHERE id = $1', [request.params.id]);
    if (!audit) return reply.status(404).send({ error: 'Audit not found' });
    return reply.send(audit);
  });

  fastify.get('/api/audits', { preHandler: requireAuth }, async (request, reply) => {
    const audits = await queryAll('SELECT * FROM audits WHERE email = $1 ORDER BY updated_at DESC LIMIT 50', [request.user.email]);
    return reply.send(audits);
  });

  fastify.get('/api/admin/audits', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: 'Admin access required' });
    const audits = await queryAll('SELECT * FROM audits ORDER BY created_at DESC LIMIT 100');
    return reply.send(audits);
  });

  fastify.delete('/api/admin/audits/:id', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: 'Admin access required' });
    const { id } = request.params;
    const audit = await queryOne('SELECT id FROM audits WHERE id = $1', [id]);
    if (!audit) return reply.status(404).send({ error: 'Audit not found' });
    await queryOne('DELETE FROM audits WHERE id = $1', [id]);
    return reply.send({ success: true });
  });
}

function calculateOverallScore(analysis) {
  if (!analysis) return 50;
  let score = 50;
  const level = analysis.verified_metrics?.engagement_level;
  if (level === 'high') score += 20;
  else if (level === 'medium') score += 10;
  else if (level === 'low') score -= 5;
  return Math.max(0, Math.min(100, Math.round(score)));
}

module.exports = auditRoutes;
