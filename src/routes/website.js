async function websiteRoutes(fastify) {
  fastify.post('/api/website/scrape', async (request, reply) => {
    const { website_url, business_name, email, city } = request.body || {};

    if (!website_url && !business_name) {
      return reply.status(400).send({ error: 'Website URL or business name required' });
    }

    try {
      let facebookUrl = null;
      let seoData = null;

      // STEP 1 — WEBSITE SCRAPE FIRST (cheapest + best source)
      if (website_url) {
        let url = website_url.trim();
        if (!url.startsWith('http')) url = `https://${url}`;

        try {
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            signal: AbortSignal.timeout(10000)
          });

          if (response.ok) {
            const html = await response.text();

            // Try to find Facebook links directly in the site HTML
            const directMatches = [
              ...html.matchAll(/https?:\/\/(www\.)?facebook\.com\/[^\s"'<>]+/gi),
              ...html.matchAll(/https?:\/\/m\.facebook\.com\/[^\s"'<>]+/gi),
              ...html.matchAll(/https?:\/\/fb\.com\/[^\s"'<>]+/gi)
            ];

            for (const match of directMatches) {
              const cleaned = normalizeFacebookUrl(match[0]);
              if (cleaned && isUsableFacebookUrl(cleaned)) {
                facebookUrl = cleaned;
                console.log('Website found Facebook link:', facebookUrl);
                break;
              }
            }

            // Also check for escaped URLs in scripts / JSON blobs
            if (!facebookUrl) {
              const escapedMatches = [
                ...html.matchAll(/https?:\\\/\\\/(www\.)?facebook\.com\\\/[^\s"'<>]+/gi)
              ];

              for (const match of escapedMatches) {
                const unescaped = match[0]
                  .replace(/\\\//g, '/')
                  .replace(/\\\\/g, '\\');

                const cleaned = normalizeFacebookUrl(unescaped);
                if (cleaned && isUsableFacebookUrl(cleaned)) {
                  facebookUrl = cleaned;
                  console.log('Website found escaped Facebook link:', facebookUrl);
                  break;
                }
              }
            }

            // Optional Anthropic fallback on HTML only if website had no direct Facebook hit
            if (!facebookUrl && process.env.ANTHROPIC_API_KEY) {
              try {
                const truncatedHtml = html.slice(0, 12000);
                const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
                  method: 'POST',
                  headers: {
                    'x-api-key': process.env.ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json',
                  },
                  body: JSON.stringify({
                    model: 'claude-haiku-4-5-20251001',
                    max_tokens: 120,
                    messages: [{
                      role: 'user',
                      content: `Find the official Facebook business page URL in this website HTML.

Allowed outputs:
- https://www.facebook.com/BusinessName
- https://www.facebook.com/profile.php?id=NUMBER

Return ONLY the URL or NOT_FOUND.

HTML:
${truncatedHtml}`
                    }]
                  })
                });

                const claudeData = await claudeRes.json();
                const result = claudeData?.content?.[0]?.text?.trim();

                if (result && result !== 'NOT_FOUND') {
                  const cleaned = normalizeFacebookUrl(result);
                  if (cleaned && isUsableFacebookUrl(cleaned)) {
                    facebookUrl = cleaned;
                    console.log('Claude found Facebook link:', facebookUrl);
                  }
                }
              } catch (claudeErr) {
                console.error('Claude HTML fallback failed:', claudeErr.message);
              }
            }

            // Always try to get SEO score if website exists
            if (process.env.ANTHROPIC_API_KEY) {
              try {
                const truncatedHtml = html.slice(0, 15000);
                const seoRes = await fetch('https://api.anthropic.com/v1/messages', {
                  method: 'POST',
                  headers: {
                    'x-api-key': process.env.ANTHROPIC_API_KEY,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json',
                  },
                  body: JSON.stringify({
                    model: 'claude-haiku-4-5-20251001',
                    max_tokens: 500,
                    messages: [{
                      role: 'user',
                      content: `Analyze this website HTML for SEO. Return ONLY valid JSON, no other text:
{
  "overall_score": <0-100>,
  "issues": ["top issue 1", "top issue 2", "top issue 3"],
  "top_fix": "single most important fix",
  "wins": ["what they do well"]
}

HTML: ${truncatedHtml}`
                    }]
                  })
                });

                const seoData2 = await seoRes.json();
                const seoResult = seoData2?.content?.[0]?.text?.trim();

                try {
                  const cleaned = seoResult.replace(/```json|```/g, '').trim();
                  seoData = JSON.parse(cleaned);
                } catch {
                  seoData = null;
                }
              } catch (seoErr) {
                console.error('SEO score failed:', seoErr.message);
              }
            }
          }
        } catch (fetchErr) {
          console.error('Website fetch failed:', fetchErr.message);
        }
      }

      // STEP 2 — GEMINI FALLBACK ONLY IF WEBSITE DID NOT FIND IT
      if (!facebookUrl && business_name && process.env.GEMINI_API_KEY) {
        try {
          console.log('Trying Gemini fallback for:', business_name, city || '');

          const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{
                  parts: [{
                    text: `Find the official Facebook business page URL for "${business_name}"${city ? ` located in ${city}` : ''}${website_url ? ` with website ${website_url}` : ''}.

Return ONLY real Facebook page URLs.
Allowed formats:
- https://www.facebook.com/BusinessName
- https://www.facebook.com/profile.php?id=NUMBER

If more than one is found, return the best one first.
Return ONLY the URL, or return NOT_FOUND.`
                  }]
                }],
                tools: [{ google_search: {} }],
                generationConfig: {
                  temperature: 0,
                  maxOutputTokens: 120,
                }
              }),
              signal: AbortSignal.timeout(15000)
            }
          );

          if (geminiRes.ok) {
            const geminiData = await geminiRes.json();
            const result = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

            console.log('Gemini result:', result);

            if (result && result !== 'NOT_FOUND' && result.includes('facebook.com')) {
              const cleaned = normalizeFacebookUrl(result);
              if (cleaned && isUsableFacebookUrl(cleaned)) {
                facebookUrl = cleaned;
                console.log('Gemini found Facebook:', facebookUrl);
              }
            }
          }
        } catch (geminiErr) {
          console.error('Gemini fallback failed:', geminiErr.message);
        }
      }

      return reply.send({
        success: true,
        facebook_url: facebookUrl,
        seo_score: seoData,
      });

    } catch (err) {
      console.error('Website scrape error:', err);
      return reply.status(500).send({ error: 'Scrape failed' });
    }
  });
}

