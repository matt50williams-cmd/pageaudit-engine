const { queryOne, queryAll } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { runAnalyzer } = require("../services/analyzer");
const { runWriter } = require("../services/reportWriter");

async function auditRoutes(fastify) {
  fastify.post("/api/audits", async (request, reply) => {
    try {
      const {
        customer_name,
        email,
        facebook_url,
        account_type,
        goals,
        posting_frequency,
        content_type,
        website,
        city,
        business_name,
        utm_source,
        utm_campaign,
        utm_adset,
        utm_ad,
        facebook_not_found,
      } = request.body || {};

      if (!email) {
        return reply.status(400).send({ error: "Email is required" });
      }

      const cleanEmail = email.toLowerCase().trim();
      const cleanFacebookUrl = facebook_url ? String(facebook_url).trim() : null;
      const cleanWebsite = website ? String(website).trim() : null;
      const cleanCity = city ? String(city).trim() : null;
      const cleanBusinessName = business_name ? String(business_name).trim() : null;

      const audit = await queryOne(
        `
        INSERT INTO audits (
          customer_name,
          email,
          facebook_url,
          account_type,
          goals,
          posting_frequency,
          content_type,
          website,
          city,
          business_name,
          status,
          facebook_not_found,
          utm_source,
          utm_campaign,
          utm_adset,
          utm_ad
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
        )
        RETURNING *
        `,
        [
          customer_name || null,
          cleanEmail,
          cleanFacebookUrl,
          account_type || "Business",
          goals || null,
          posting_frequency || null,
          content_type || null,
          cleanWebsite,
          cleanCity,
          cleanBusinessName,
          "pending",
          facebook_not_found || false,
          utm_source || null,
          utm_campaign || null,
          utm_adset || null,
          utm_ad || null,
        ]
      );

      await queryOne(
        `
        INSERT INTO funnel_events (event_type, email, report_id, metadata)
        VALUES ($1, $2, $3, $4)
        `,
        [
          "audit_created",
          cleanEmail,
          audit.id,
          JSON.stringify({
            facebook_url: cleanFacebookUrl,
            website: cleanWebsite,
            city: cleanCity,
            business_name: cleanBusinessName,
          }),
        ]
      ).catch(() => null);

      return reply.send({ success: true, audit });
    } catch (err) {
      request.log.error(err, "Create audit error");
      return reply.status(500).send({ error: "Failed to create audit" });
    }
  });

  fastify.post("/api/audits/:id/run", async (request, reply) => {
    const { id } = request.params;

    try {
      const audit = await queryOne("SELECT * FROM audits WHERE id = $1", [id]);

      if (!audit) {
        return reply.status(404).send({ error: "Audit not found" });
      }

      await queryOne(
        "UPDATE audits SET status = $1, updated_at = NOW() WHERE id = $2",
        ["analyzing", id]
      );

      const order = {
        name: audit.customer_name,
        email: audit.email,
        pageUrl: audit.facebook_url,
        website: audit.website,
        city: audit.city,
        businessName: audit.business_name,
        mainGoal: audit.goals,
        postingFrequency: audit.posting_frequency,
        contentType: audit.content_type,
        accountType: audit.account_type,
        facebookNotFound: audit.facebook_not_found || false,
      };

      const analyzerResult = await runAnalyzer(order);
      const writerResult = await runWriter(order, analyzerResult.analysis);
      const scoreBreakdown = calculateScores(analyzerResult.analysis);

      const updated = await queryOne(
        `
        UPDATE audits
        SET
          report_text = $1,
          analysis = $2,
          overall_score = $3,
          visibility_score = $4,
          content_score = $5,
          consistency_score = $6,
          engagement_score = $7,
          growth_score = $8,
          status = $9,
          scraper_status = $10,
          updated_at = NOW()
        WHERE id = $11
        RETURNING *
        `,
        [
          writerResult.reportText,
          JSON.stringify(analyzerResult.analysis || {}),
          scoreBreakdown.overall,
          scoreBreakdown.visibility,
          scoreBreakdown.content,
          scoreBreakdown.consistency,
          scoreBreakdown.engagement,
          scoreBreakdown.growth,
          "completed",
          analyzerResult.scraperStatus || "completed",
          id,
        ]
      );

      await queryOne(
        `
        INSERT INTO funnel_events (event_type, email, report_id, metadata)
        VALUES ($1, $2, $3, $4)
        `,
        [
          "audit_completed",
          audit.email,
          id,
          JSON.stringify({
            scraper_status: analyzerResult.scraperStatus || "completed",
            scores: scoreBreakdown,
          }),
        ]
      ).catch(() => null);

      return reply.send({
        success: true,
        audit_id: updated.id,
        report_text: writerResult.reportText,
        analysis: analyzerResult.analysis,
        scores: scoreBreakdown,
        scraper_status: analyzerResult.scraperStatus || "completed",
      });
    } catch (err) {
      await queryOne(
        "UPDATE audits SET status = $1, updated_at = NOW() WHERE id = $2",
        ["failed", id]
      ).catch(() => null);

      request.log.error(err, "Run audit error");
      return reply.status(500).send({
        error: err.message || "Audit generation failed",
      });
    }
  });

  fastify.post("/api/audits/:id/seo-score", async (request, reply) => { try { const { score } = request.body || {}; await queryOne("UPDATE audits SET seo_score = $1, updated_at = NOW() WHERE id = $2", [score, request.params.id]); return reply.send({ success: true }); } catch (err) { return reply.status(500).send({ error: "Failed" }); } }); fastify.get("/api/audits/:id", async (request, reply) => {
    try {
      const audit = await queryOne("SELECT * FROM audits WHERE id = $1", [request.params.id]);

      if (!audit) {
        return reply.status(404).send({ error: "Audit not found" });
      }

      return reply.send(audit);
    } catch (err) {
      request.log.error(err, "Get audit error");
      return reply.status(500).send({ error: "Failed to fetch audit" });
    }
  });

  fastify.get("/api/audits/:id/status", async (request, reply) => {
    try {
      const audit = await queryOne("SELECT id, paid, status FROM audits WHERE id = $1", [request.params.id]);
      if (!audit) return reply.status(404).send({ error: "Audit not found" });
      return reply.send({ id: audit.id, paid: audit.paid, status: audit.status });
    } catch (err) {
      return reply.status(500).send({ error: "Failed" });
    }
  });

  fastify.get("/api/audits", { preHandler: requireAuth }, async (request, reply) => {
    try {
      const audits = await queryAll(
        "SELECT * FROM audits WHERE email = $1 ORDER BY updated_at DESC LIMIT 50",
        [request.user.email]
      );

      return reply.send(audits);
    } catch (err) {
      request.log.error(err, "List audits error");
      return reply.status(500).send({ error: "Failed to fetch audits" });
    }
  });

  fastify.get("/api/admin/audits", { preHandler: requireAuth }, async (request, reply) => {
    try {
      if (request.user.role !== "admin") {
        return reply.status(403).send({ error: "Admin access required" });
      }

      const audits = await queryAll(
        "SELECT * FROM audits ORDER BY created_at DESC LIMIT 100"
      );

      return reply.send(audits);
    } catch (err) {
      request.log.error(err, "Admin audits error");
      return reply.status(500).send({ error: "Failed to fetch admin audits" });
    }
  });

  fastify.delete("/api/admin/audits/:id", { preHandler: requireAuth }, async (request, reply) => {
    try {
      if (request.user.role !== "admin") {
        return reply.status(403).send({ error: "Admin access required" });
      }

      const { id } = request.params;
      const audit = await queryOne("SELECT id FROM audits WHERE id = $1", [id]);

      if (!audit) {
        return reply.status(404).send({ error: "Audit not found" });
      }

      await queryOne("DELETE FROM audits WHERE id = $1", [id]);

      return reply.send({ success: true });
    } catch (err) {
      request.log.error(err, "Delete audit error");
      return reply.status(500).send({ error: "Failed to delete audit" });
    }
  });
}

