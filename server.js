require("dotenv").config();

const Fastify = require("fastify");
const cors = require("@fastify/cors");

const authRoutes = require("./src/routes/auth");
const auditRoutes = require("./src/routes/audits");
const stripeRoutes = require("./src/routes/stripe");
const funnelRoutes = require("./src/routes/funnel");
const proxyRoutes = require("./src/routes/proxy");
const websiteRoutes = require("./src/routes/website");

// Optional route: only load if the file exists in your project
let facebookRoutes = null;
try {
  facebookRoutes = require("./src/routes/facebook");
} catch (err) {
  facebookRoutes = null;
}

const app = Fastify({
  logger: true,
  bodyLimit: 1048576 * 2, // 2 MB
});

app.register(cors, {
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

// Needed so Stripe webhook signature verification works
app.addContentTypeParser("application/json", { parseAs: "string" }, function (req, body, done) {
  req.rawBody = body;

  try {
    done(null, body ? JSON.parse(body) : {});
  } catch (err) {
    done(err);
  }
});

app.get("/health", async () => ({
  status: "ok",
  service: "pageaudit-api",
  version: "1.2",
  timestamp: new Date().toISOString(),
}));

app.get("/", async () => ({
  status: "ok",
  message: "PageAudit API is running",
}));

async function registerRoutes() {
  app.register(authRoutes);
  app.register(auditRoutes);
  app.register(stripeRoutes);
  app.register(funnelRoutes);
  app.register(proxyRoutes);
  app.register(websiteRoutes);

  if (facebookRoutes) {
    app.register(facebookRoutes);
  }
}

async function start() {
  try {
    await registerRoutes();

    const PORT = process.env.PORT || 3001;
    await app.listen({
      port: Number(PORT),
      host: "0.0.0.0",
    });

    app.log.info(`PageAudit API running on port ${PORT}`);
  } catch (err) {
    app.log.error(err, "Server startup failed");
    process.exit(1);
  }
}

start();