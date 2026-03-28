async function websiteRoutes(fastify) {
  fastify.post('/api/website/scrape', async (request, reply) => {
    const { website_url, business_name, email, city } = request.body || {};
    
    if (!website_url && !business_name) {
      return reply.status(400).send({ error: 'Website URL or business name required' });
    }

    try {
      let facebookUrl = null;
      let seoData = null;

      // STEP 1 — Gemini Google Search FIRST (free + most accurate)
      if (business_name && process.env.GEMINI_API_KEY) {
        try {
          console.log('Trying Gemini search for:', business_name, city || '');
          
          const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{
                  parts: [{
                    text: `Find the official Facebook business page URL for "${business_name}"${city ? ` located in ${city}` : ''}.
Return ONLY the Facebook page URL like "https://www.facebook.com/pagename".
Rules:
- Must be a real business page with a username (not a number ID)
- NOT profile.php
- NOT facebook.com/pages/...
- If you cannot find it with certainty, return "NOT_FOUND"
Return nothing else.`
                  }]
                }],
                tools: [{ google_search: {} }],
                generationConfig: {
                  temperature: 0,
                  maxOutputTokens: 100,
                }
              }),
              signal: AbortSignal.timeout(10000)
            }
          );

          if (geminiRes.ok) {
            const geminiData = await geminiRes.json();
            const result = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            console.log('Gemini result:', result);
            
            if (result && result !== 'NOT_FOUND' && result.includes('facebook.com')) {
              const username = result
                .replace(/https?:\/\/(www\.)?facebook\.com\//i, '')
                .replace(/\/$/, '')
                .split('?')[0]
                .trim();
              if (!/^\d+$/.test(username) && 
                  username.length > 4 && 
                  !username.includes('.php') &&
                  !username.includes('/')) {
                facebookUrl = `https://www.facebook.com/${username}`;
                console.log('Gemini found:', facebookUrl);
              }
            }
          }
        } catch (geminiErr) {
          console.error('Gemini search failed:', geminiErr.message);
        }
      }

      // STEP 2 — Website scrape (runs regardless to get SEO score)
      if (website_url) {
        let url = website_url.trim();
        if (!url.startsWith('http')) url = `https://${url}`;

        try {
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            signal: AbortSignal.timeout(8000)
          });

          if (response.ok) {
            const html = await response.text();

            // Only look for Facebook URL in HTML if Gemini didn't find it
            if (!facebookUrl) {
              const skip = [
                'sharer', 'share', 'dialog', 'login', 'plugins',
                'tr', 'pages', 'groups', 'events', 'marketplace', 'watch',
                'gaming', 'ads', 'business', 'help', 'policies', 'legal',
                'photo', 'photos', 'video', 'videos', 'profile', 'profile.php',
                'home', 'about', 'posts', 'reels', 'reviews', 'mentions',
                'community', 'questions', 'services', 'jobs', 'map', 'likes',
                'friends', 'music', 'movies', 'books', 'apps', 'interests',
                'notifications', 'messages', 'search', 'hashtag', 'stories'
              ];

              const found = new Set();
              const fbPattern = /https?:\/\/(www\.)?facebook\.com\/([^"'\s><,\/?#]+)/gi;
              const matches = [...html.matchAll(fbPattern)];
              
              for (const match of matches) {
                const fbUrl = match[0];
                const username = fbUrl
                  .replace(/https?:\/\/(www\.)?facebook\.com\//i, '')
                  .replace(/\/$/, '')
                  .split('?')[0]
                  .split('/')[0]
                  .split('#')[0];

                if (username &&
                    !skip.includes(username.toLowerCase()) &&
                    username.length > 4 &&
                    !username.includes('=') &&
                    !username.includes('%') &&
                    !username.includes('.php') &&
                    !/^\d+$/.test(username)) {
                  found.add(`https://www.facebook.com/${username}`);
                }
              }

              if (found.size > 0) {
                facebookUrl = Array.from(found)[0];
                console.log('HTML scrape found:', facebookUrl);
              }

              // Claude reads HTML if still not found
              if (!facebookUrl && process.env.ANTHROPIC_API_KEY) {
                try {
                  const truncatedHtml = html.slice(0, 10000);
                  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                      'x-api-key': process.env.ANTHROPIC_API_KEY,
                      'anthropic-version': '2023-06-01',
                      'content-type': 'application/json',
                    },
                    body: JSON.stringify({
                      model: 'claude-haiku-4-5-20251001',
                      max_tokens: 100,
                      messages: [{
                        role: 'user',
                        content: `Find the Facebook BUSINESS PAGE URL in this HTML. Must be like "https://www.facebook.com/BusinessName" — NOT profile.php, NOT a number-only ID. Return ONLY the URL or "NOT_FOUND".\n\n${truncatedHtml}`
                      }]
                    })
                  });
                  const claudeData = await claudeRes.json();
                  const result = claudeData?.content?.[0]?.text?.trim();
                  if (result && result !== 'NOT_FOUND' && result.includes('facebook.com')) {
                    const username = result
                      .replace(/https?:\/\/(www\.)?facebook\.com\//i, '')
                      .replace(/\/$/, '')
                      .split('?')[0];
                    if (!/^\d+$/.test(username) && username.length > 4 && !username.includes('.php')) {
                      facebookUrl = result;
                      console.log('Claude found:', facebookUrl);
                    }
                  }
                } catch (claudeErr) {
                  console.error('Claude fallback failed:', claudeErr.message);
                }
              }
            }

            // Always get SEO score if website provided
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

module.exports = websiteRoutes;


















