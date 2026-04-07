// ══════════════════════════════════════════════════
// PAGE DISCOVERY — find likely website, Facebook, Yelp
// ══════════════════════════════════════════════════

// ── Facebook URL validation (reused from routes/facebook.js) ──
const FB_BLOCKED = [
  'tr?id=', 'tr/?id=', '/tr?', '/sharer', '/share', '/dialog',
  '/login', '/help', '/policies', '/groups', '/events', '/watch',
  '/ads', '/photos', '/videos', '/posts', '/reels', '/reviews',
  '/messages', '/marketplace', '/l.php', 'l.facebook.com',
  '/2008/', '/fbml', '/plugins', '/hashtag', '/stories', '/gaming',
  '/fundraisers', '/bookmarks', '/flx/', '/privacy', '/settings',
  '/notifications', '/feed',
];

function isValidFbUrl(url) {
  if (!url || typeof url !== 'string' || !url.includes('facebook.com')) return false;
  const lower = url.toLowerCase();
  for (const block of FB_BLOCKED) { if (lower.includes(block)) return false; }
  const pagePath = url.split('facebook.com/')[1];
  if (!pagePath) return false;
  const slug = pagePath.split(/[/?#]/)[0];
  if (!slug || slug.length < 3) return false;
  if (pagePath.startsWith('profile.php')) return /profile\.php\?id=\d+/.test(pagePath);
  if (/^\d+$/.test(slug)) return false;
  if (/^(p|pages|people|public)$/i.test(slug)) return false;
  return true;
}

function normalizeFbUrl(url) {
  let cleaned = url.replace(/&amp;/g, '&').replace(/\\\//g, '/').replace(/\/+$/, '');
  cleaned = cleaned.replace(/^https?:\/\/m\.facebook\.com/i, 'https://www.facebook.com');
  cleaned = cleaned.replace(/^https?:\/\/fb\.com/i, 'https://www.facebook.com');
  const idMatch = cleaned.match(/profile\.php\?id=(\d+)/);
  if (idMatch) return `https://www.facebook.com/profile.php?id=${idMatch[1]}`;
  const username = cleaned.split('facebook.com/')[1]?.split(/[/?#]/)[0];
  if (!username) return null;
  return `https://www.facebook.com/${username}`;
}

// ── Discover website ──
async function discoverWebsite({ website, businessName, city, state, googlePlaceId }) {
  // If website already provided, use it
  if (website) {
    let url = website.trim();
    if (!url.startsWith('http')) url = `https://${url}`;
    console.log(`[DISCOVER] Website: using provided URL ${url}`);
    return { url, title: null, source: 'user_provided' };
  }

  // Try Google Places
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (key && googlePlaceId) {
    try {
      const res = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${googlePlaceId}&fields=website,name&key=${key}`);
      const data = await res.json();
      if (data?.result?.website) {
        console.log(`[DISCOVER] Website: found via Google Places: ${data.result.website}`);
        return { url: data.result.website, title: data.result.name || null, source: 'google_places' };
      }
    } catch (e) { console.log(`[DISCOVER] Website Google Places failed: ${e.message}`); }
  }

  // Try Google Places find
  if (key) {
    try {
      const findRes = await fetch(`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(`${businessName} ${city} ${state}`)}&inputtype=textquery&fields=place_id,name&key=${key}`);
      const findData = await findRes.json();
      const placeId = findData?.candidates?.[0]?.place_id;
      if (placeId) {
        const detailRes = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=website,name&key=${key}`);
        const detailData = await detailRes.json();
        if (detailData?.result?.website) {
          console.log(`[DISCOVER] Website: found via Google search: ${detailData.result.website}`);
          return { url: detailData.result.website, title: detailData.result.name || null, source: 'google_search' };
        }
      }
    } catch (e) { console.log(`[DISCOVER] Website Google search failed: ${e.message}`); }
  }

  console.log('[DISCOVER] Website: not found');
  return null;
}

// ── Discover Facebook ──
async function discoverFacebook({ businessName, city, state, websiteUrl }) {
  let candidates = [];

  // Step 1: Gemini grounded search
  if (process.env.GEMINI_API_KEY) {
    try {
      console.log('[DISCOVER] Facebook: trying Gemini search');
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `Find the official Facebook business page URL for "${businessName}"${city ? ` in ${city}` : ''}${state ? `, ${state}` : ''}${websiteUrl ? ` (website: ${websiteUrl})` : ''}.\nRules:\n- Only return real Facebook business page URLs\n- Format: https://www.facebook.com/pagename OR https://www.facebook.com/profile.php?id=NUMBER\n- Do NOT return tracking, share, or pixel URLs\nReturn ONLY a JSON array: ["url1","url2"]` }] }],
            tools: [{ google_search: {} }],
            generationConfig: { temperature: 0, maxOutputTokens: 200 },
          }),
          signal: AbortSignal.timeout(12000),
        }
      );
      if (res.ok) {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) {
          try {
            const urls = JSON.parse(text.replace(/```json|```/g, '').trim());
            if (Array.isArray(urls)) candidates.push(...urls.filter(isValidFbUrl));
          } catch {
            const matches = text.match(/https?:\/\/(www\.)?facebook\.com\/[^\s"',\]]+/g);
            if (matches) candidates.push(...matches.filter(isValidFbUrl));
          }
        }
      }
      console.log(`[DISCOVER] Facebook: Gemini returned ${candidates.length} candidates`);
    } catch (e) { console.log(`[DISCOVER] Facebook Gemini failed: ${e.message}`); }
  }

  // Step 2: Scrape business website for FB links
  if (candidates.length === 0 && websiteUrl) {
    try {
      console.log('[DISCOVER] Facebook: scraping website for FB links');
      let url = websiteUrl;
      if (!url.startsWith('http')) url = `https://${url}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120 Safari/537.36' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const html = await res.text();
        const matches = html.match(/https?:\/\/(www\.)?facebook\.com\/[^\s"'<>]+/g) || [];
        candidates.push(...matches.filter(isValidFbUrl));
      }
    } catch (e) { console.log(`[DISCOVER] Facebook website scrape failed: ${e.message}`); }
  }

  if (candidates.length === 0) {
    console.log('[DISCOVER] Facebook: not found');
    return null;
  }

  const best = normalizeFbUrl(candidates[0]);
  console.log(`[DISCOVER] Facebook: best candidate ${best}`);
  return { url: best, title: null, source: candidates.length > 0 ? 'gemini' : 'website_scrape' };
}

// ── Discover Yelp ──
async function discoverYelp({ businessName, city, state }) {
  // Simple approach: Gemini grounded search for Yelp page
  if (process.env.GEMINI_API_KEY) {
    try {
      console.log('[DISCOVER] Yelp: trying Gemini search');
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `Find the Yelp business page URL for "${businessName}" in ${city}${state ? `, ${state}` : ''}.\nRules:\n- Only return real Yelp business page URLs\n- Format: https://www.yelp.com/biz/business-name-city\n- Do NOT return yelp.com/search or yelp.com/writeareview URLs\nReturn ONLY the single best Yelp URL, or "NOT_FOUND" if you cannot find it.` }] }],
            tools: [{ google_search: {} }],
            generationConfig: { temperature: 0, maxOutputTokens: 200 },
          }),
          signal: AbortSignal.timeout(12000),
        }
      );
      if (res.ok) {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text && text !== 'NOT_FOUND') {
          const match = text.match(/https?:\/\/(www\.)?yelp\.com\/biz\/[^\s"',\]]+/);
          if (match) {
            const url = match[0].replace(/\/+$/, '');
            console.log(`[DISCOVER] Yelp: found ${url}`);
            return { url, title: null, source: 'gemini' };
          }
        }
      }
    } catch (e) { console.log(`[DISCOVER] Yelp Gemini failed: ${e.message}`); }
  }

  console.log('[DISCOVER] Yelp: not found');
  return null;
}

// ── Main discovery function ──
async function discoverPages({ businessName, city, state, website, googlePlaceId }) {
  console.log(`[DISCOVER] ═══ Starting discovery: ${businessName}, ${city} ${state || ''} ═══`);
  const t0 = Date.now();

  // Run website first (may need URL for FB scrape), then FB + Yelp in parallel
  const websiteResult = await discoverWebsite({ website, businessName, city, state, googlePlaceId });
  const websiteUrl = websiteResult?.url || null;

  const [facebookResult, yelpResult] = await Promise.all([
    discoverFacebook({ businessName, city, state, websiteUrl }),
    discoverYelp({ businessName, city, state }),
  ]);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[DISCOVER] ═══ Done in ${elapsed}s. Website=${websiteUrl ? 'YES' : 'NO'} Facebook=${facebookResult ? 'YES' : 'NO'} Yelp=${yelpResult ? 'YES' : 'NO'} ═══`);

  return {
    website: websiteResult,
    facebook: facebookResult,
    yelp: yelpResult,
  };
}

module.exports = { discoverPages };
