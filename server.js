const fastify = require('fastify')({ logger: true });
const cors = require('@fastify/cors');

// Routes
const ordersRoutes = require('./src/routes/orders');

async function start() {
  try {
    // Enable CORS
    await fastify.register(cors, {
      origin: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type']
    });

    // Request logger (optional but helpful)
    fastify.addHook('onRequest', async (request, reply) => {
      console.log(`➡️ ${request.method} ${request.url}`);
    });

    // Health check route
    fastify.get('/', async () => {
      return { success: true, message: 'PageAudit Pro API is running 🚀' };
    });

    fastify.get('/health', async () => {
      return { ok: true };
    });

    // Register routes
    fastify.register(ordersRoutes);

    // ✅ CRITICAL FOR RENDER
    const PORT = process.env.PORT || 3001;

    await fastify.listen({
      port: PORT,
      host: '0.0.0.0'
    });

    console.log(`✅ Server running on port ${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();