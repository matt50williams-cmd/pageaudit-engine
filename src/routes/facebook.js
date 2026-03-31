const http = require('http');
const https = require('https');

function fetchViaProxy(targetUrl, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const BRIGHT_USER = process.env.BRIGHTDATA_USERNAME;
    const BRIGHT_PASS = process.env.BRIGHTDATA_PASSWORD;
    const BRIGHT_HOST = process.env.BRIGHTDATA_HOST || 'brd.superproxy.io';
    const BRIGHT_PORT = parseInt(process.env.BRIGHTDATA_PORT || '22225');

    if (!BRIGHT_USER || !BRIGHT_PASS) {
      return reject(new Error('Missing BrightData proxy credentials'));
    }

    const target = new URL(targetUrl);
    const proxyUser = BRIGHT_USER.includes('-country-') ? BRIGHT_USER : `${BRIGHT_USER}-country-us`;
    const auth = Buffer.from(`${proxyUser}:${BRIGHT_PASS}`).toString('base64');

    const connectReq = http.request({
      host: BRIGHT_HOST,
      port: BRIGHT_PORT,
      method: 'CONNECT',
      path: `${target.hostname}:443`,
      headers: { 'Proxy-Authorization': `Basic ${auth}` },
      timeout,
    });

    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return reject(new Error(`Proxy CONNECT failed: ${res.statusCode}`));
      }

      const req = https.request({
        hostname: target.hostname,
        path: target.pathname + target.search,
        method: 'GET',
        socket,
        agent: false,
        rejectUnauthorized: false,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      }, (response) => {
        let data = '';
        response.on('data', chunk => { data += chunk; });
        response.on('end', () => resolve({ ok: response.statusCode < 400, html: data }));
      });
      req.on('error', reject);
      req.end();
    });

    connectReq.on('error', reject);
    connectReq.on('timeout', () => { connectReq.destroy(); reject(new Error('Proxy timeout')); });
    connectReq.end();
  });
}

