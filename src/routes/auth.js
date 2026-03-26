const bcrypt = require('bcryptjs');
const { queryOne } = require('../db');
const { generateToken, requireAuth } = require('../middleware/auth');

async function authRoutes(fastify) {
  fastify.post('/api/auth/signup', async (request, reply) => {
    const { email, password, full_name } = request.body || {};
    if (!email || !password) return reply.status(400).send({ error: 'Email and password are required' });
    if (password.length < 8) return reply.status(400).send({ error: 'Password must be at least 8 characters' });
    const existing = await queryOne('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (existing) return reply.status(409).send({ error: 'An account with this email already exists' });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await queryOne(
      'INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id, email, full_name, role',
      [email.toLowerCase().trim(), passwordHash, full_name || null]
    );
    const token = generateToken(user);
    return reply.send({ success: true, token, user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role } });
  });

  fastify.post('/api/auth/login', async (request, reply) => {
    const { email, password } = request.body || {};
    if (!email || !password) return reply.status(400).send({ error: 'Email and password are required' });
    const user = await queryOne(
      'SELECT id, email, full_name, role, password_hash FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    if (!user) return reply.status(401).send({ error: 'Invalid email or password' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return reply.status(401).send({ error: 'Invalid email or password' });
    const token = generateToken(user);
    return reply.send({ success: true, token, user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role } });
  });

  fastify.get('/api/auth/me', { preHandler: requireAuth }, async (request, reply) => {
    return reply.send({ id: request.user.id, email: request.user.email, full_name: request.user.full_name, role: request.user.role });
  });
}

module.exports = authRoutes;