function normalizeFacebookUrl(url) {
  if (!url) return null;

  let cleaned = String(url)
    .trim()
    .replace(/&amp;/g, '&')
    .replace(/\\\//g, '/')
    .replace(/\/+$/, '');

  // normalize m.facebook.com or fb.com to www.facebook.com
  cleaned = cleaned.replace(/^https?:\/\/m\.facebook\.com/i, 'https://www.facebook.com');
  cleaned = cleaned.replace(/^https?:\/\/fb\.com/i, 'https://www.facebook.com');

  // handle profile.php?id=NUMBER
  const idMatch = cleaned.match(/facebook\.com\/profile\.php\?id=(\d+)/i);
  if (idMatch) {
    return `https://www.facebook.com/profile.php?id=${idMatch[1]}`;
  }

  // handle normal username urls
  const usernameMatch = cleaned.match(/facebook\.com\/([^/?#]+)/i);
  if (usernameMatch) {
    const username = usernameMatch[1].trim();
    if (!username) return null;
    return `https://www.facebook.com/${username}`;
  }

  return null;
}

function isUsableFacebookUrl(url) {
  if (!url) return false;
  if (!url.includes('facebook.com')) return false;
  if (url.includes('NOT_FOUND')) return false;

  // Accept profile.php?id=NUMBER
  if (/facebook\.com\/profile\.php\?id=\d+/i.test(url)) {
    return true;
  }

  const blocked = [
    'sharer',
    'share',
    'dialog',
    'login',
    'plugins',
    'pages',
    'groups',
    'events',
    'marketplace',
    'watch',
    'gaming',
    'ads',
    'business',
    'help',
    'policies',
    'legal',
    'photo',
    'photos',
    'video',
    'videos',
    'home',
    'about',
    'posts',
    'reels',
    'reviews',
    'mentions',
    'community',
    'questions',
    'services',
    'jobs',
    'map',
    'likes',
    'friends',
    'music',
    'movies',
    'books',
    'apps',
    'interests',
    'notifications',
    'messages',
    'search',
    'hashtag',
    'stories'
  ];

  const username = url
    .replace(/https?:\/\/(www\.)?facebook\.com\//i, '')
    .replace(/\/$/, '')
    .split('?')[0]
    .split('/')[0]
    .trim();

  if (!username) return false;
  if (blocked.includes(username.toLowerCase())) return false;
  if (username.length <= 2) return false;

  return true;
}

module.exports = websiteRoutes;

















