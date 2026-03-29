async function websiteRoutes(fastify) {
  fastify.post('/api/website/scrape', async (request, reply) => {
    const { website_url, business_name, email, city } = request.body || {};

    if (!website_url && !business_name) {
      return reply.status(400).send({ error: 'Website URL or business name required' });
    }

    try {
      let facebookUrl = null;
      let seoData = null;
      let logoUrl = null;
      let detectedCity = null;

      if (website_url) {
        let url = website_url.trim();
        if (!url.startsWith('http')) url = `https://${url}`;

        try {
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 Chrome/120 Safari/537.36'
            },
            signal: AbortSignal.timeout(8000)
          });

          if (response.ok) {
            const html = await response.text();

            // ---------- FACEBOOK DETECTION ----------
            const matches = [
              ...html.matchAll(/https?:\/\/(www\.)?facebook\.com\/[^\s"'<>]+/gi),
              ...html.matchAll(/https?:\/\/m\.facebook\.com\/[^\s"'<>]+/gi),
              ...html.matchAll(/https?:\/\/fb\.com\/[^\s"'<>]+/gi)
            ];

            const cleanedUrls = matches
              .map(m => normalizeFacebookUrl(m[0]))
              .filter(u => isUsableFacebookUrl(u));

            if (cleanedUrls.length) {
              facebookUrl = cleanedUrls[0];
            }

            // ---------- LOGO ----------
            logoUrl = extractLogoUrl(html, url);

            // ---------- CITY ----------
            detectedCity = extractCity(html);

            // ---------- SEO SCORE (NON-BLOCKING) ----------
            if (process.env.ANTHROPIC_API_KEY) {
              runSeoAnalysis(html).then(result => {
                // async store if needed later
              }).catch(() => {});
            }
          }

        } catch (err) {
          console.log('Website fetch failed:', err.message);
        }
      }

      // ---------- GEMINI FALLBACK ----------
      if (!facebookUrl && business_name && process.env.GEMINI_API_KEY) {
        try {
          const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{
                  parts: [{
                    text: `Find the official Facebook business page URL for "${business_name}"${city ? ` in ${city}` : ''}.
Return ONLY the best Facebook page URL or NOT_FOUND.`
                  }]
                }],
                tools: [{ google_search: {} }],
                generationConfig: { temperature: 0 }
              }),
              signal: AbortSignal.timeout(10000)
            }
          );

          if (geminiRes.ok) {
            const data = await geminiRes.json();
            const result = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

            if (result && result !== 'NOT_FOUND') {
              const cleaned = normalizeFacebookUrl(result);
              if (isUsableFacebookUrl(cleaned)) {
                facebookUrl = cleaned;
              }
            }
          }
        } catch (err) {
          console.log('Gemini fallback failed:', err.message);
        }
      }

      return reply.send({
        success: true,
        facebook_url: facebookUrl,
        logo_url: logoUrl,
        city: detectedCity,
        seo_score: null // fast response — frontend still works
      });

    } catch (err) {
      console.error('Website scrape error:', err);
      return reply.status(500).send({ error: 'Scrape failed' });
    }
  });
}

// ---------- SEO (ASYNC SAFE) ----------
async function runSeoAnalysis(html) {
  try {
    const truncated = html.slice(0, 10000);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Analyze SEO. Return JSON only:
{"overall_score":0-100,"top_fix":"main fix"}

HTML: ${truncated}`
        }]
      })
    });

    const data = await res.json();
    const text = data?.content?.[0]?.text || "";

    return JSON.parse(text.replace(/```/g, ''));
  } catch {
    return null;
  }
}

// ---------- HELPERS ----------
function normalizeFacebookUrl(url) {
  if (!url) return null;

  let cleaned = url
    .replace(/&amp;/g, '&')
    .replace(/\\\//g, '/')
    .replace(/\/+$/, '');

  cleaned = cleaned.replace(/^https?:\/\/m\.facebook\.com/i, 'https://www.facebook.com');
  cleaned = cleaned.replace(/^https?:\/\/fb\.com/i, 'https://www.facebook.com');

  const idMatch = cleaned.match(/profile\.php\?id=(\d+)/);
  if (idMatch) return `https://www.facebook.com/profile.php?id=${idMatch[1]}`;

  const username = cleaned.split('facebook.com/')[1]?.split(/[/?#]/)[0];
  if (!username) return null;

  return `https://www.facebook.com/${username}`;
}

function isUsableFacebookUrl(url) {
  if (!url || !url.includes('facebook.com')) return false;

  const blocked = [
    'share','login','groups','events','watch','ads','help','policies',
    'photos','videos','posts','reels','reviews','messages'
  ];

  const username = url.split('facebook.com/')[1]?.split(/[/?#]/)[0];

  if (!username || username.length < 3) return false;
  if (blocked.includes(username.toLowerCase())) return false;

  return true;
}

function extractLogoUrl(html, base) {
  const match = html.match(/og:image.*content=["']([^"']+)/i);
  return match ? new URL(match[1], base).toString() : null;
}

function extractCity(html) {
  const match = html.match(/\b([A-Z][a-z]+,\s?[A-Z]{2})\b/);
  return match ? match[1] : null;
}

module.exports = websiteRoutes;


