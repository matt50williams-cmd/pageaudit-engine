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

    return reply.send({
      success: true,
      candidates: deduped,
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