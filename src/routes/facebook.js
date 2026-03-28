async function facebookRoutes(fastify) {
  fastify.post('/api/find-facebook-page', async (request, reply) => {
    const { business_name, city, website_url } = request.body || {};

    if (!business_name) {
      return reply.status(400).send({ error: 'business_name is required' });
    }

    let candidates = [];

    // STEP 1 — Gemini search
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

    // STEP 2 — scrape website
    if (website_url && candidates.length === 0) {
      try {
        let url = website_url;
        if (!url.startsWith('http')) url = `https://${url}`;

        const res = await fetch(url);
        const html = await res.text();

        const matches = html.match(/https?:\/\/(www\.)?facebook\.com\/[^\s"']+/g) || [];

        for (const m of matches) {
          if (isValidFbUrl(m)) candidates.push(m);
        }
      } catch (err) {
        console.error('Scrape error:', err.message);
      }
    }

    candidates = [...new Set(candidates)].slice(0, 5);

    return reply.send({
      success: true,
      candidates,
      found: candidates.length > 0
    });
  });
}

function isValidFbUrl(url) {
  if (!url) return false;
  if (!url.includes('facebook.com')) return false;
  return true;
}

module.exports = facebookRoutes;