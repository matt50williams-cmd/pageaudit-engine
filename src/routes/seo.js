const Stripe = require("stripe");
const { queryOne } = require("../db");

if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is required");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function getFrontendUrl() {
  return (process.env.FRONTEND_URL || "").replace(/\/+$/, "");
}

async function runSeoReport(websiteUrl, email, auditId) {
  if (!process.env.ANTHROPIC_API_KEY) return;
  try {
    let html = "";
    try {
      const res = await fetch(websiteUrl, {
        headers: { "User-Agent": "Mozilla/5.0 Chrome/120 Safari/537.36" },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) html = await res.text();
    } catch (e) {
      console.error("SEO scrape failed:", e.message);
    }

    const checks = {
      hasTitle: /<title>[^<]{10,}/i.test(html),
      hasMetaDesc: /meta[^>]+name=["']description["'][^>]+content=["'][^"']{50,}/i.test(html) || /meta[^>]+content=["'][^"']{50,}["'][^>]+name=["']description["']/i.test(html),
      hasH1: /<h1[^>]*>[^<]{3,}/i.test(html),
      hasOgTags: /og:title/i.test(html),
      hasMobile: /viewport/i.test(html),
      hasSSL: websiteUrl.startsWith("https"),
      hasSchema: /application\/ld\+json/i.test(html),
      hasAltTags: /<img[^>]+alt=["'][^"']{3,}/i.test(html),
      hasCanonical: /rel=["']canonical["']/i.test(html),
      hasSitemap: /sitemap/i.test(html),
      hasRobots: /robots/i.test(html),
      hasFastLoad: html.length < 500000,
    };

    const passed = Object.values(checks).filter(Boolean).length;
    const score = Math.round((passed / Object.keys(checks).length) * 100);
    const checksText = Object.entries(checks).map(([k, v]) => `${k}: ${v ? "PASS" : "FAIL"}`).join("\n");

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4000,
        messages: [{
          role: "user",
          content: `You are an expert SEO consultant. Write a detailed actionable SEO audit report for: ${websiteUrl}

SEO Score: ${score}/100

Technical checks:
${checksText}

Write a comprehensive SEO audit report with these sections:
## Executive Summary
## Technical SEO Analysis
## On-Page SEO Review
## Mobile and Speed Assessment
## Local SEO Opportunities
## 30-Day Action Plan
## Quick Wins (fixes they can do today)

Be specific and actionable. Write for a small business owner. Use plain language. Use bullet points for action items.`,
        }],
      }),
    });

    if (!aiRes.ok) throw new Error("AI report failed");
    const aiData = await aiRes.json();
    const reportText = aiData.content?.[0]?.text || "";

    await queryOne(
      `UPDATE audits SET report_text = $1, overall_score = $2, status = 'completed', updated_at = NOW() WHERE id = $3`,
      [reportText, score, auditId]
    );
    console.log(`SEO audit ${auditId} completed with score ${score}`);
  } catch (err) {
    console.error("SEO report generation failed:", err.message);
    await queryOne(`UPDATE audits SET status = 'failed', updated_at = NOW() WHERE id = $1`, [auditId]).catch(() => {});
  }
}

async function seoRoutes(fastify) {
  fastify.post("/api/stripe/seo-checkout", async (request, reply) => {
    try {
      const { email, customer_name, website_url } = request.body || {};
      if (!email || !website_url) return reply.status(400).send({ error: "email and website_url are required" });

      const frontendUrl = getFrontendUrl();
      if (!frontendUrl) return reply.status(500).send({ error: "FRONTEND_URL not configured" });

      const audit = await queryOne(
        `INSERT INTO audits (email, customer_name, website, account_type, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING *`,
        [email.toLowerCase().trim(), customer_name || email, website_url, "SEO Audit", "pending"]
      );

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: email,
        metadata: { audit_id: String(audit.id), product: "seo_audit", website_url },
        payment_intent_data: { metadata: { audit_id: String(audit.id), product: "seo_audit" } },
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name: "Full Website SEO Audit", description: "Detailed technical SEO audit with 30-day action plan" },
            unit_amount: 2999,
          },
          quantity: 1,
        }],
        success_url: `${frontendUrl}/dashboard?seo_success=true&audit_id=${audit.id}`,
        cancel_url: `${frontendUrl}/seo-audit?cancelled=true`,
      });

      await queryOne(`UPDATE audits SET stripe_session_id = $1, updated_at = NOW() WHERE id = $2`, [session.id, audit.id]);
      return reply.send({ url: session.url });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: "Checkout failed" });
    }
  });

  fastify.post("/api/audits/:id/run-seo", async (request, reply) => {
    try {
      const auditId = parseInt(request.params.id);
      const audit = await queryOne(`SELECT * FROM audits WHERE id = $1`, [auditId]);
      if (!audit) return reply.status(404).send({ error: "Audit not found" });
      await queryOne(`UPDATE audits SET status = 'analyzing', updated_at = NOW() WHERE id = $1`, [auditId]);
      runSeoReport(audit.website, audit.email, auditId).catch(console.error);
      return reply.send({ success: true });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: "Failed to start SEO report" });
    }
  });
}

module.exports = seoRoutes;