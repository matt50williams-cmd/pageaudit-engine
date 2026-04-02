const { queryOne, queryAll } = require('../db');
const { requireAuth } = require('../middleware/auth');

async function funnelRoutes(fastify) {
  fastify.post('/api/funnel/track', async (request, reply) => {
    const { event_type, email, report_id, facebook_url, utm_source, utm_campaign, utm_adset, utm_ad, metadata } = request.body || {};
    if (!event_type) return reply.status(400).send({ error: 'event_type is required' });
    await queryOne(
      'INSERT INTO funnel_events (event_type, email, report_id, facebook_url, utm_source, utm_campaign, utm_adset, utm_ad, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [event_type, email, report_id, facebook_url, utm_source, utm_campaign, utm_adset, utm_ad, metadata ? JSON.stringify(metadata) : null]
    );
    return reply.send({ success: true });
  });

  fastify.get('/api/admin/funnel', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: 'Admin access required' });
    const lookback = parseInt(request.query.days) || 30;
    const funnelCounts = await queryAll(`
      SELECT event_type, COUNT(*) as count FROM funnel_events
      WHERE created_at >= NOW() - INTERVAL '${lookback} days'
      GROUP BY event_type ORDER BY count DESC
    `);
    const dropoffs = await queryAll(`
      SELECT DISTINCT fe.email, fe.facebook_url, fe.utm_source, fe.utm_campaign, fe.created_at
      FROM funnel_events fe
      WHERE fe.event_type = 'intake_submitted'
        AND fe.created_at >= NOW() - INTERVAL '${lookback} days'
        AND fe.email NOT IN (
          SELECT email FROM funnel_events WHERE event_type = 'payment_success' AND email IS NOT NULL
        )
      ORDER BY fe.created_at DESC LIMIT 100
    `);
    const campaigns = await queryAll(`
      SELECT utm_source, utm_campaign,
        COUNT(*) FILTER (WHERE event_type = 'landing_viewed') as views,
        COUNT(*) FILTER (WHERE event_type = 'intake_submitted') as intakes,
        COUNT(*) FILTER (WHERE event_type = 'payment_success') as purchases
      FROM funnel_events
      WHERE created_at >= NOW() - INTERVAL '${lookback} days' AND utm_source IS NOT NULL
      GROUP BY utm_source, utm_campaign ORDER BY purchases DESC
    `);
    const stepFunnel = await queryAll(`
      SELECT event_type, COUNT(DISTINCT email) as count FROM funnel_events
      WHERE event_type IN ('intake_started','step_1_completed','step_2_completed','step_3_completed','step_4_completed','step_5_completed','step_6_completed','intake_submitted','payment_success')
        AND created_at >= NOW() - INTERVAL '${lookback} days'
      GROUP BY event_type
    `);
    const stepOrder = ['intake_started','step_1_completed','step_2_completed','step_3_completed','step_4_completed','step_5_completed','step_6_completed','intake_submitted','payment_success'];
    const stepLabels = { intake_started: 'Form Opened', step_1_completed: 'Step 1 — Name & Email', step_2_completed: 'Step 2 — Business Info', step_3_completed: 'Step 3 — Goals', step_4_completed: 'Step 4 — Post Frequency', step_5_completed: 'Step 5 — Content Type', step_6_completed: 'Step 6 — Facebook Page', intake_submitted: 'Audit Submitted', payment_success: 'Payment Completed' };
    const stepMap = {};
    stepFunnel.forEach(r => { stepMap[r.event_type] = parseInt(r.count); });
    const steps = stepOrder.map(event_type => ({ event_type, label: stepLabels[event_type], count: stepMap[event_type] || 0 }));
    return reply.send({ funnel_counts: funnelCounts, dropoffs, campaigns, steps, lookback_days: lookback });
  });

  fastify.get('/api/admin/revenue', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: 'Admin access required' });
    const lookback = parseInt(request.query.days) || 30;
    const totalRevenue = await queryOne('SELECT COALESCE(SUM(amount_paid), 0) as total, COUNT(*) as total_paid FROM audits WHERE paid = TRUE');
    const todayRevenue = await queryOne('SELECT COALESCE(SUM(amount_paid), 0) as total, COUNT(*) as count FROM audits WHERE paid = TRUE AND DATE(created_at) = CURRENT_DATE');
    const dailyRevenue = await queryAll(`
      SELECT DATE(created_at) as date, COALESCE(SUM(amount_paid), 0) as revenue, COUNT(*) as orders
      FROM audits WHERE paid = TRUE AND created_at >= NOW() - INTERVAL '${lookback} days'
      GROUP BY DATE(created_at) ORDER BY date ASC
    `);
    const userCount = await queryOne('SELECT COUNT(*) as count FROM users');
    return reply.send({
      all_time: { revenue: parseFloat(totalRevenue.total), paid_audits: parseInt(totalRevenue.total_paid) },
      today: { revenue: parseFloat(todayRevenue.total), paid_audits: parseInt(todayRevenue.count) },
      daily_revenue: dailyRevenue,
      total_users: parseInt(userCount.count),
    });
  });

  fastify.get('/api/admin/overview', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user.role !== 'admin') return reply.status(403).send({ error: 'Admin access required' });
    const today = await queryOne(`
      SELECT
        (SELECT COUNT(*) FROM funnel_events WHERE event_type = 'landing_viewed' AND DATE(created_at) = CURRENT_DATE) as views_today,
        (SELECT COUNT(*) FROM funnel_events WHERE event_type = 'intake_submitted' AND DATE(created_at) = CURRENT_DATE) as intakes_today,
        (SELECT COUNT(*) FROM audits WHERE paid = TRUE AND DATE(created_at) = CURRENT_DATE) as sales_today,
        (SELECT COALESCE(SUM(amount_paid), 0) FROM audits WHERE paid = TRUE AND DATE(created_at) = CURRENT_DATE) as revenue_today
    `);
    const allTime = await queryOne(`
      SELECT
        (SELECT COUNT(*) FROM funnel_events WHERE event_type = 'landing_viewed') as views_total,
        (SELECT COUNT(*) FROM users) as users_total,
        (SELECT COUNT(*) FROM audits WHERE paid = TRUE) as sales_total,
        (SELECT COALESCE(SUM(amount_paid), 0) FROM audits WHERE paid = TRUE) as revenue_total
    `);
    const totalSales = parseInt(allTime.sales_total) || 0;
    const conversionRate = ((totalSales / (parseInt(allTime.views_total) || 1)) * 100).toFixed(1);
    return reply.send({
      today: { views: parseInt(today.views_today), intakes: parseInt(today.intakes_today), sales: parseInt(today.sales_today), revenue: parseFloat(today.revenue_today) },
      all_time: { views: parseInt(allTime.views_total), users: parseInt(allTime.users_total), sales: totalSales, revenue: parseFloat(allTime.revenue_total), conversion_rate: parseFloat(conversionRate) },
    });
  });
}

module.exports = funnelRoutes;