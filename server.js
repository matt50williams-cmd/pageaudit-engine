require('dotenv').config();
const Fastify = require('fastify');
const cors = require('@fastify/cors');
const authRoutes = require('./src/routes/auth');
const auditRoutes = require('./src/routes/audits');
const stripeRoutes = require('./src/routes/stripe');
const funnelRoutes = require('./src/routes/funnel');
const proxyRoutes = require('./src/routes/proxy');
const websiteRoutes = require('./src/routes/website');

const app = Fastify({ logger: true });

app.register(cors, {
  origin: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
});

app.addContentTypeParser('application/json', { parseAs: 'string' }, function (req, body, done) {
  req.rawBody = body;
  try {
    done(null, body ? JSON.parse(body) : {});
  } catch (err) {
    done(err);
  }
});

app.get('/health', async () => ({ status: 'ok', version: '1.1', timestamp: new Date().toISOString() }));

app.register(authRoutes);
app.register(auditRoutes);
app.register(stripeRoutes);
app.register(funnelRoutes);
app.register(proxyRoutes);
app.register(websiteRoutes);

const PORT = process.env.PORT || 3001;
app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) { console.error(err); process.exit(1); }
  console.log('PageAudit API running on port ' + PORT);
});


