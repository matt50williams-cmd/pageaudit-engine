const Stripe = require("stripe");
const { queryOne } = require("../db");
const { runSeoReport } = require("./seo");

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY is required");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function getFrontendUrl() {
  return (process.env.FRONTEND_URL || "").replace(/\/+$/, "");
}

const AUDIT_TIERS = {
  online: { amount: 3999, name: "Online Presence Audit — Full Report", consultantEarns: 0, youKeep: 3999 },
  basic: { amount: 9900, name: "Online Presence Audit — Basic", consultantEarns: 4900, youKeep: 5000 },
  standard: { amount: 12900, name: "Online Presence Audit — Standard", consultantEarns: 6400, youKeep: 6500 },
  premium: { amount: 14900, name: "Online Presence Audit — Premium", consultantEarns: 7400, youKeep: 7500 },
};

async function stripeRoutes(fastify) {
  fastify.post("/api/stripe/checkout", async (request, reply) => {
    try {
      const { audit_id, email, customer_name, rep_code, tier } = request.body || {};
      const selectedTier = AUDIT_TIERS[tier] || AUDIT_TIERS.online;

      if (!audit_id || !email) {
        return reply.status(400).send({ error: "audit_id and email are required" });
      }

      const frontendUrl = getFrontendUrl();
      if (!frontendUrl) {
        return reply.status(500).send({ error: "FRONTEND_URL is not configured" });
      }

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: email,
        allow_promotion_codes: true,
        billing_address_collection: "auto",
        client_reference_id: String(audit_id),
        metadata: {
          audit_id: String(audit_id),
          email: email,
          customer_name: customer_name || "",
          product: "one_time_audit",
          tier: tier || "online",
          rep_code: rep_code || "",
        },
        payment_intent_data: {
          metadata: {
            audit_id: String(audit_id),
            customer_name: customer_name || "",
            product: "one_time_audit",
            tier: tier || "online",
            rep_code: rep_code || "",
          },
        },
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: selectedTier.name,
                description: "Complete online presence analysis and action plan",
              },
              unit_amount: selectedTier.amount,
            },
            quantity: 1,
          },
        ],
        success_url: `${frontendUrl}/post-payment-details?session_id={CHECKOUT_SESSION_ID}&audit_id=${audit_id}`,
        cancel_url: `${frontendUrl}/audit-preview?cancelled=true`,
      });

      // Store stripe session and rep code on audit
      if (rep_code) {
        await queryOne('UPDATE audits SET stripe_session_id = $1, rep_code = $2, updated_at = NOW() WHERE id = $3', [session.id, rep_code, audit_id]);
      } else {
        await queryOne('UPDATE audits SET stripe_session_id = $1, updated_at = NOW() WHERE id = $2', [session.id, audit_id]);
      }

      await queryOne(
        `
        INSERT INTO funnel_events (event_type, email, report_id, metadata)
        VALUES ($1, $2, $3, $4)
        `,
        [
          "checkout_started",
          email,
          audit_id,
          JSON.stringify({
            stripe_session_id: session.id,
            amount: 39.99,
            product: "one_time_audit",
          }),
        ]
      ).catch(() => null);

      return reply.send({
        url: session.url,
        session_id: session.id,
      });
    } catch (err) {
      request.log.error(err, "Stripe checkout error");
      return reply.status(500).send({ error: "Unable to create checkout session" });
    }
  });

  fastify.post("/api/stripe/subscribe", async (request, reply) => {
    try {
      const { email, customer_name, audit_id } = request.body || {};

      if (!email) {
        return reply.status(400).send({ error: "Email is required" });
      }

      const priceId = process.env.STRIPE_MONTHLY_PRICE_ID;
      if (!priceId) {
        return reply.status(500).send({ error: "Monthly price not configured" });
      }

      const frontendUrl = getFrontendUrl();
      if (!frontendUrl) {
        return reply.status(500).send({ error: "FRONTEND_URL is not configured" });
      }

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer_email: email,
        allow_promotion_codes: true,
        metadata: {
          audit_id: String(audit_id || ""),
          customer_name: customer_name || "",
          product: "monthly_growth_plan",
        },
        subscription_data: {
          metadata: {
            audit_id: String(audit_id || ""),
            customer_name: customer_name || "",
            product: "monthly_growth_plan",
          },
        },
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${frontendUrl}/dashboard?subscribed=true`,
        cancel_url: `${frontendUrl}/dashboard?subscribe_cancelled=true`,
      });

      return reply.send({
        url: session.url,
        session_id: session.id,
      });
    } catch (err) {
      request.log.error(err, "Stripe subscription error");
      return reply.status(500).send({ error: "Unable to create subscription session" });
    }
  });

  fastify.post("/api/stripe/webhook", { config: { rawBody: true } }, async (request, reply) => {
    console.log('[WEBHOOK] Stripe webhook received');
    const sig = request.headers["stripe-signature"];
    let event;

    try {
      if (!process.env.STRIPE_WEBHOOK_SECRET) {
        console.error('[WEBHOOK] STRIPE_WEBHOOK_SECRET is not configured!');
        return reply.status(500).send({ error: "STRIPE_WEBHOOK_SECRET is not configured" });
      }

      // rawBody stored on raw Node request by custom content type parser in server.js
      const rawBody = request.rawBody || request.raw?.rawBody || request.body;
      const bodyString = typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody);
      console.log('[WEBHOOK] Raw body type:', typeof rawBody, '| Length:', bodyString?.length || 0, '| Sig present:', !!sig);

      event = stripe.webhooks.constructEvent(
        bodyString,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
      console.log('[WEBHOOK] Event type:', event.type);
    } catch (err) {
      console.error('[WEBHOOK] Signature verification FAILED:', err.message);
      request.log.error(err, "Stripe webhook signature invalid");
      return reply.status(400).send({ error: "Webhook signature invalid" });
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        console.log('[WEBHOOK] Session metadata:', JSON.stringify(session.metadata));
        console.log('[WEBHOOK] client_reference_id:', session.client_reference_id);
        const auditId = session.metadata?.audit_id || session.metadata?.auditId || session.client_reference_id;
        console.log('[WEBHOOK] Resolved audit_id:', auditId);
        const product = session.metadata?.product;
        const amountPaid = typeof session.amount_total === "number" ? session.amount_total / 100 : null;

        const repCode = session.metadata?.rep_code || null;

        if ((product === "one_time_audit" || product === "seo_audit") && auditId) {
          await queryOne(
            `UPDATE audits SET paid = TRUE, amount_paid = $1, rep_code = $2, updated_at = NOW() WHERE id = $3`,
            [amountPaid, repCode || null, auditId]
          );
          console.log(`[WEBHOOK] Audit ${auditId} marked paid = TRUE, amount = $${amountPaid}`);

          await queryOne(
            `INSERT INTO funnel_events (event_type, email, report_id, metadata) VALUES ($1, $2, $3, $4)`,
            ["payment_success", session.customer_email, auditId,
              JSON.stringify({ amount: amountPaid, stripe_session_id: session.id, payment_status: session.payment_status, rep_code: repCode })]
          ).catch(() => null);

          // Create rep commission if rep_code exists
          if (repCode) {
            try {
              const rep = await queryOne('SELECT id, commission_audit FROM reps WHERE rep_code = $1 AND status = $2', [repCode, 'active']);
              if (rep) {
                const audit = await queryOne('SELECT customer_name, business_name, email FROM audits WHERE id = $1', [auditId]);
                await queryOne(
                  `INSERT INTO rep_commissions (rep_id, audit_id, customer_email, customer_name, business_name, product_type, sale_amount, commission_amount, status, payment_status, buffer_release_date, buffer_status)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW() + INTERVAL '7 days', $11)`,
                  [rep.id, auditId, audit?.email || session.customer_email, audit?.customer_name || session.metadata?.customer_name || null,
                   audit?.business_name || null, product, amountPaid, (AUDIT_TIERS[session.metadata?.tier]?.consultantEarns || parseFloat(rep.commission_audit) * 100 || 6000) / 100, 'pending', 'customer_paid', 'buffering']
                );
                console.log(`[REP] Commission created for rep ${repCode}: $${rep.commission_audit} on audit ${auditId}`);

                // Create partner override if rep has a partner
                if (rep.partner_id) {
                  try {
                    const partner = await queryOne('SELECT id, override_audit FROM partner_accounts WHERE id = $1 AND status = $2', [rep.partner_id, 'active']);
                    if (partner) {
                      await queryOne(
                        `INSERT INTO partner_commissions (partner_id, rep_id, customer_email, transaction_type, plan_type, amount_charged, override_amount, buffer_start_date, buffer_release_date, buffer_status)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW() + INTERVAL '7 days', 'buffering')`,
                        [partner.id, rep.id, audit?.email || session.customer_email, product, product, amountPaid, parseFloat(partner.override_audit) || 10]
                      );
                      console.log(`[PARTNER] Override $${partner.override_audit} for partner ${partner.id} from rep ${repCode}`);
                    }
                  } catch (pe) { console.error('[PARTNER] Override creation failed:', pe.message); }
                }
              }
            } catch (err) { console.error('[REP] Commission creation failed:', err.message); }
          }

          if (product === "seo_audit") {
            const audit = await queryOne("SELECT website, email, customer_name, business_name, city FROM audits WHERE id = $1", [auditId]);
            if (audit?.website) {
              runSeoReport(audit.website, audit.email, auditId, {
                businessName: audit.business_name || audit.customer_name || audit.website,
                city: audit.city || '',
                customerName: audit.customer_name || '',
              }).catch((err) =>
                console.error("Auto SEO report failed:", err.message)
              );
            }
          }
        }

        if (product === "monthly_growth_plan") {
          await queryOne(
            `
            UPDATE users
            SET role = $1,
                updated_at = NOW()
            WHERE email = $2
            `,
            ["subscriber", session.customer_email]
          ).catch(() => null);
        }
      }

      console.log('[WEBHOOK] Processing complete for event:', event.type);
      return reply.send({ received: true });
    } catch (err) {
      request.log.error(err, "Stripe webhook processing error");
      return reply.status(500).send({ error: "Webhook processing failed" });
    }
  });

  fastify.get("/api/stripe/verify/:session_id", async (request, reply) => {
    try {
      const session = await stripe.checkout.sessions.retrieve(request.params.session_id);
      const auditId = session.metadata?.audit_id || session.metadata?.auditId || session.client_reference_id;

      // If Stripe says paid, update the audit record directly
      if (session.payment_status === "paid" && auditId) {
        await queryOne("UPDATE audits SET paid = TRUE, amount_paid = COALESCE(amount_paid, $1), updated_at = NOW() WHERE id = $2", [typeof session.amount_total === "number" ? session.amount_total / 100 : null, parseInt(auditId)]);
        console.log("[VERIFY] Marked audit", auditId, "as paid via verify endpoint");
      }

      return reply.send({
        paid: session.payment_status === "paid",
        email: session.customer_email,
        auditId: auditId || null,
        sessionId: session.id,
      });
    } catch (err) {
      request.log.error(err, "Stripe verify error");
      return reply.status(400).send({ error: "Invalid session" });
    }
  });
}

module.exports = stripeRoutes;