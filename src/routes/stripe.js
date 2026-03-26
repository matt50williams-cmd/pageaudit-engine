const Stripe = require('stripe');
const { queryOne } = require('../db');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function stripeRoutes(fastify) {
  fastify.post('/api/stripe/checkout', async (request, reply) => {
    const { audit_id, email, customer_name } = request.body || {};
    if (!audit_id || !email) return reply.status(400).send({ error: 'audit_id and email are required' });
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      metadata: { audit_id: String(audit_id), customer_name: customer_name||'', product: 'one_time_audit' },
      line_items: [{ price_data: { currency: 'usd', product_data: { name: 'Facebook Page Audit — Full Report' }, unit_amount: 3999 }, quantity: 1 }],
      success_url: process.env.FRONTEND_URL+'/?paid=true&session_id={CHECKOUT_SESSION_ID}&audit_id='+audit_id,
      cancel_url: process.env.FRONTEND_URL+'/audit-preview?cancelled=true',
    });
    await queryOne('UPDATE audits SET stripe_session_id = $1, updated_at = NOW() WHERE id = $2', [session.id, audit_id]);
    return reply.send({ url: session.url, session_id: session.id });
  });

  fastify.post('/api/stripe/subscribe', async (request, reply) => {
    const { email, customer_name, audit_id } = request.body || {};
    if (!email) return reply.status(400).send({ error: 'Email is required' });
    const priceId = process.env.STRIPE_MONTHLY_PRICE_ID;
    if (!priceId) return reply.status(500).send({ error: 'Monthly price not configured' });
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      metadata: { audit_id: String(audit_id||''), product: 'monthly_growth_plan' },
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: process.env.FRONTEND_URL+'/dashboard?subscribed=true',
      cancel_url: process.env.FRONTEND_URL+'/dashboard?subscribe_cancelled=true',
    });
    return reply.send({ url: session.url, session_id: session.id });
  });

  fastify.post('/api/stripe/webhook', { config: { rawBody: true } }, async (request, reply) => {
    const sig = request.headers['stripe-signature'];
    let event;
    try {
      const rawBody = request.rawBody || request.body;
      event = stripe.webhooks.constructEvent(
        typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody),
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      return reply.status(400).send({ error: 'Webhook signature invalid' });
    }
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const auditId = session.metadata?.audit_id;
      if (session.metadata?.product === 'one_time_audit' && auditId) {
        await queryOne('UPDATE audits SET paid=TRUE, amount_paid=$1, updated_at=NOW() WHERE id=$2', [session.amount_total/100, auditId]);
        await queryOne('INSERT INTO funnel_events (event_type,email,report_id,metadata) VALUES ($1,$2,$3,$4)', ['payment_success', session.customer_email, auditId, JSON.stringify({ amount: session.amount_total/100 })]);
      }
      if (session.metadata?.product === 'monthly_growth_plan') {
        await queryOne('UPDATE users SET role=$1, updated_at=NOW() WHERE email=$2', ['subscriber', session.customer_email]);
      }
    }
    return reply.send({ received: true });
  });

  fastify.get('/api/stripe/verify/:session_id', async (request, reply) => {
    try {
      const session = await stripe.checkout.sessions.retrieve(request.params.session_id);
      return reply.send({ paid: session.payment_status==='paid', email: session.customer_email, audit_id: session.metadata?.audit_id });
    } catch (err) {
      return reply.status(400).send({ error: 'Invalid session' });
    }
  });
}

module.exports = stripeRoutes;
```