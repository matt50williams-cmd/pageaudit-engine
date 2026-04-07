const axios = require('axios');
const { queryOne } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { runFullScan, runLightScan } = require('../services/scanEngine');

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

  // ── IDENTIFY BUSINESS FROM WEBSITE URL ──
  fastify.post('/api/scan/identify-from-website', async (request, reply) => {
    const { websiteUrl } = request.body || {};
    if (!websiteUrl) return reply.status(400).send({ error: 'websiteUrl is required' });

    let url = websiteUrl.trim();
    if (!url.startsWith('http')) url = 'https://' + url;

    try {
      // Fetch the website HTML
      console.log(`[IDENTIFY] Fetching: ${url}`);
      const siteRes = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120 Safari/537.36' }, maxRedirects: 5 });
      const html = (siteRes.data || '').substring(0, 50000);
      const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 4000);
      const title = (html.match(/<title[^>]*>([^<]+)/i) || [])[1]?.trim() || '';

      if (!process.env.ANTHROPIC_API_KEY) {
        // Fallback: extract from title tag
        return reply.send({ success: true, businessName: title || url, city: '', state: '', primaryService: '', source: 'title_only' });
      }

      // Use Claude Haiku to extract business info
      const prompt = `Extract business information from this website content.

WEBSITE URL: ${url}
PAGE TITLE: ${title}
PAGE CONTENT:
${text}

Return ONLY a JSON object:
{"businessName":"exact business name","city":"city where business is located","state":"2-letter state code","primaryService":"what they do in 2-4 words"}

If you cannot determine a field, use empty string. Do NOT guess — only extract what the content clearly states.`;

      const aiRes = await axios.post('https://api.anthropic.com/v1/messages',
        { model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: prompt }] },
        { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 10000 }
      );
      const aiText = aiRes.data?.content?.[0]?.text || '';
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log(`[IDENTIFY] Extracted: ${parsed.businessName} | ${parsed.city}, ${parsed.state} | ${parsed.primaryService}`);
        return reply.send({ success: true, businessName: parsed.businessName || title || '', city: parsed.city || '', state: parsed.state || '', primaryService: parsed.primaryService || '', website: url, source: 'ai' });
      }

      return reply.send({ success: true, businessName: title || '', city: '', state: '', primaryService: '', website: url, source: 'fallback' });
    } catch (err) {
      console.error('[IDENTIFY] Error:', err.message);
      return reply.status(200).send({ success: false, businessName: '', city: '', state: '', primaryService: '', website: url, error: err.message });
    }
  });

  // ── TEASER SCAN (free, rate limited) ──
  fastify.post('/api/scan/teaser', async (request, reply) => {
    const ip = request.ip || request.headers['x-forwarded-for'] || 'unknown';
    if (!checkRateLimit(ip)) {
      return reply.status(429).send({ error: 'Rate limit exceeded. Maximum 3 free scans per hour.' });
    }

    const { businessName, city, state } = request.body || {};
    if (!businessName?.trim()) {
      return reply.status(400).send({ error: 'Business name is required' });
    }
    if (!city?.trim()) {
      return reply.status(400).send({ error: 'City is required' });
    }

    console.log(`[SCAN ROUTE] Teaser scan request: ${businessName}, ${city}, ${state || ''}`);

    try {
      const result = await runLightScan({ businessName, city, state: state || '' });
      if (result.error) return reply.status(500).send({ error: result.error });
      return reply.send(result);
    } catch (err) {
      console.error('[SCAN ROUTE] Teaser scan error:', err.message);
      return reply.status(500).send({ error: 'Scan failed. Please try again.' });
    }
  });

  // ── FULL SCAN (requires paid audit) ──
  fastify.post('/api/scan/full', async (request, reply) => {
    console.log('[FULL SCAN] Request received:', JSON.stringify({ auditId: request.body?.auditId, businessName: request.body?.businessName, city: request.body?.city }));
    const { businessName, city, state, website, facebookUrl, auditId, address, phone, industry, biggestChallenge, yearsInBusiness, googleProfileUrl, yelpUrl } = request.body || {};

    if (!businessName || !city) {
      console.log('[FULL SCAN] Missing businessName or city');
      return reply.status(400).send({ error: 'businessName and city are required' });
    }
    if (!auditId) {
      console.log('[FULL SCAN] Missing auditId');
      return reply.status(400).send({ error: 'auditId is required for full scan' });
    }

    // Verify payment + load verified URLs, snapshots, and plan
    let audit;
    try {
      audit = await queryOne('SELECT id, paid, status, plan, selected_competitors, verified_website_url, verified_facebook_url, verified_yelp_url, website_snapshot_url, facebook_snapshot_url, yelp_snapshot_url FROM audits WHERE id = $1', [auditId]);
    } catch (colErr) {
      // Fallback if new columns don't exist yet (migration not run)
      console.log('[FULL SCAN] Column query failed, using safe fallback:', colErr.message);
      audit = await queryOne('SELECT id, paid, status FROM audits WHERE id = $1', [auditId]);
    }
    console.log('[FULL SCAN] Audit lookup:', audit ? `id=${audit.id} paid=${audit.paid} status=${audit.status}` : 'NOT FOUND');
    if (!audit) return reply.status(404).send({ error: 'Audit not found' });
    if (!audit.paid) { console.log('[FULL SCAN] BLOCKED — audit not paid'); return reply.status(402).send({ error: 'Payment required for full scan' }); }

    console.log(`[SCAN ROUTE] Full scan request: ${businessName}, ${city}, ${state || ''} (audit ${auditId})`);

    // Update audit status
    await queryOne('UPDATE audits SET status = $1, updated_at = NOW() WHERE id = $2', ['analyzing', auditId]);

    try {
      const selectedComps = audit.selected_competitors ? (typeof audit.selected_competitors === 'string' ? JSON.parse(audit.selected_competitors) : audit.selected_competitors) : null;
      const result = await runFullScan({ businessName, city, state: state || '', website, facebookUrl, yelpUrl, industry, biggestChallenge, plan: audit.plan || 'basic', selectedCompetitors: selectedComps });

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

      // Attach verified pages + snapshots to response
      result.verifiedPages = {
        website: audit.verified_website_url ? { url: audit.verified_website_url, platform: 'Website' } : null,
        facebook: audit.verified_facebook_url ? { url: audit.verified_facebook_url, platform: 'Facebook' } : null,
        yelp: audit.verified_yelp_url ? { url: audit.verified_yelp_url, platform: 'Yelp' } : null,
      };
      result.snapshots = {
        website: audit.website_snapshot_url || null,
        facebook: audit.facebook_snapshot_url || null,
        yelp: audit.yelp_snapshot_url || null,
        trustCopy: 'These are the exact pages your customers see when they find your business online.',
      };

      // Enrich findings with snapshot references
      const platformSnapshotMap = {
        'Website': audit.website_snapshot_url ? 'website' : null,
        'Facebook': audit.facebook_snapshot_url ? 'facebook' : null,
        'Yelp': audit.yelp_snapshot_url ? 'yelp' : null,
        'Google': null, // Google has no snapshot
        'Search': null,
        'NAP': null,
        'Reviews': null,
        'Competitors': null,
      };
      for (const finding of result.allFindings) {
        const snapshotKey = platformSnapshotMap[finding.platform];
        finding.snapshotRef = snapshotKey || null;
      }

      // Presentation section for frontend
      const hasAnySnapshot = !!(audit.website_snapshot_url || audit.facebook_snapshot_url || audit.yelp_snapshot_url);
      result.presenceSection = hasAnySnapshot ? {
        title: 'Your Online Presence (Verified)',
        cards: [
          { platform: 'Website', snapshot: audit.website_snapshot_url || null, url: audit.verified_website_url || null, status: audit.verified_website_url ? 'verified' : 'not_found' },
          { platform: 'Facebook', snapshot: audit.facebook_snapshot_url || null, url: audit.verified_facebook_url || null, status: audit.verified_facebook_url ? 'verified' : 'not_found' },
          { platform: 'Yelp', snapshot: audit.yelp_snapshot_url || null, url: audit.verified_yelp_url || null, status: audit.verified_yelp_url ? 'verified' : 'not_found' },
        ],
        trustCopy: 'These are the exact pages your customers see when they find your business online.',
      } : null;

      return reply.send(result);
    } catch (err) {
      console.error('[FULL SCAN] CRASH:', err.message, err.stack);
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

  // ── COMPETITOR OPTIONS (for picker) — uses Text Search like a real customer ──
  fastify.post('/api/scan/competitor-options', async (request, reply) => {
    const { businessName, city, state } = request.body || {};
    if (!businessName || !city) return reply.status(400).send({ error: 'businessName and city required' });

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return reply.status(500).send({ error: 'Google API not configured' });

    try {
      // Step 1: Find the subject business to get place_id and types
      const findRes = await axios.get('https://maps.googleapis.com/maps/api/place/findplacefromtext/json', {
        params: { input: `${businessName} ${city} ${state || ''}`, inputtype: 'textquery', fields: 'place_id,name,types', key: apiKey },
        timeout: 8000,
      });
      const subject = findRes.data?.candidates?.[0];
      const subjectPlaceId = subject?.place_id || null;
      const rawTypes = subject?.types || [];

      // Step 2: Extract the most specific business type for the search query
      const skipTypes = ['point_of_interest', 'establishment', 'premise', 'street_address', 'political', 'locality', 'sublocality', 'neighborhood', 'route', 'geocode'];
      const usefulTypes = rawTypes.filter(t => !skipTypes.includes(t));
      const businessType = usefulTypes.length > 0 ? usefulTypes[0].replace(/_/g, ' ') : businessName.split(/\s+/).slice(0, 2).join(' ');
      console.log(`[COMPETITOR-PICKER] Subject: ${subject?.name || businessName} | Types: ${rawTypes.join(', ')} | Business type: "${businessType}"`);

      // Step 3: Text Search — search exactly like a customer would
      const allResults = new Map(); // placeId → result (dedup)
      const queries = [
        `${businessType} ${city} ${state || ''}`,
        `${businessType} near ${city} ${state || ''}`,
      ];

      for (const query of queries) {
        console.log(`[COMPETITOR-PICKER] Text search: "${query}"`);
        try {
          const r = await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json', {
            params: { query, key: apiKey },
            timeout: 8000,
          });
          const hits = r.data?.results || [];
          console.log(`[COMPETITOR-PICKER] Got ${hits.length} results for "${query}"`);
          for (const p of hits) {
            if (p.place_id !== subjectPlaceId && !allResults.has(p.place_id)) {
              allResults.set(p.place_id, p);
            }
          }
        } catch (e) {
          console.log(`[COMPETITOR-PICKER] Text search failed for "${query}": ${e.message}`);
        }
        if (allResults.size >= 10) break;
      }

      // Step 4: Format results
      const options = [...allResults.values()].slice(0, 10).map(p => ({
        placeId: p.place_id,
        name: p.name,
        address: p.formatted_address || '',
        rating: p.rating || null,
        reviewCount: p.user_ratings_total || 0,
        types: (p.types || []).filter(t => !skipTypes.includes(t)).slice(0, 3).map(t => t.replace(/_/g, ' ')),
      }));

      console.log(`[COMPETITOR-PICKER] Final: ${options.length} competitors for "${businessType}" in ${city}`);
      return reply.send({ success: true, options });
    } catch (err) {
      console.error('[COMPETITOR-PICKER] Error:', err.message);
      return reply.status(500).send({ error: 'Failed to find competitor options' });
    }
  });

  // ── SELECT COMPETITORS (save picks) ──
  fastify.post('/api/audits/:id/select-competitors', async (request, reply) => {
    const auditId = parseInt(request.params.id);
    const { selectedCompetitors } = request.body || {};

    const audit = await queryOne('SELECT id, paid FROM audits WHERE id = $1', [auditId]);
    if (!audit) return reply.status(404).send({ error: 'Audit not found' });

    // selectedCompetitors is an array of {placeId, name, address, rating, reviewCount}
    const comps = Array.isArray(selectedCompetitors) ? selectedCompetitors.slice(0, 3) : [];

    try {
      await queryOne(
        'UPDATE audits SET selected_competitors = $1, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(comps), auditId]
      );
    } catch (colErr) {
      console.log('[COMPETITOR-PICKER] selected_competitors column may not exist yet:', colErr.message);
      // Still continue — competitors will be auto-discovered during scan
    }

    console.log(`[COMPETITOR-PICKER] Saved ${comps.length} competitors for audit ${auditId}`);
    return reply.send({ success: true, count: comps.length });
  });

  // ── GET SCAN RESULT ──
  fastify.get('/api/scan/result/:auditId', async (request, reply) => {
    const auditId = parseInt(request.params.auditId);
    const scanResult = await queryOne('SELECT raw_data FROM scan_results WHERE audit_id = $1 ORDER BY id DESC LIMIT 1', [auditId]);
    if (!scanResult) return reply.status(404).send({ error: 'No scan result found' });
    return reply.send(JSON.parse(scanResult.raw_data));
  });

  // ── NEARBY BUSINESSES (for rep geo lookup) ──
  fastify.get('/api/scan/nearby', async (request, reply) => {
    const { lat, lng } = request.query;
    if (!lat || !lng) return reply.status(400).send({ error: 'lat and lng required' });
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return reply.status(500).send({ error: 'Google API not configured' });
    try {
      const res = await axios.get('https://maps.googleapis.com/maps/api/place/nearbysearch/json', {
        params: { location: `${lat},${lng}`, radius: 150, type: 'establishment', key: apiKey },
        timeout: 8000,
      });
      const skipTypes = ['transit_station', 'bus_station', 'train_station', 'atm', 'parking', 'gas_station', 'fire_station', 'police', 'post_office'];
      const places = (res.data.results || [])
        .filter(p => !p.types?.some(t => skipTypes.includes(t)))
        .slice(0, 10)
        .map(p => ({ name: p.name, address: p.vicinity, placeId: p.place_id, types: p.types, rating: p.rating || null }));
      return reply.send({ places });
    } catch (err) {
      console.error('[SCAN] Nearby search failed:', err.message);
      return reply.status(500).send({ error: 'Nearby search failed' });
    }
  });

  // ── REP PRE-SCAN (no rate limit, auth required) ──
  fastify.post('/api/scan/prescan', { preHandler: requireAuth }, async (request, reply) => {
    const { businessName, city, state } = request.body || {};
    if (!businessName) return reply.status(400).send({ error: 'businessName required' });
    try {
      const result = await runLightScan({ businessName, city: city || '', state: state || '' });
      return reply.send(result);
    } catch (err) {
      console.error('[SCAN] Pre-scan failed:', err.message);
      return reply.status(500).send({ error: 'Pre-scan failed' });
    }
  });
}

module.exports = scanRoutes;
