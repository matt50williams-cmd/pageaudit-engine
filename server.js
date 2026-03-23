const fastify = require('fastify')({ logger: true });
const cors = require('@fastify/cors');

const ordersRoutes = require('./src/routes/orders');

async function start() {
  try {
    await fastify.register(cors, {
      origin: true
    });

    fastify.get('/', async () => {
      return { success: true, message: 'PageAudit Pro API is running' };
    });

    fastify.get('/health', async () => {
      return { ok: true };
    });

    fastify.register(ordersRoutes);

    await fastify.listen({ port: 3001, host: '0.0.0.0' });

    console.log('✅ Server running on http://localhost:3001');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();