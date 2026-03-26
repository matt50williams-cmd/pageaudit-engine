const jwt = require('jsonwebtoken');
const { queryOne } = require('../db');

function generateToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

async function requireAuth(request, reply) {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing authorization header' });
    }
    const token = authHeader.split(' ')[1];
    const payload = verifyToken(token);
    const user = await queryOne('SELECT id, email, full_name, role FROM users WHERE id = $1', [payload.id]);
    if (!user) return reply.status(401).send({ error: 'User not found' });
    request.user = user;
  } catch (err) {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }
}

async function optionalAuth(request, reply) {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      request.user = null;
      return;
    }
    const token = authHeader.split(' ')[1];
    const payload = verifyToken(token);
    const user = await queryOne('SELECT id, email, full_name, role FROM users WHERE id = $1', [payload.id]);
    request.user = user || null;
  } catch {
    request.user = null;
  }
}

module.exports = { generateToken, verifyToken, requireAuth, optionalAuth };