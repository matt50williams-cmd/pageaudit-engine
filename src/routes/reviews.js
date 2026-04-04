const { queryOne, queryAll } = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');

async function reviewRoutes(fastify) {
  // Submit a review (public — no auth required, uses email from body)
  fastify.post('/api/reviews', async (request, reply) => {
    console.log('[REVIEWS] POST /api/reviews body:', JSON.stringify(request.body));
    const { audit_id, email, customer_name, business_name, rating, feedback } = request.body || {};

    const parsedAuditId = parseInt(audit_id);
    if (!parsedAuditId || isNaN(parsedAuditId) || !email || !rating) {
      console.log('[REVIEWS] Validation failed:', { audit_id, parsedAuditId, email: !!email, rating });
      return reply.status(400).send({ error: 'audit_id, email, and rating are required' });
    }
    const parsedRating = parseInt(rating);
    if (parsedRating < 1 || parsedRating > 5 || isNaN(parsedRating)) {
      return reply.status(400).send({ error: 'rating must be an integer between 1 and 5' });
    }

    try {
      // Check if this email already reviewed this audit
      const existing = await queryOne(
        'SELECT id FROM reviews WHERE audit_id = $1 AND email = $2',
        [parsedAuditId, email.toLowerCase().trim()]
      );
      if (existing) {
        const updated = await queryOne(
          'UPDATE reviews SET rating = $1, feedback = $2, customer_name = $3, business_name = $4 WHERE id = $5 RETURNING *',
          [parsedRating, feedback || null, customer_name || null, business_name || null, existing.id]
        );
        console.log('[REVIEWS] Updated existing review:', updated?.id);
        return reply.send({ success: true, review: updated, updated: true });
      }

      const review = await queryOne(
        'INSERT INTO reviews (audit_id, email, customer_name, business_name, rating, feedback) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [parsedAuditId, email.toLowerCase().trim(), customer_name || null, business_name || null, parsedRating, feedback || null]
      );
      console.log('[REVIEWS] Created new review:', review?.id);
      return reply.send({ success: true, review });
    } catch (err) {
      console.error('[REVIEWS] DB error:', err.message);
      return reply.status(500).send({ error: 'Failed to save review. Please try again.' });
    }
  });

  // Get review for a specific audit (public — by audit_id and email)
  fastify.get('/api/reviews/:audit_id', async (request, reply) => {
    const auditId = parseInt(request.params.audit_id);
    const email = request.query.email;

    if (!email) {
      return reply.status(400).send({ error: 'email query param is required' });
    }

    const review = await queryOne(
      'SELECT * FROM reviews WHERE audit_id = $1 AND email = $2',
      [auditId, email.toLowerCase().trim()]
    );

    return reply.send({ review: review || null });
  });

  // Get all reviews for the logged-in user
  fastify.get('/api/reviews', { preHandler: requireAuth }, async (request, reply) => {
    const reviews = await queryAll(
      'SELECT * FROM reviews WHERE email = $1 ORDER BY created_at DESC',
      [request.user.email]
    );
    return reply.send(reviews);
  });

  // Admin: get all reviews with stats
  fastify.get('/api/admin/reviews', { preHandler: requireAuth }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      return reply.status(403).send({ error: 'Admin access required' });
    }

    const reviews = await queryAll(
      'SELECT r.*, a.facebook_url, a.overall_score FROM reviews r LEFT JOIN audits a ON r.audit_id = a.id ORDER BY r.created_at DESC LIMIT 200'
    );

    const stats = await queryOne(`
      SELECT
        COUNT(*) as total_reviews,
        ROUND(AVG(rating), 1) as avg_rating,
        COUNT(*) FILTER (WHERE rating = 5) as five_star,
        COUNT(*) FILTER (WHERE rating = 4) as four_star,
        COUNT(*) FILTER (WHERE rating = 3) as three_star,
        COUNT(*) FILTER (WHERE rating = 2) as two_star,
        COUNT(*) FILTER (WHERE rating = 1) as one_star,
        COUNT(*) FILTER (WHERE feedback IS NOT NULL AND feedback != '') as with_feedback
      FROM reviews
    `);

    return reply.send({
      reviews,
      stats: {
        total_reviews: parseInt(stats.total_reviews),
        avg_rating: parseFloat(stats.avg_rating) || 0,
        distribution: {
          5: parseInt(stats.five_star),
          4: parseInt(stats.four_star),
          3: parseInt(stats.three_star),
          2: parseInt(stats.two_star),
          1: parseInt(stats.one_star),
        },
        with_feedback: parseInt(stats.with_feedback),
      },
    });
  });
}

module.exports = reviewRoutes;
