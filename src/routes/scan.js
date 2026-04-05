const { queryOne } = require('../db');
const { runFullScan, runTeaserScan } = require('../services/scanEngine');

// Simple in-memory rate limiter for teaser scans
const rateLimitMap = new Map();
const RATE_LIMIT = 3;
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// Clean up old entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_WINDOW) rateLimitMap.delete(ip);
  }
}, 10 * 60 * 1000);

async function scanRoutes(fastify) {

  // ── TEASER SCAN (free, rate limited) ──
  fastify.post('/api/scan/teaser', async (request, reply) => {
    const ip = request.ip || request.headers['x-forwarded-for'] || 'unknown';
    if (!checkRateLimit(ip)) {
      return reply.status(429).send({ error: 'Rate limit exceeded. Maximum 3 free scans per hour.' });
    }

    const { businessName, city, state } = request.body || {};
    if (!businessName || !city) {
      return reply.status(400).send({ error: 'businessName and city are required' });
    }

    console.log(`[SCAN ROUTE] Teaser scan request: ${businessName}, ${city}, ${state || ''}`);

    try {
      const result = await runTeaserScan({ businessName, city, state: state || '' });
      if (result.error) return reply.status(500).send({ error: result.error });
      return reply.send(result);
    } catch (err) {
      console.error('[SCAN ROUTE] Teaser scan error:', err.message);
      return reply.status(500).send({ error: 'Scan failed. Please try again.' });
    }
  });

  // ── FULL SCAN (requires paid audit) ──
  fastify.post('/api/scan/full', async (request, reply) => {
    const { businessName, city, state, website, facebookUrl, auditId } = request.body || {};

    if (!businessName || !city) {
      return reply.status(400).send({ error: 'businessName and city are required' });
    }
    if (!auditId) {
      return reply.status(400).send({ error: 'auditId is required for full scan' });
    }

    // Verify payment
    const audit = await queryOne('SELECT id, paid, status FROM audits WHERE id = $1', [auditId]);
    if (!audit) return reply.status(404).send({ error: 'Audit not found' });
    if (!audit.paid) return reply.status(402).send({ error: 'Payment required for full scan' });

    console.log(`[SCAN ROUTE] Full scan request: ${businessName}, ${city}, ${state || ''} (audit ${auditId})`);

    // Update audit status
    await queryOne('UPDATE audits SET status = $1, updated_at = NOW() WHERE id = $2', ['analyzing', auditId]);

    try {
      const result = await runFullScan({ businessName, city, state: state || '', website, facebookUrl });

      if (result.error) {
        await queryOne('UPDATE audits SET status = $1, updated_at = NOW() WHERE id = $2', ['failed', auditId]);
        return reply.status(500).send({ error: result.error });
      }

      // Store scan result in database
      try {
        await queryOne(
          `INSERT INTO scan_results (audit_id, business_name, city, state, overall_score, google_score, website_score, yelp_score, nap_score, facebook_score, raw_data, ai_insights, confidence, scanned_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            auditId, businessName, city, state || '',
            result.overallScore,
            result.platforms.google?.score || null,
            result.platforms.website?.score || null,
            result.platforms.yelp?.score || null,
            result.platforms.nap?.score || null,
            result.platforms.facebook?.score || null,
            JSON.stringify(result),
            JSON.stringify({ summary: result.summary, topPriorities: result.topPriorities, industryContext: result.industryContext, monthlyGoal: result.monthlyGoal }),
            result.confidence,
            result.scannedAt,
          ]
        );

        // Store individual findings
        for (const finding of result.allFindings) {
          await queryOne(
            'INSERT INTO scan_findings (scan_result_id, platform, severity, title, description, impact, fix) VALUES ((SELECT id FROM scan_results WHERE audit_id = $1 ORDER BY id DESC LIMIT 1), $2, $3, $4, $5, $6, $7)',
            [auditId, finding.platform, finding.severity, finding.title, finding.description, finding.impact || '', finding.fix || '']
          ).catch(err => console.error('[SCAN] Finding insert failed:', err.message));
        }
      } catch (err) {
        console.error('[SCAN ROUTE] DB store failed:', err.message);
        // Don't fail the response — the scan data is still returned
      }

      // Update audit with scan score
      await queryOne(
        'UPDATE audits SET overall_score = $1, status = $2, updated_at = NOW() WHERE id = $3',
        [result.overallScore, 'completed', auditId]
      );

      return reply.send(result);
    } catch (err) {
      console.error('[SCAN ROUTE] Full scan error:', err.message);
      await queryOne('UPDATE audits SET status = $1, updated_at = NOW() WHERE id = $2', ['failed', auditId]).catch(() => null);
      return reply.status(500).send({ error: 'Scan failed. Please try again.' });
    }
  });

  // ── SCAN STATUS ──
  fastify.get('/api/scan/status/:auditId', async (request, reply) => {
    const auditId = parseInt(request.params.auditId);
    const audit = await queryOne('SELECT id, status, overall_score FROM audits WHERE id = $1', [auditId]);
    if (!audit) return reply.status(404).send({ error: 'Audit not found' });

    const scanResult = await queryOne('SELECT id, overall_score, confidence, scanned_at FROM scan_results WHERE audit_id = $1 ORDER BY id DESC LIMIT 1', [auditId]);

    return reply.send({
      auditId,
      status: audit.status,
      overallScore: scanResult?.overall_score || audit.overall_score || null,
      confidence: scanResult?.confidence || null,
      scannedAt: scanResult?.scanned_at || null,
      complete: audit.status === 'completed',
    });
  });

  // ── GET SCAN RESULT ──
  fastify.get('/api/scan/result/:auditId', async (request, reply) => {
    const auditId = parseInt(request.params.auditId);
    const scanResult = await queryOne('SELECT raw_data FROM scan_results WHERE audit_id = $1 ORDER BY id DESC LIMIT 1', [auditId]);
    if (!scanResult) return reply.status(404).send({ error: 'No scan result found' });
    return reply.send(JSON.parse(scanResult.raw_data));
  });
}

module.exports = scanRoutes;