function calculateScores(analysis) {
  if (!analysis) {
    return {
      overall: 50,
      visibility: 50,
      content: 50,
      consistency: 50,
      engagement: 50,
      growth: 50,
    };
  }

  let visibility = 55;
  let content = 55;
  let consistency = 50;
  let engagement = 50;
  let growth = 55;

  const level = analysis?.verified_metrics?.engagement_level;

  if (level === "high") {
    engagement = 82;
    growth = 78;
  } else if (level === "medium") {
    engagement = 66;
    growth = 64;
  } else if (level === "low") {
    engagement = 45;
    growth = 48;
  }

  if (analysis?.page_presence === "strong") visibility += 20;
  else if (analysis?.page_presence === "medium") visibility += 5;
  else if (analysis?.page_presence === "weak") visibility -= 15;

  if (analysis?.content_quality === "strong") content += 20;
  else if (analysis?.content_quality === "medium") content += 5;
  else if (analysis?.content_quality === "weak") content -= 15;

  if (analysis?.posting_consistency === "strong") consistency += 25;
  else if (analysis?.posting_consistency === "medium") consistency += 10;
  else if (analysis?.posting_consistency === "weak") consistency -= 15;

  const overall = Math.round(
    (visibility + content + consistency + engagement + growth) / 5
  );

  return {
    overall: clamp(overall),
    visibility: clamp(visibility),
    content: clamp(content),
    consistency: clamp(consistency),
    engagement: clamp(engagement),
    growth: clamp(growth),
  };
}

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

module.exports = auditRoutes;

