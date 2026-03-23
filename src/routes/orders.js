const db = require('../db');
const { analyzePage } = require('../services/analyzer');

async function routes(fastify, options) {
  console.log('🔥 orders route loaded');

  fastify.post('/orders', async (request, reply) => {
    console.log('🔥 POST /orders hit', request.body);

    try {
      const {
        name,
        email,
        pageUrl,
        reviewType,
        goals,
        postingFrequency,
        contentType,
        struggles,
        extraNotes
      } = request.body;

      if (!name || !email || !pageUrl || !reviewType) {
        return reply.status(400).send({
          success: false,
          error: 'name, email, pageUrl, and reviewType are required'
        });
      }

      const createdAt = new Date().toISOString();

      const insertOrder = db.prepare(`
        INSERT INTO orders (
          name,
          email,
          pageUrl,
          reviewType,
          goals,
          postingFrequency,
          contentType,
          struggles,
          extraNotes,
          createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = insertOrder.run(
        name,
        email,
        pageUrl,
        reviewType,
        goals || '',
        postingFrequency || '',
        contentType || '',
        struggles || '',
        extraNotes || '',
        createdAt
      );

      const orderId = result.lastInsertRowid;

      const order = db
        .prepare('SELECT * FROM orders WHERE id = ?')
        .get(orderId);

      let report = null;

      try {
        report = await analyzePage({
          name: order.name,
          email: order.email,
          pageUrl: order.pageUrl,
          reviewType: order.reviewType,
          goals: order.goals,
          postingFrequency: order.postingFrequency,
          contentType: order.contentType,
          struggles: order.struggles,
          extraNotes: order.extraNotes
        });
      } catch (aiError) {
        fastify.log.error(aiError);
      }

      return reply.send({
        success: true,
        message: 'Order saved successfully',
        order,
        report
      });

    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to save order'
      });
    }
  });
}

module.exports = routes;