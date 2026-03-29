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
                  text: `Find the Facebook business page for "${business_name}"${city ? ` in ${city}` : ''}${website_url ? ` (website: ${website_url})` : ''}.
Return up to 3 real Facebook page URLs.
Return ONLY a JSON array like: ["url1","url2"]`
                }]
              }],
              tools: [{ google_search: {} }],
              generationConfig: {
                temperature: 0,
                maxOutputTokens: 200,
              }
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
              if (Array.isArray(urls)) {
                candidates.push(...urls.filter(isValidFbUrl));
              }
            } catch {
              const matches = result.match(/https?:\/\/(www\.)?facebook\.com\/[^\s"',\]]+/g);
              if (matches) {
                candidates.push(...matches.filter(isValidFbUrl));
              }
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
              content: `Guess the most likely Facebook page URL for this business:
Business name: "${business_name}"${city ? `\nCity: ${city}` : ''}${website_url ? `\nWebsite: ${website_url}` : ''}

Rules:
- Return ONLY a JSON array of 1-3 plausible Facebook URLs
- Use common patterns like facebook.com/businessname or facebook.com/businessnamecity
- Only include facebook.com URLs
- No explanation, just the JSON array

Example: ["https://www.facebook.com/allredheating","https://www.facebook.com/allredheatingeverett"]`
            }],
            system: 'You are a Facebook URL guesser. Return ONLY a valid JSON array of Facebook URLs. No other text.'
          })
        });

        if (haikuRes.ok) {
          const haikuData = await haikuRes.json();
          const text = haikuData?.content?.[0]?.text?.trim();
          if (text) {
            try {
              const cleaned = text.replace(/```json|```/g, '').trim();
              const urls = JSON.parse(cleaned);
              if (Array.isArray(urls)) {
                candidates.push(...urls.filter(isValidFbUrl).map(u => ({ url: u, isGuess: true })));
              }
            } catch {
              const matches = text.match(/https?:\/\/(www\.)?facebook\.com\/[^\s"',\]]+/g);
              if (matches) {
                candidates.push(...matches.filter(isValidFbUrl).map(u => ({ url: u, isGuess: true })));
              }
            }
          }
        }
      } catch (err) {
        console.error('Haiku fallback error:', err.message);
      }
    }

    const normalized = candidates.map(c => {
      if (typeof c === 'string') return { url: c, isGuess: false };
      return c;
    });

    const deduped = [];
    const seen = new Set();
    for (const item of normalized) {
      if (!seen.has(item.url)) {
        seen.add(item.url);
        deduped.push(item);
      }
    }

    const final = deduped.slice(0, 5);

    return reply.send({
      success: true,
      candidates: final.map(c => c.url),
      candidatesWithMeta: final,
      found: final.length > 0,
      hasGuesses: final.some(c => c.isGuess),
    });
  });
}

function isValidFbUrl(url) {
  if (!url) return false;
  if (typeof url !== 'string') return false;
  if (!url.includes('facebook.com')) return false;
  const lower = url.toLowerCase();
  if (lower.includes('facebook.com/sharer')) return false;
  if (lower.includes('facebook.com/share')) return false;
  if (lower.includes('facebook.com/login')) return false;
  if (lower.includes('facebook.com/help')) return false;
  if (lower.includes('facebook.com/policies')) return false;
  return true;
}

module.exports = facebookRoutes;