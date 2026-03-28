async function websiteRoutes(fastify) {
  fastify.post('/api/website/scrape', async (request, reply) => {
    const { website_url, business_name, email } = request.body || {};
    
    if (!website_url && !business_name) {
      return reply.status(400).send({ error: 'Website URL or business name required' });
    }

    try {
      let facebookUrl = null;
      let seoData = null;

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

            const fbPatterns = [
              /https?:\/\/(www\.)?facebook\.com\/([^"'\s><,\/?#]+)/gi,
            ];

            const found = new Set();
            for (const pattern of fbPatterns) {
              const matches = [...html.matchAll(pattern)];
              for (const match of matches) {
                const fbUrl = match[0];
                const username = fbUrl
                  .replace(/https?:\/\/(www\.)?facebook\.com\//i, '')
                  .replace(/\/$/, '')
                  .split('?')[0]
                  .split('/')[0];

                const skip = ['sharer', 'share', 'dialog', 'login', 'plugins', 
                  'tr', 'pages', 'groups', 'events', 'marketplace', 'watch', 
                  'gaming', 'ads', 'business', 'help', 'policies', 'legal',
                  'photo', 'photos', 'video', 'videos', 'profile'];
                  
                if (username && 
                    !skip.includes(username.toLowerCase()) && 
                    username.length > 4 && 
                    !username.includes('=') &&
                    !username.includes('%') &&
                    !/^\d+$/.test(username)) {
                  found.add(`https://www.facebook.com/${username}`);
                }
              }
            }

            if (found.size > 0) {
              facebookUrl = Array.from(found)[0];
            }

            // If not found directly, ask Claude
            if (!facebookUrl && process.env.ANTHROPIC_API_KEY) {
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
                    content: `Find the Facebook page URL in this HTML. Return ONLY the full URL like "https://www.facebook.com/pagename" or "NOT_FOUND". The URL must contain a real page username, not just a number. Nothing else.\n\n${truncatedHtml}`
                  }]
                })
              });
              const claudeData = await claudeRes.json();
              const result = claudeData?.content?.[0]?.text?.trim();
              if (result && result !== 'NOT_FOUND' && result.includes('facebook.com')) {
                const username = result.replace(/https?:\/\/(www\.)?facebook\.com\//i, '').replace(/\/$/, '').split('?')[0];
                if (!/^\d+$/.test(username) && username.length > 4) {
                  facebookUrl = result;
                }
              }
            }

            // Get SEO score
            if (process.env.ANTHROPIC_API_KEY) {
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
            }
          }
        } catch (fetchErr) {
          console.error('Website fetch failed:', fetchErr.message);
        }
      }

      // BRIGHTDATA FALLBACK — if no Facebook URL found yet
      if (!facebookUrl && business_name && process.env.BRIGHTDATA_API_KEY) {
        try {
          console.log('Trying BrightData for:', business_name);
          
          const bdResponse = await fetch('https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_lkaxegm826bjpoo9m5&include_errors=true', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.BRIGHTDATA_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify([{
              url: `https://www.facebook.com/search/pages/?q=${encodeURIComponent(business_name)}`,
              num_of_posts: 1,
            }]),
            signal: AbortSignal.timeout(10000)
          });

          if (bdResponse.ok) {
            const bdData = await bdResponse.json();
            console.log('BrightData response:', JSON.stringify(bdData).slice(0, 200));
            
            if (bdData?.snapshot_id) {
              // Store snapshot_id for later retrieval — async collection
              facebookUrl = null; // Will be retrieved separately
            }
          }
        } catch (bdErr) {
          console.error('BrightData fallback failed:', bdErr.message);
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