function extractPageMeta(html) {
  const getMeta = (prop) => {
    const m = html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)`, 'i'))
      || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, 'i'));
    return m ? m[1].replace(/&amp;/g, '&') : null;
  };

  const name = getMeta('og:title');
  const image = getMeta('og:image');
  const description = getMeta('og:description');

  let followers = null;
  const followerMatch = html.match(/([\d,\.]+[KkMm]?)\s*(?:followers|people follow this|people like this)/i);
  if (followerMatch) followers = followerMatch[1];

  return { name, image, description, followers };
}

async function enrichCandidate(url) {
  const result = { url, name: null, image: null, description: null, followers: null };
  try {
    const res = await fetchViaProxy(url, 12000);
    if (res.ok) {
      const meta = extractPageMeta(res.html);
      result.name = meta.name;
      result.image = meta.image;
      result.description = meta.description;
      result.followers = meta.followers;
    }
  } catch (err) {
    console.error(`Enrich failed for ${url}:`, err.message);
  }
  return result;
}

async function enrichCandidates(urls) {
  const hasCreds = process.env.BRIGHTDATA_USERNAME && process.env.BRIGHTDATA_PASSWORD;
  if (!hasCreds || !urls.length) {
    return urls.map(url => ({ url, name: null, image: null, description: null, followers: null }));
  }
  return Promise.all(urls.map(enrichCandidate));
}

async function facebookRoutes(fastify) {
  fastify.post('/api/find-facebook-page', async (request, reply) => {
    const { business_name, city, website_url } = request.body || {};

    if (!business_name) {
      return reply.status(400).send({ error: 'business_name is required' });
    }

    let candidates = [];

    // STEP 1: Gemini Google Search
    if (process.env.GEMINI_API_KEY) {
      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [{
                  text: `Find the official Facebook BUSINESS PAGE URL for "${business_name}"${city ? ` in ${city}` : ''}${website_url ? ` (website: ${website_url})` : ''}.
Rules:
- Only return real Facebook business page URLs
- Must be in format: https://www.facebook.com/pagename OR https://www.facebook.com/profile.php?id=NUMBER
- Do NOT return tracking URLs with tr?id= or pixel URLs
- Do NOT return facebook.com/share or facebook.com/sharer URLs
Return ONLY a JSON array like: ["url1","url2"]`
                }]
              }],
              tools: [{ google_search: {} }],
              generationConfig: { temperature: 0, maxOutputTokens: 200 }
            })
          }
        );

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          const result = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (result) {
            try {
              const cleaned = result.replace(/```json|```/g, '').trim();
              const urls = JSON.parse(cleaned);
              if (Array.isArray(urls)) candidates.push(...urls.filter(isValidFbUrl));
            } catch {
              const matches = result.match(/https?:\/\/(www\.)?facebook\.com\/[^\s"',\]]+/g);
              if (matches) candidates.push(...matches.filter(isValidFbUrl));
            }
          }
        }
      } catch (err) {
        console.error('Gemini error:', err.message);
      }
    }

    // STEP 2: Scrape business website
    if (website_url && candidates.length === 0) {
      try {
        let url = website_url;
        if (!url.startsWith('http')) url = `https://${url}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        const html = await res.text();
        const matches = html.match(/https?:\/\/(www\.)?facebook\.com\/[^\s"'<>]+/g) || [];
        for (const m of matches) {
          if (isValidFbUrl(m)) candidates.push(m);
        }
      } catch (err) {
        console.error('Scrape error:', err.message);
      }
    }

    // STEP 3: Claude Haiku fallback
    if (candidates.length === 0 && process.env.ANTHROPIC_API_KEY) {
      try {
        const haikuRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 200,
            messages: [{
              role: 'user',
              content: `Guess the most likely Facebook business page URL for:
Business: "${business_name}"${city ? `\nCity: ${city}` : ''}

Rules:
- Return ONLY a JSON array of 1-3 plausible Facebook page URLs
- Format must be https://www.facebook.com/businessname
- Do NOT include tr?id= tracking URLs
- No explanation, just the JSON array`
            }],
            system: 'You are a Facebook URL guesser. Return ONLY a valid JSON array of Facebook page URLs. No tracking URLs.'
          })
        });

        if (haikuRes.ok) {
          const haikuData = await haikuRes.json();
          const text = haikuData?.content?.[0]?.text?.trim();
          if (text) {
            try {
              const cleaned = text.replace(/```json|```/g, '').trim();
              const urls = JSON.parse(cleaned);
              if (Array.isArray(urls)) candidates.push(...urls.filter(isValidFbUrl));
            } catch {
              const matches = text.match(/https?:\/\/(www\.)?facebook\.com\/[^\s"',\]]+/g);
              if (matches) candidates.push(...matches.filter(isValidFbUrl));
            }
          }
        }
      } catch (err) {
        console.error('Haiku fallback error:', err.message);
      }
    }

    const deduped = [...new Set(candidates)].slice(0, 3);
    const enriched = await enrichCandidates(deduped);

    return reply.send({
      success: true,
      candidates: enriched,
      found: deduped.length > 0,
    });
  });
}

function isValidFbUrl(url) {
  if (!url) return false;
  if (typeof url !== 'string') return false;
  if (!url.includes('facebook.com')) return false;

  const lower = url.toLowerCase();

  // Block tracking, non-page, and utility URLs
  const blocked = [
    'tr?id=', 'tr/?id=', '/tr?',
    '/sharer', '/share', '/dialog',
    '/login', '/help', '/policies',
    '/groups', '/events', '/watch',
    '/ads', '/photos', '/videos',
    '/posts', '/reels', '/reviews',
    '/messages', '/marketplace',
    '/l.php', 'l.facebook.com',
    '/2008/', '/fbml', '/plugins',
    '/hashtag', '/stories', '/gaming',
    '/fundraisers', '/bookmarks',
    '/flx/', '/privacy', '/settings',
    '/notifications', '/feed',
  ];

  for (const block of blocked) {
    if (lower.includes(block)) return false;
  }

  // Must have something after facebook.com/
  const pagePath = url.split('facebook.com/')[1];
  if (!pagePath) return false;

  // Get the first path segment (before any / ? #)
  const slug = pagePath.split(/[/?#]/)[0];
  if (!slug || slug.length < 3) return false;

  // Allow profile.php?id=NUMBER format
  if (pagePath.startsWith('profile.php')) {
    return /profile\.php\?id=\d+/.test(pagePath);
  }

  // Reject paths that are just numbers (user IDs, not page slugs)
  if (/^\d+$/.test(slug)) return false;

  // Reject slugs that look like internal Facebook paths
  if (/^(p|pages|people|public)$/i.test(slug)) return false;

  return true;
}

module.exports = facebookRoutes;