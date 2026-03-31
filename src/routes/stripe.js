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

async function stripeRoutes(fastify) {
  fastify.post("/api/stripe/checkout", async (request, reply) => {
    try {
      const { audit_id, email, customer_name } = request.body || {};

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
        metadata: {
          audit_id: String(audit_id),
          customer_name: customer_name || "",
          product: "one_time_audit",
        },
        payment_intent_data: {
          metadata: {
            audit_id: String(audit_id),
            customer_name: customer_name || "",
            product: "one_time_audit",
          },
        },
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: "Facebook Page Audit — Full Report",
                description: "Custom PageAudit Pro report and action plan",
              },
              unit_amount: 3999,
            },
            quantity: 1,
          },
        ],
        success_url: `${frontendUrl}/create-account?session_id={CHECKOUT_SESSION_ID}&audit_id=${audit_id}`,
        cancel_url: `${frontendUrl}/audit-preview?cancelled=true`,
      });

      await queryOne(
        `
        UPDATE audits
        SET stripe_session_id = $1, updated_at = NOW()
        WHERE id = $2
        `,
        [session.id, audit_id]
      );

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
    const sig = request.headers["stripe-signature"];
    let event;

    try {
      if (!process.env.STRIPE_WEBHOOK_SECRET) {
        return reply.status(500).send({ error: "STRIPE_WEBHOOK_SECRET is not configured" });
      }

      const rawBody = request.rawBody || request.body;

      event = stripe.webhooks.constructEvent(
        typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody),
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      request.log.error(err, "Stripe webhook signature invalid");
      return reply.status(400).send({ error: "Webhook signature invalid" });
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const auditId = session.metadata?.audit_id;
        const product = session.metadata?.product;
        const amountPaid = typeof session.amount_total === "number" ? session.amount_total / 100 : null;

        if ((product === "one_time_audit" || product === "seo_audit") && auditId) {
          await queryOne(
            `
            UPDATE audits
            SET paid = TRUE,
                amount_paid = $1,
                updated_at = NOW()
            WHERE id = $2
            `,
            [amountPaid, auditId]
          );

          await queryOne(
            `
            INSERT INTO funnel_events (event_type, email, report_id, metadata)
            VALUES ($1, $2, $3, $4)
            `,
            [
              "payment_success",
              session.customer_email,
              auditId,
              JSON.stringify({
                amount: amountPaid,
                stripe_session_id: session.id,
                payment_status: session.payment_status,
              }),
            ]
          ).catch(() => null);

          if (product === "seo_audit") {
            const audit = await queryOne("SELECT website, email FROM audits WHERE id = $1", [auditId]);
            if (audit?.website) {
              runSeoReport(audit.website, audit.email, auditId).catch((err) =>
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

      return reply.send({ received: true });
    } catch (err) {
      request.log.error(err, "Stripe webhook processing error");
      return reply.status(500).send({ error: "Webhook processing failed" });
    }
  });

  fastify.get("/api/stripe/verify/:session_id", async (request, reply) => {
    try {
      const session = await stripe.checkout.sessions.retrieve(request.params.session_id);

      return reply.send({
        paid: session.payment_status === "paid",
        email: session.customer_email,
        audit_id: session.metadata?.audit_id || null,
        product: session.metadata?.product || null,
      });
    } catch (err) {
      request.log.error(err, "Stripe verify error");
      return reply.status(400).send({ error: "Invalid session" });
    }
  });
}

module.exports = stripeRoutes;