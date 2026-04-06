const axios = require('axios');
const cheerio = require('cheerio');
const http = require('http');
const https = require('https');

const TIMEOUT = 10000;
const ax = axios.create({ timeout: TIMEOUT, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' } });
const F = (platform, severity, title, description, impact, fix) => ({ platform, severity, title, description, impact: impact || '', fix: fix || '' });

// ══════════════════════════════════════
// INFRASTRUCTURE
// ══════════════════════════════════════

function fetchViaProxy(targetUrl, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const BU = process.env.BRIGHTDATA_USERNAME, BP = process.env.BRIGHTDATA_PASSWORD;
    if (!BU || !BP) return reject(new Error('No BrightData creds'));
    const target = new URL(targetUrl);
    const proxyUser = BU.includes('-country-') ? BU : `${BU}-country-us`;
    const auth = Buffer.from(`${proxyUser}:${BP}`).toString('base64');
    const connectReq = http.request({ host: process.env.BRIGHTDATA_HOST || 'brd.superproxy.io', port: parseInt(process.env.BRIGHTDATA_PORT || '22225'), method: 'CONNECT', path: `${target.hostname}:443`, headers: { 'Proxy-Authorization': `Basic ${auth}` }, timeout });
    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); return reject(new Error(`Proxy ${res.statusCode}`)); }
      const req = https.request({ hostname: target.hostname, path: target.pathname + target.search, method: 'GET', socket, agent: false, rejectUnauthorized: false, headers: { 'User-Agent': 'Mozilla/5.0 Chrome/122 Safari/537.36', Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' } }, (response) => {
        let data = ''; response.on('data', c => { data += c; }); response.on('end', () => resolve({ ok: response.statusCode < 400, html: data }));
      });
      req.on('error', reject); req.end();
    });
    connectReq.on('error', reject);
    connectReq.on('timeout', () => { connectReq.destroy(); reject(new Error('Proxy timeout')); });
    connectReq.end();
  });
}

async function askGemini(prompt, timeout = 10000) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const res = await ax.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
      contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0, maxOutputTokens: 800 }
    }, { timeout });
    return res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (e) { console.log(`[GEMINI] ${e.message}`); return null; }
}

// ── OUTSCRAPER ──
async function outscraperSearch(query) {
  const key = process.env.OUTSCRAPER_API_KEY;
  if (!key) { console.log('[OUTSCRAPER] No API key'); return null; }
  try {
    const res = await ax.get('https://api.app.outscraper.com/maps/search-v3', {
      params: { query, limit: 1, async: false, language: 'en', region: 'us', fields: 'name,place_id,full_address,phone,site,rating,reviews,working_hours,business_status,type,subtypes,description,photos_count,facebook,instagram,twitter,linkedin,youtube,yelp' },
      headers: { 'X-API-KEY': key }, timeout: 30000,
    });
    const data = res.data?.data?.[0]?.[0] || res.data?.data?.[0] || null;
    if (data) console.log(`[OUTSCRAPER] Found: ${data.name} | FB: ${data.facebook || 'none'} | Yelp: ${data.yelp || 'none'} | IG: ${data.instagram || 'none'}`);
    else console.log('[OUTSCRAPER] No results');
    return data;
  } catch (e) { console.log(`[OUTSCRAPER] Error: ${e.message}`); return null; }
}

async function outscraperContacts(domain) {
  const key = process.env.OUTSCRAPER_API_KEY;
  if (!key) return null;
  try {
    const res = await ax.get('https://api.app.outscraper.com/emails-and-contacts', {
      params: { query: domain, async: false },
      headers: { 'X-API-KEY': key }, timeout: 20000,
    });
    const data = res.data?.data?.[0] || null;
    if (data) console.log(`[OUTSCRAPER CONTACTS] FB: ${data.socials?.facebook || 'none'} | IG: ${data.socials?.instagram || 'none'}`);
    return data;
  } catch (e) { console.log(`[OUTSCRAPER CONTACTS] ${e.message}`); return null; }
}

// ══════════════════════════════════════
// CHECK 1: GOOGLE BUSINESS PROFILE (30pts)
// ══════════════════════════════════════
async function checkGoogle(businessName, city, state) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return { found: false, rawScore: 0, maxScore: 30, score: 0, findings: [F('Google', 'critical', 'Google check unavailable', 'API key not configured.', '', '')] };

  console.log(`[SCAN] Google: "${businessName} ${city} ${state}"`);
  const findRes = await ax.get('https://maps.googleapis.com/maps/api/place/findplacefromtext/json', { params: { input: `${businessName} ${city} ${state}`, inputtype: 'textquery', fields: 'place_id,name,formatted_address,business_status', key: apiKey } });
  const candidate = findRes.data?.candidates?.[0];
  if (!candidate?.place_id) return { found: false, rawScore: 0, maxScore: 30, score: 0, findings: [F('Google', 'critical', 'Not found on Google', `No listing found for "${businessName}" in ${city}.`, 'Customers cannot find you on Google — the #1 way people discover local businesses.', 'Create your Google Business Profile at business.google.com immediately.')] };

  const detailRes = await ax.get('https://maps.googleapis.com/maps/api/place/details/json', { params: { place_id: candidate.place_id, fields: 'name,rating,user_ratings_total,formatted_address,formatted_phone_number,opening_hours,website,photos,business_status,reviews,types,editorial_summary,price_level,reservable,serves_beer,serves_wine,takeout,delivery,dine_in', key: apiKey } });
  const d = detailRes.data?.result || {};
  const rating = d.rating || 0;
  const reviewCount = d.user_ratings_total || 0;
  const hasHours = !!d.opening_hours;
  const hoursComplete = (d.opening_hours?.weekday_text?.length || 0) === 7;
  const photoCount = d.photos?.length || 0;
  const hasWebsite = !!d.website;
  const hasPhone = !!d.formatted_phone_number;
  const hasDescription = !!d.editorial_summary?.overview;
  const businessStatus = d.business_status || 'UNKNOWN';
  const types = d.types || [];
  const reviews = d.reviews || [];

  // Review response rate
  const repliedCount = reviews.filter(r => r.author_url && !r.author_url.includes('/maps/contrib/')).length;
  const responseRate = reviews.length > 0 ? Math.round((repliedCount / reviews.length) * 100) : 0;

  // Recent review check
  const now = Date.now() / 1000;
  const mostRecentReview = reviews[0]?.time || 0;
  const daysSinceReview = mostRecentReview ? Math.round((now - mostRecentReview) / 86400) : 999;

  // SCORING (30pts max)
  let rawScore = 0;
  // Rating (10pts)
  if (rating >= 4.8) rawScore += 10; else if (rating >= 4.5) rawScore += 8; else if (rating >= 4.0) rawScore += 6; else if (rating >= 3.5) rawScore += 3; else if (rating > 0) rawScore += 1;
  // Review count (8pts)
  if (reviewCount >= 500) rawScore += 8; else if (reviewCount >= 200) rawScore += 7; else if (reviewCount >= 100) rawScore += 5; else if (reviewCount >= 50) rawScore += 4; else if (reviewCount >= 20) rawScore += 2; else if (reviewCount > 0) rawScore += 1;
  // Profile complete (6pts)
  if (hasHours && hoursComplete) rawScore += 1;
  if (hasWebsite) rawScore += 1;
  if (hasPhone) rawScore += 1;
  if (photoCount >= 10) rawScore += 1; else if (photoCount >= 5) rawScore += 0.5;
  if (hasDescription) rawScore += 1;
  if (types.length > 1) rawScore += 0.5;
  // Recent activity (3pts)
  if (daysSinceReview <= 30) rawScore += 3; else if (daysSinceReview <= 90) rawScore += 2; else if (daysSinceReview <= 180) rawScore += 1;
  // Response rate (3pts)
  if (responseRate >= 50) rawScore += 3; else if (responseRate >= 25) rawScore += 2; else if (responseRate > 0) rawScore += 1;

  rawScore = Math.min(Math.round(rawScore), 30);

  // FINDINGS
  const findings = [];
  if (rating === 0) findings.push(F('Google', 'critical', 'No Google rating', 'Your profile has no rating.', 'Businesses without ratings get far fewer clicks.', 'Ask 10 customers to leave a review this week.'));
  else if (rating < 4.0) findings.push(F('Google', 'critical', `${rating}-star rating is hurting you`, 'Below the 4.0 threshold customers use to filter.', 'Up to 40% of potential customers filter you out.', 'Respond to negatives professionally. Ask happy customers for reviews.'));
  else if (rating < 4.5) findings.push(F('Google', 'warning', `${rating}-star rating — room to improve`, 'Below 4.5 that top businesses maintain.', 'Businesses with 4.5+ get more clicks and calls.', 'Ask every happy customer for a review.'));
  else findings.push(F('Google', 'good', `Strong ${rating}-star rating`, 'Excellent rating that builds trust.', '', ''));

  if (reviewCount < 10) findings.push(F('Google', 'critical', `Only ${reviewCount} reviews`, 'Very few reviews look unestablished.', '', 'Start a review campaign. Aim for 50+ within 60 days.'));
  else if (reviewCount < 50) findings.push(F('Google', 'warning', `${reviewCount} reviews — need more`, 'Competitors likely have more.', '', 'Send follow-up texts after every job.'));
  else findings.push(F('Google', 'good', `${reviewCount} reviews — solid`, '', '', ''));

  if (!hasHours) findings.push(F('Google', 'warning', 'Hours missing', 'Customers assume you\'re closed.', '', 'Add hours in Google Business Profile.'));
  if (photoCount < 5) findings.push(F('Google', 'warning', `Only ${photoCount} photos`, 'Listings with 10+ photos get 42% more requests.', '', 'Add photos of storefront, team, and work.'));
  if (!hasWebsite) findings.push(F('Google', 'warning', 'No website linked', '', '', 'Add your website to Google Business Profile.'));
  if (daysSinceReview > 180) findings.push(F('Google', 'warning', 'No recent reviews', `Last review was ${daysSinceReview}+ days ago.`, 'Looks like your business may be inactive.', 'Start asking for reviews immediately.'));
  if (businessStatus !== 'OPERATIONAL') findings.push(F('Google', 'critical', `Status: ${businessStatus}`, 'Customers think you\'re closed.', '', 'Verify your business is marked open.'));
  if (responseRate < 25 && reviewCount >= 5) findings.push(F('Google', 'warning', 'Low review response rate', `Only ${responseRate}% of reviews have owner replies.`, 'Responding shows you care about customers.', 'Reply to every Google review — even positive ones.'));

  // Review sentiment (Gemini)
  let sentiment = null;
  if (reviews.length >= 3) {
    try {
      const reviewTexts = reviews.slice(0, 5).map(r => `${r.rating}★: "${(r.text || '').slice(0, 150)}"`).join('\n');
      const sentRes = await askGemini(`Analyze these Google reviews:\n${reviewTexts}\nReturn JSON: {"praiseThemes":["top 3"],"complaintThemes":["top 3"],"sentimentScore":1-10}`, 8000);
      if (sentRes) { try { sentiment = JSON.parse(sentRes.match(/\{[\s\S]*\}/)?.[0] || '{}'); } catch {} }
    } catch {}
  }

  return {
    found: true, confidence: 'high', placeId: candidate.place_id, name: d.name || businessName,
    rating, reviewCount, address: d.formatted_address || '', phone: d.formatted_phone_number || '',
    website: d.website || '', hasHours, hoursComplete, photoCount, hasWebsite, hasPhone, hasDescription,
    businessStatus, types, responseRate, daysSinceReview, sentiment,
    reviews: reviews.slice(0, 5).map(r => ({ text: r.text?.slice(0, 200), rating: r.rating, time: r.time })),
    rawScore, maxScore: 30, score: Math.round((rawScore / 30) * 100), findings
  };
}

// ══════════════════════════════════════
// CHECK 2: WEBSITE AUDIT (25pts)
// ══════════════════════════════════════
async function checkWebsite(websiteUrl) {
  if (!websiteUrl) return { found: false, rawScore: 0, maxScore: 25, score: 0, findings: [F('Website', 'warning', 'No website provided', '', '', 'Add your website URL.')] };
  let url = websiteUrl.trim(); if (!url.startsWith('http')) url = `https://${url}`;
  try { const u = new URL(url); u.search = ''; url = u.toString().replace(/\/$/, ''); } catch {}
  console.log(`[SCAN] Website: ${url}`);

  let rawScore = 0;
  const findings = [];

  // SSL (5pts)
  let hasSSL = false;
  try {
    const r = await ax.get(url, { timeout: 8000, maxRedirects: 5 });
    hasSSL = (r.request?.res?.responseUrl || r.config?.url || '').startsWith('https://');
    if (hasSSL) { rawScore += 5; findings.push(F('Website', 'good', 'SSL active', '', '', '')); }
    else findings.push(F('Website', 'critical', 'No SSL', 'Browsers show "Not Secure" warning.', 'Customers leave immediately.', 'Install SSL — most hosts offer free via Let\'s Encrypt.'));
  } catch { findings.push(F('Website', 'warning', 'Website unreachable', '', '', 'Check if your site is online.')); }

  // Meta tags (10pts)
  try {
    const r = await ax.get(url, { timeout: 8000 });
    const html = r.data || '';
    const $ = cheerio.load(html);
    const title = $('title').text().trim();
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    const ogTitle = $('meta[property="og:title"]').attr('content');
    const ogImage = $('meta[property="og:image"]').attr('content');
    const h1 = $('h1').first().text().trim();
    const hasSchema = html.includes('application/ld+json');
    const hasPhoneOnSite = /(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})|tel:/i.test(html);
    const hasAddr = /\b\d{2,5}\s+[A-Z][a-z]+\s+(St|Ave|Blvd|Dr|Rd|Ln|Way|Ct)/i.test(html);
    const hasCTA = /book\s*(now|online|appointment)|call\s*(us|now|today)|contact\s*us|schedule|get\s*quote/i.test(html);

    if (title && title.length <= 60) rawScore += 2; else if (title) { rawScore += 1; findings.push(F('Website', 'warning', 'Title tag too long', `${title.length} chars (should be under 60).`, '', 'Shorten title tag.')); }
    else findings.push(F('Website', 'critical', 'Missing title tag', '', 'Google can\'t index your page properly.', 'Add a title tag.'));

    if (metaDesc && metaDesc.length <= 160) rawScore += 2; else if (!metaDesc) findings.push(F('Website', 'warning', 'Missing meta description', '', 'Google shows random text.', 'Add meta description under 160 chars.'));
    else rawScore += 1;

    if (ogTitle && ogImage) rawScore += 1; else findings.push(F('Website', 'warning', 'No social sharing tags', 'Links shared on social show no preview.', '', 'Add og:title and og:image.'));
    if (h1) rawScore += 1; else findings.push(F('Website', 'warning', 'No H1 heading', '', '', 'Add H1 to homepage.'));
    if (hasSchema) { rawScore += 1; findings.push(F('Website', 'good', 'Schema markup found', '', '', '')); }
    else findings.push(F('Website', 'warning', 'No schema markup', '', 'Google can\'t show rich results.', 'Add LocalBusiness JSON-LD.'));
    if (hasPhoneOnSite) rawScore += 1; else findings.push(F('Website', 'warning', 'No phone on website', '', '', 'Add phone number prominently.'));
    if (hasAddr) rawScore += 1; else findings.push(F('Website', 'warning', 'No address on website', '', '', 'Add your business address.'));
    if (hasCTA) rawScore += 1; else findings.push(F('Website', 'warning', 'No CTA button found', 'No book/call/contact button detected.', '', 'Add a prominent CTA button.'));
  } catch (e) { console.log(`[SCAN] Meta scrape: ${e.message}`); }

  // PageSpeed (10pts)
  let perfScore = 0, loadTime = null;
  try {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    const params = { url, strategy: 'mobile', category: 'performance' };
    if (apiKey) params.key = apiKey;
    const r = await ax.get('https://www.googleapis.com/pagespeedonline/v5/runPagespeed', { params, timeout: 30000 });
    perfScore = Math.round((r.data?.lighthouseResult?.categories?.performance?.score || 0) * 100);
    const fcp = r.data?.lighthouseResult?.audits?.['first-contentful-paint']?.numericValue;
    loadTime = fcp ? Math.round(fcp / 100) / 10 : null;

    if (perfScore >= 90) { rawScore += 10; findings.push(F('Website', 'good', `Speed ${perfScore}/100`, '', '', '')); }
    else if (perfScore >= 70) { rawScore += 7; findings.push(F('Website', 'good', `Speed ${perfScore}/100`, '', '', '')); }
    else if (perfScore >= 50) { rawScore += 4; findings.push(F('Website', 'warning', `Speed ${perfScore}/100`, 'Below 70 threshold.', '53% of users leave slow sites.', 'Optimize images, enable compression.')); }
    else { rawScore += 1; findings.push(F('Website', 'critical', `Speed ${perfScore}/100`, 'Very slow.', 'Google penalizes slow sites.', 'Major performance overhaul needed.')); }
  } catch (e) { console.log(`[SCAN] PageSpeed: ${e.message}`); }

  return { found: true, confidence: 'high', hasSSL, perfScore, loadTime, rawScore: Math.min(rawScore, 25), maxScore: 25, score: Math.round((Math.min(rawScore, 25) / 25) * 100), findings };
}

// ══════════════════════════════════════
// CHECK 3: FACEBOOK (15pts)
// ══════════════════════════════════════
async function checkFacebook(businessName, city, state, facebookUrl, outscraperData) {
  console.log(`[SCAN] Facebook: ${businessName} ${city}`);
  // Outscraper URL is most reliable — skip search if we have it
  let fbUrl = facebookUrl || outscraperData?.facebook || null;
  if (fbUrl) console.log(`[FB] Using Outscraper URL: ${fbUrl}`);
  if (!fbUrl) {
    const g = await askGemini(`Find the official Facebook business page URL for "${businessName}" in ${city}, ${state}. Return ONLY the facebook.com URL or NOT_FOUND.`, 10000);
    if (g && !g.includes('NOT_FOUND') && g.includes('facebook.com')) { const m = g.match(/https?:\/\/(www\.)?facebook\.com\/[^\s"',\]]+/); if (m) fbUrl = m[0].replace(/[.,;)]+$/, ''); }
  }
  if (!fbUrl) return { found: false, rawScore: 0, maxScore: 15, score: 0, findings: [F('Facebook', 'critical', 'No Facebook page found', `Could not find a Facebook page for ${businessName}.`, 'Over 70% of consumers check Facebook before visiting.', 'Create a Facebook Business Page at facebook.com/pages/create.')] };

  let rawScore = 0;
  const findings = [];
  const pageData = { url: fbUrl, followers: null, rating: null, active: false };

  try {
    const res = await fetchViaProxy(fbUrl, 10000);
    if (res.ok && res.html) {
      const text = res.html;
      const followerMatch = text.match(/([\d,\.]+[KkMm]?)\s*(?:followers|people follow|people like)/i);
      if (followerMatch) pageData.followers = followerMatch[1];
      const ratingMatch = text.match(/([\d.]+)\s*(?:out of 5|\/5|stars)/i);
      if (ratingMatch) pageData.rating = parseFloat(ratingMatch[1]);
      const hasRecentPosts = /ago|yesterday|today|hours? ago|minutes? ago/i.test(text);
      pageData.active = hasRecentPosts;

      rawScore += 5; // exists
      if (pageData.followers) { const fc = parseInt(String(pageData.followers).replace(/[^0-9]/g, '')) || 0; if (fc >= 1000) rawScore += 3; else if (fc >= 500) rawScore += 2; else rawScore += 1; }
      if (hasRecentPosts) { rawScore += 4; findings.push(F('Facebook', 'good', 'Page is active', '', '', '')); }
      else { rawScore += 1; findings.push(F('Facebook', 'warning', 'Page appears inactive', 'No recent posts detected.', 'Inactive pages signal business may not be active.', 'Post 2-3 times per week.')); }
      if (pageData.rating && pageData.rating >= 4.0) rawScore += 3; else if (pageData.rating) rawScore += 1;
      findings.push(F('Facebook', 'good', 'Facebook page found', `Found at ${fbUrl}${pageData.followers ? ` — ${pageData.followers} followers` : ''}`, '', ''));
    }
  } catch (e) {
    console.log(`[SCAN] Facebook scrape: ${e.message}`);
    rawScore += 2; findings.push(F('Facebook', 'warning', 'Found but could not fully analyze', '', '', ''));
  }

  return { found: true, confidence: 'medium', ...pageData, rawScore: Math.min(rawScore, 15), maxScore: 15, score: Math.round((Math.min(rawScore, 15) / 15) * 100), findings };
}

// ══════════════════════════════════════
// CHECK 4: YELP (15pts)
// ══════════════════════════════════════
async function checkYelp(businessName, city, state, outscraperYelpUrl) {
  console.log(`[SCAN] Yelp: ${businessName} ${city}`);
  let rawScore = 0, rating = 0, reviewCount = 0, claimed = false;
  const findings = [];

  // Use Outscraper URL if available — skip search
  let directUrl = outscraperYelpUrl || null;
  if (directUrl) console.log(`[YELP] Using Outscraper URL: ${directUrl}`);
  if (!directUrl) {
    const g = await askGemini(`Find the Yelp page URL for "${businessName}" in ${city}, ${state}. Return ONLY the yelp.com URL or NOT_FOUND.`, 8000);
    if (g && g.includes('yelp.com') && !g.includes('NOT_FOUND')) { const m = g.match(/https?:\/\/(www\.)?yelp\.com\/biz\/[^\s"',\]]+/); if (m) directUrl = m[0]; }
  }

  // Scrape
  let html = '';
  if (directUrl) try { const r = await fetchViaProxy(directUrl, 8000); html = r.html || ''; } catch {}
  if (!html) { const searchUrl = `https://www.yelp.com/search?find_desc=${encodeURIComponent(businessName)}&find_loc=${encodeURIComponent(city + ' ' + state)}`; try { const r = await fetchViaProxy(searchUrl, 8000); html = r.html || ''; } catch {} }
  if (!html) { const slug = `${businessName}-${city}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80); try { const r = await ax.get(`https://www.yelp.com/biz/${slug}`, { timeout: 5000 }); html = r.data || ''; } catch {} }

  if (html) {
    const rm = html.match(/(\d\.\d)\s*star/i) || html.match(/aria-label="(\d\.?\d?)\s*star/i) || html.match(/ratingValue.*?(\d\.?\d?)/i);
    rating = parseFloat(rm?.[1] || '0');
    const revm = html.match(/(\d+)\s*review/i); reviewCount = parseInt(revm?.[1] || '0');
    claimed = html.toLowerCase().includes('claimed');
  }

  if (rating > 0) {
    rawScore += 5;
    if (!claimed) findings.push(F('Yelp', 'critical', 'Page not claimed', '', 'Can\'t respond to reviews.', 'Claim at biz.yelp.com — free.'));
    if (rating >= 4.0) rawScore += 5; else if (rating >= 3.5) rawScore += 3; else rawScore += 1;
    if (reviewCount >= 50) rawScore += 5; else if (reviewCount >= 20) rawScore += 3; else rawScore += 1;
    if (rating < 4.0) findings.push(F('Yelp', 'warning', `Yelp rating ${rating} stars`, '', '', 'Improve service and ask happy customers to review.'));
    else findings.push(F('Yelp', 'good', `${rating}-star Yelp rating`, `${reviewCount} reviews.`, '', ''));
  } else {
    findings.push(F('Yelp', 'warning', 'Not found on Yelp', '', 'Missing from a major review platform.', 'Add your business at biz.yelp.com.'));
  }

  return { found: rating > 0, confidence: rating > 0 ? 'medium' : 'low', rating, reviewCount, claimed, rawScore: Math.min(rawScore, 15), maxScore: 15, score: Math.round((Math.min(rawScore, 15) / 15) * 100), findings };
}

// ══════════════════════════════════════
// CHECK 5: BING PLACES (5pts)
// ══════════════════════════════════════
async function checkBing(businessName, city, state, googlePhone) {
  console.log(`[SCAN] Bing: ${businessName} ${city}`);
  let rawScore = 0;
  const findings = [];
  try {
    const r = await ax.get(`https://www.bing.com/search?q=${encodeURIComponent(businessName + ' ' + city + ' ' + state)}`, { timeout: 6000 });
    const text = (r.data || '').toLowerCase();
    if (text.includes(businessName.toLowerCase().split(' ')[0])) { rawScore += 3; findings.push(F('Bing', 'good', 'Found on Bing', '', '', '')); }
    else findings.push(F('Bing', 'warning', 'Not prominent on Bing', '', '', 'Claim at bingplaces.com.'));
    if (googlePhone) { const digits = googlePhone.replace(/[^0-9]/g, ''); if (digits && text.includes(digits.slice(-7))) rawScore += 2; else findings.push(F('Bing', 'warning', 'Phone inconsistent on Bing', '', '', 'Verify info at bingplaces.com.')); }
  } catch { findings.push(F('Bing', 'warning', 'Bing check failed', '', '', '')); }
  return { rawScore, maxScore: 5, findings };
}

// ══════════════════════════════════════
// CHECK 6: APPLE MAPS (5pts)
// ══════════════════════════════════════
async function checkAppleMaps(businessName, city, state) {
  console.log(`[SCAN] Apple Maps: ${businessName} ${city}`);
  let rawScore = 0;
  const findings = [];
  const g = await askGemini(`Search for "${businessName}" in ${city}, ${state} on Apple Maps. Is it listed? Is it claimed? What info shows? Answer briefly.`, 8000);
  if (g) {
    const listed = g.toLowerCase().includes('listed') || g.toLowerCase().includes('found') || g.toLowerCase().includes('shows');
    const claimedApple = g.toLowerCase().includes('claimed');
    if (listed) { rawScore += 3; findings.push(F('Apple Maps', 'good', 'Listed on Apple Maps', '', '', '')); }
    else findings.push(F('Apple Maps', 'warning', 'Not found on Apple Maps', '', 'Apple Maps reaches 1 billion iPhone users.', 'Claim your listing at mapsconnect.apple.com.'));
    if (claimedApple) { rawScore += 2; } else if (listed) { findings.push(F('Apple Maps', 'warning', 'Apple Maps listing unclaimed', 'Apple Business Connect launched recently — most businesses haven\'t claimed yet.', 'This is a competitive advantage opportunity.', 'Claim at businessconnect.apple.com — free.')); }
  } else {
    findings.push(F('Apple Maps', 'warning', 'Apple Maps check unavailable', '', '', ''));
  }
  return { rawScore, maxScore: 5, findings };
}

// ══════════════════════════════════════
// CHECK 7: BBB (5pts)
// ══════════════════════════════════════
async function checkBBB(businessName, city, state) {
  console.log(`[SCAN] BBB: ${businessName} ${city}`);
  let rawScore = 0;
  const findings = [];
  try {
    const url = `https://www.bbb.org/search?find_country=USA&find_text=${encodeURIComponent(businessName)}&find_loc=${encodeURIComponent(city + ', ' + state)}`;
    let html = '';
    try { const r = await fetchViaProxy(url, 8000); html = r.html || ''; } catch {}
    if (!html) try { const r = await ax.get(url, { timeout: 6000 }); html = r.data || ''; } catch {}
    if (html) {
      const hasResult = html.toLowerCase().includes(businessName.toLowerCase().split(' ')[0]);
      const accredited = html.includes('BBB Accredited') || html.includes('accredited');
      const ratingMatch = html.match(/rating[:\s]*(A\+|A|B\+|B|C\+|C|D|F)/i);
      if (hasResult) {
        rawScore += 2; findings.push(F('BBB', 'good', 'Found on BBB', ratingMatch ? `Rating: ${ratingMatch[1]}` : '', '', ''));
        if (accredited) { rawScore += 2; findings.push(F('BBB', 'good', 'BBB Accredited', 'Builds significant trust.', '', '')); }
        if (ratingMatch && ['A+', 'A'].includes(ratingMatch[1])) rawScore += 1;
      } else { findings.push(F('BBB', 'warning', 'Not found on BBB', '', 'Many customers check BBB.', 'Register at bbb.org.')); }
    }
  } catch { findings.push(F('BBB', 'warning', 'BBB check failed', '', '', '')); }
  return { rawScore, maxScore: 5, findings };
}

// ══════════════════════════════════════
// CHECK 8: COMPETITORS
// ══════════════════════════════════════
async function checkCompetitors(businessName, city, state, googleData) {
  console.log(`[SCAN] Competitors: ${businessName}`);
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey || !googleData?.placeId) return { competitors: [], ranking: null };
  try {
    const type = googleData.types?.[0] || 'establishment';
    const geoRes = await ax.get('https://maps.googleapis.com/maps/api/geocode/json', { params: { address: googleData.address || `${city}, ${state}`, key: apiKey } });
    const loc = geoRes.data?.results?.[0]?.geometry?.location;
    if (!loc) return { competitors: [], ranking: null };
    let nearbyRes = await ax.get('https://maps.googleapis.com/maps/api/place/nearbysearch/json', { params: { location: `${loc.lat},${loc.lng}`, radius: 8000, type, key: apiKey } });
    if ((nearbyRes.data?.results || []).length < 3) nearbyRes = await ax.get('https://maps.googleapis.com/maps/api/place/nearbysearch/json', { params: { location: `${loc.lat},${loc.lng}`, radius: 12000, keyword: type.replace(/_/g, ' '), key: apiKey } });
    const competitors = (nearbyRes.data?.results || []).filter(p => p.place_id !== googleData.placeId && p.rating > 0).slice(0, 5).map(p => ({ name: p.name, rating: p.rating || 0, reviewCount: p.user_ratings_total || 0, address: p.vicinity || '' }));
    const allBiz = [{ name: businessName, rating: googleData.rating, reviewCount: googleData.reviewCount }, ...competitors];
    allBiz.sort((a, b) => (b.rating * 10 + Math.log(b.reviewCount + 1)) - (a.rating * 10 + Math.log(a.reviewCount + 1)));
    const ranking = allBiz.findIndex(b => b.name === businessName) + 1;
    return { competitors, ranking, totalInArea: allBiz.length };
  } catch (e) { console.log(`[SCAN] Competitors: ${e.message}`); return { competitors: [], ranking: null }; }
}

// ══════════════════════════════════════
// CHECK 9: VOICE SEARCH + AI VISIBILITY
// ══════════════════════════════════════
async function checkVoiceAndAI(businessName, city, state, googleData, bingData, yelpData, appleData) {
  console.log(`[SCAN] Voice/AI: ${businessName}`);
  const findings = [];
  // Voice search readiness
  const voiceFactors = [googleData?.found && googleData.hasHours && googleData.hasPhone, appleData?.rawScore >= 3, bingData?.rawScore >= 3, yelpData?.found, googleData?.rawScore >= 20];
  const voicePct = Math.round((voiceFactors.filter(Boolean).length / voiceFactors.length) * 100);
  const category = googleData?.types?.[0]?.replace(/_/g, ' ') || 'business';

  if (voicePct < 60) findings.push(F('Voice Search', 'warning', `${voicePct}% voice search ready`, `When someone says "Hey Siri, find a ${category} near me" — you may not appear.`, '', 'Complete your profiles on Google, Apple Maps, Bing, and Yelp.'));
  else findings.push(F('Voice Search', 'good', `${voicePct}% voice search ready`, '', '', ''));

  // AI visibility via Gemini
  let appearsInAI = false;
  const aiRes = await askGemini(`Search for "best ${category} in ${city} ${state}". Does "${businessName}" appear? List businesses mentioned. Brief answer.`, 8000);
  if (aiRes && aiRes.toLowerCase().includes(businessName.toLowerCase().split(' ')[0])) {
    appearsInAI = true;
    findings.push(F('AI Visibility', 'good', 'Appears in AI search results', `When customers ask AI about ${category} in ${city}, you are mentioned.`, '', ''));
  } else {
    findings.push(F('AI Visibility', 'warning', 'Not appearing in AI search', `AI assistants don't mention ${businessName} when asked about ${category} in ${city}.`, 'AI-powered search is growing rapidly.', 'Improve your overall online presence to appear in AI results.'));
  }

  return { voicePct, appearsInAI, findings };
}

// ══════════════════════════════════════
// CHECK 10: INDUSTRY DIRECTORIES
// ══════════════════════════════════════
async function checkIndustryDirs(businessName, city, state, googleTypes) {
  console.log(`[SCAN] Industry dirs: ${businessName}`);
  const findings = [];
  const category = (googleTypes || [])[0] || '';
  const dirMap = {
    plumber: ['HomeAdvisor', 'Angi', 'Thumbtack'], electrician: ['HomeAdvisor', 'Angi', 'Thumbtack'], hvac: ['HomeAdvisor', 'Angi'],
    restaurant: ['OpenTable', 'DoorDash', 'Grubhub'], dentist: ['Healthgrades', 'ZocDoc'], doctor: ['Healthgrades', 'ZocDoc'],
    lawyer: ['Avvo', 'FindLaw'], home_goods_store: ['Houzz'], beauty_salon: ['StyleSeat', 'Vagaro'], hair_care: ['StyleSeat', 'Vagaro'],
    car_repair: ['CarGurus'], gym: ['ClassPass'], veterinary_care: ['PetFinder'],
  };
  const dirs = dirMap[category] || ['Angi', 'Thumbtack'];
  if (dirs.length > 0) {
    const g = await askGemini(`Is "${businessName}" in ${city}, ${state} listed on these directories: ${dirs.join(', ')}? For each, say "listed" or "not listed". Brief answer.`, 8000);
    if (g) {
      const notListed = dirs.filter(d => g.toLowerCase().includes(d.toLowerCase()) && g.toLowerCase().includes('not listed'));
      const listed = dirs.filter(d => !notListed.includes(d) && g.toLowerCase().includes(d.toLowerCase()));
      if (listed.length > 0) findings.push(F('Directories', 'good', `Found on ${listed.join(', ')}`, '', '', ''));
      if (notListed.length > 0) findings.push(F('Directories', 'warning', `Not on ${notListed.join(', ')}`, 'Missing from industry-specific directories.', '', `Register on ${notListed[0]} to reach more customers.`));
    }
  }
  return { findings };
}

// ══════════════════════════════════════
// SCORING ENGINE (100pts)
// ══════════════════════════════════════
function calculateScore(p) {
  return Math.round(
    (p.google?.rawScore || 0) + // /30
    (p.website?.rawScore || 0) + // /25
    (p.facebook?.rawScore || 0) + // /15
    (p.yelp?.rawScore || 0) + // /15
    (p.bing?.rawScore || 0) + // /5
    (p.apple?.rawScore || 0) + // /5
    (p.bbb?.rawScore || 0) // /5
  ); // max 100
}

function getScoreLabel(s) {
  if (s >= 90) return 'Exceptional';
  if (s >= 75) return 'Strong';
  if (s >= 60) return 'Needs Work';
  if (s >= 45) return 'Critical';
  return 'Emergency';
}

// ══════════════════════════════════════
// AI INSIGHTS (Claude Haiku)
// ══════════════════════════════════════
async function generateInsights(businessName, city, state, platforms, overallScore, extra) {
  if (!process.env.ANTHROPIC_API_KEY) return { executiveSummary: '', topPriorities: [], competitorIntel: '', quickWins: [], monthlyGoal: '', revenueImpact: '' };
  const p = platforms;
  const comp = extra.competitors;
  const prompt = `You are a senior digital marketing consultant writing a premium $149 audit. Be specific, data-driven, no fluff.

BUSINESS: ${businessName}, ${city}${state ? ', ' + state : ''}${extra.industry ? ' (' + extra.industry + ')' : ''}
SCORE: ${overallScore}/100 — ${getScoreLabel(overallScore)}

PLATFORMS:
Google: ${p.google?.rawScore||0}/30 — ${p.google?.rating||'N/A'}★ (${p.google?.reviewCount||0} reviews), response rate ${p.google?.responseRate||0}%
Website: ${p.website?.rawScore||0}/25 — SSL:${p.website?.hasSSL?'Y':'N'}, Speed:${p.website?.perfScore||'?'}/100
Facebook: ${p.facebook?.rawScore||0}/15 — ${p.facebook?.found?'Found':'NOT FOUND'}${p.facebook?.followers?', '+p.facebook.followers+' followers':''}
Yelp: ${p.yelp?.rawScore||0}/15 — ${p.yelp?.found?p.yelp.rating+'★ '+p.yelp.reviewCount+' reviews':'NOT FOUND'}
Bing: ${p.bing?.rawScore||0}/5 | Apple: ${p.apple?.rawScore||0}/5 | BBB: ${p.bbb?.rawScore||0}/5
Voice Search: ${extra.voicePct||'?'}% ready | AI Visibility: ${extra.appearsInAI?'YES':'NO'}
${comp?.competitors?.length ? `Competitors: ${comp.competitors.map((c,i) => `${i+1}. ${c.name} ${c.rating}★ ${c.reviewCount}r`).join(', ')} | Rank: #${comp.ranking||'?'}/${comp.totalInArea||'?'}` : ''}
${extra.biggestChallenge ? `Owner challenge: "${extra.biggestChallenge}"` : ''}

Return JSON:
{"executiveSummary":"2-3 sentences with actual numbers","revenueImpact":"specific $ estimate based on industry avg ticket","topPriorities":[{"priority":1,"title":"action","description":"specific steps","timeToComplete":"X days","expectedImpact":"outcome","difficulty":"easy/medium/hard","estimatedROI":"$/mo"},{"priority":2,"title":"...","description":"...","timeToComplete":"...","expectedImpact":"...","difficulty":"...","estimatedROI":"..."},{"priority":3,"title":"...","description":"...","timeToComplete":"...","expectedImpact":"...","difficulty":"...","estimatedROI":"..."}],"competitorIntel":"what competitors do that this business doesn't","quickWins":["3 free fixes today"],"monthlyGoal":"one measurable goal"}
ONLY valid JSON.`;

  try {
    const res = await axios.post('https://api.anthropic.com/v1/messages', { model: 'claude-haiku-4-5-20251001', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 20000 });
    const text = res.data?.content?.[0]?.text || '';
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : { executiveSummary: text, topPriorities: [], quickWins: [], monthlyGoal: '', revenueImpact: '', competitorIntel: '' };
  } catch (e) { console.error('[SCAN] AI:', e.message); return { executiveSummary: '', topPriorities: [], quickWins: [], monthlyGoal: '', revenueImpact: '', competitorIntel: '' }; }
}

// ══════════════════════════════════════
// FULL SCAN
// ══════════════════════════════════════
async function runFullScan({ businessName, city, state, website, facebookUrl, industry, biggestChallenge }) {
  console.log(`[SCAN] ═══ FULL 12-PLATFORM AUDIT: ${businessName}, ${city} ═══`);
  const t0 = Date.now();

  // ── OUTSCRAPER: Get social URLs + enriched data in ONE call ──
  const outscraperData = await outscraperSearch(`${businessName} ${city} ${state}`).catch(() => null);

  // Also get contacts from website domain
  const websiteDomain = (outscraperData?.site || website || '').replace(/https?:\/\//, '').split('/')[0];
  const contactsData = websiteDomain ? await outscraperContacts(websiteDomain).catch(() => null) : null;

  // Merge social URLs from both sources
  const socialUrls = {
    facebook: facebookUrl || outscraperData?.facebook || contactsData?.socials?.facebook || null,
    instagram: outscraperData?.instagram || contactsData?.socials?.instagram || null,
    twitter: outscraperData?.twitter || contactsData?.socials?.twitter || null,
    linkedin: outscraperData?.linkedin || contactsData?.socials?.linkedin || null,
    youtube: outscraperData?.youtube || contactsData?.socials?.youtube || null,
    yelp: outscraperData?.yelp || null,
  };
  console.log(`[SCAN] Social URLs: ${JSON.stringify(socialUrls)}`);

  // Google is required
  let googleData;
  try { googleData = await checkGoogle(businessName, city, state); }
  catch (e) { console.error('[SCAN] Google CRASH:', e.message); return { error: 'Google check failed.', businessName, city, state, scannedAt: new Date().toISOString() }; }

  // Enrich Google data with Outscraper extras
  if (outscraperData) {
    if (outscraperData.photos_count && outscraperData.photos_count > googleData.photoCount) googleData.photoCount = outscraperData.photos_count;
    if (!googleData.hasDescription && outscraperData.description) { googleData.hasDescription = true; }
  }

  const siteUrl = website || googleData.website || outscraperData?.site || null;

  // Parallel checks — pass Outscraper URLs to Facebook and Yelp
  const [webR, fbR, yelpR, bingR, appleR, bbbR, compR] = await Promise.allSettled([
    checkWebsite(siteUrl).catch(e => ({ found: false, rawScore: 0, maxScore: 25, score: 0, findings: [] })),
    checkFacebook(businessName, city, state, socialUrls.facebook, outscraperData).catch(e => ({ found: false, rawScore: 0, maxScore: 15, score: 0, findings: [] })),
    checkYelp(businessName, city, state, socialUrls.yelp).catch(e => ({ found: false, rawScore: 0, maxScore: 15, score: 0, findings: [] })),
    checkBing(businessName, city, state, googleData.phone).catch(e => ({ rawScore: 0, maxScore: 5, findings: [] })),
    checkAppleMaps(businessName, city, state).catch(e => ({ rawScore: 0, maxScore: 5, findings: [] })),
    checkBBB(businessName, city, state).catch(e => ({ rawScore: 0, maxScore: 5, findings: [] })),
    checkCompetitors(businessName, city, state, googleData).catch(e => ({ competitors: [], ranking: null })),
  ]);

  const v = r => r.status === 'fulfilled' ? r.value : (r.reason ? {} : {});
  const websiteData = v(webR), facebookData = v(fbR), yelpData = v(yelpR), bingData = v(bingR), appleData = v(appleR), bbbData = v(bbbR), competitorData = v(compR);

  // Sequential checks
  const voiceAI = await checkVoiceAndAI(businessName, city, state, googleData, bingData, yelpData, appleData).catch(() => ({ voicePct: 0, appearsInAI: false, findings: [] }));
  const industryDirs = await checkIndustryDirs(businessName, city, state, googleData.types).catch(() => ({ findings: [] }));

  const platforms = { google: googleData, website: websiteData, facebook: facebookData, yelp: yelpData, bing: bingData, apple: appleData, bbb: bbbData };
  const overallScore = calculateScore(platforms);
  const scoreLabel = getScoreLabel(overallScore);

  const insights = await generateInsights(businessName, city, state, platforms, overallScore, { industry, biggestChallenge, competitors: competitorData, voicePct: voiceAI.voicePct, appearsInAI: voiceAI.appearsInAI });

  const sev = { critical: 0, warning: 1, good: 2 };
  const allFindings = [
    ...(googleData.findings || []), ...(websiteData.findings || []), ...(facebookData.findings || []),
    ...(yelpData.findings || []), ...(bingData.findings || []), ...(appleData.findings || []),
    ...(bbbData.findings || []), ...(voiceAI.findings || []), ...(industryDirs.findings || []),
  ].sort((a, b) => (sev[a.severity] ?? 9) - (sev[b.severity] ?? 9));

  const platformsFound = [googleData, websiteData, facebookData, yelpData].filter(p => p?.found).length;
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[SCAN] ═══ DONE in ${elapsed}s. Score: ${overallScore}/100. Findings: ${allFindings.length}. Platforms: ${platformsFound}/7 ═══`);

  return {
    businessName, city, state, scannedAt: new Date().toISOString(),
    overallScore, scoreLabel, platforms, competitors: competitorData,
    socialUrls,
    voiceSearch: { readiness: voiceAI.voicePct, appearsInAI: voiceAI.appearsInAI },
    allFindings,
    summary: insights.executiveSummary || '', revenueImpact: insights.revenueImpact || '',
    topPriorities: insights.topPriorities || [], competitorIntel: insights.competitorIntel || '',
    quickWins: insights.quickWins || [], monthlyGoal: insights.monthlyGoal || '',
    confidence: platformsFound >= 3 ? 'high' : platformsFound >= 2 ? 'medium' : 'low',
    dataQuality: { platformsFound, platformsChecked: 7, scanTime: elapsed, note: platformsFound >= 5 ? 'Comprehensive data' : platformsFound >= 3 ? 'Good coverage' : 'Limited data' },
  };
}

// ══════════════════════════════════════
// TEASER SCAN (under 5 seconds, under $0.03)
// ══════════════════════════════════════
async function runTeaserScan({ businessName, city, state }) {
  console.log(`[SCAN] Teaser: ${businessName}, ${city}`);
  try {
    const g = await checkGoogle(businessName, city, state);

    // Teaser scoring (100pts, Google only)
    let tScore = 0;
    // Rating (25pts)
    if (g.rating >= 4.8) tScore += 25; else if (g.rating >= 4.5) tScore += 20; else if (g.rating >= 4.0) tScore += 14; else if (g.rating >= 3.5) tScore += 8; else if (g.rating > 0) tScore += 3;
    // Review count (25pts)
    if (g.reviewCount >= 500) tScore += 25; else if (g.reviewCount >= 200) tScore += 20; else if (g.reviewCount >= 100) tScore += 15; else if (g.reviewCount >= 50) tScore += 10; else if (g.reviewCount >= 20) tScore += 6; else if (g.reviewCount > 0) tScore += 2;
    // Profile complete (25pts)
    if (g.hasHours) tScore += 5; if (g.hasWebsite) tScore += 5; if (g.hasPhone) tScore += 5; if (g.photoCount >= 10) tScore += 5; if (g.hasDescription) tScore += 5;
    // Recent activity (15pts)
    if (g.daysSinceReview <= 30) tScore += 15; else if (g.daysSinceReview <= 90) tScore += 10; else if (g.daysSinceReview <= 180) tScore += 5;
    // Status (10pts)
    if (g.businessStatus === 'OPERATIONAL') tScore += 10;
    tScore = Math.min(tScore, 100);

    // Worst 3 findings
    const tFindings = (g.findings || []).filter(f => f.severity !== 'good').slice(0, 3);
    if (tFindings.length === 0 && g.reviewCount < 50) tFindings.push(F('Google', 'warning', `${g.reviewCount} reviews — competitors may have more`, '', '', ''));

    // Top competitor peek
    let topCompetitor = null;
    try {
      const apiKey = process.env.GOOGLE_PLACES_API_KEY;
      if (apiKey && g.address) {
        const geoRes = await ax.get('https://maps.googleapis.com/maps/api/geocode/json', { params: { address: g.address, key: apiKey }, timeout: 4000 });
        const loc = geoRes.data?.results?.[0]?.geometry?.location;
        if (loc) {
          const type = g.types?.[0] || 'establishment';
          const nearRes = await ax.get('https://maps.googleapis.com/maps/api/place/nearbysearch/json', { params: { location: `${loc.lat},${loc.lng}`, radius: 8000, type, key: apiKey }, timeout: 4000 });
          const comp = (nearRes.data?.results || []).filter(p => p.place_id !== g.placeId && p.rating > 0).sort((a, b) => (b.user_ratings_total || 0) - (a.user_ratings_total || 0));
          if (comp[0]) topCompetitor = { name: comp[0].name, rating: comp[0].rating, reviewCount: comp[0].user_ratings_total || 0 };
        }
      }
    } catch {}

    // Talking points via Gemini
    let talkingPoints = [];
    try {
      const findingsList = tFindings.map(f => f.title).join('. ');
      const compLine = topCompetitor ? `Top competitor: ${topCompetitor.name} with ${topCompetitor.reviewCount} reviews and ${topCompetitor.rating} stars.` : '';
      const tpRes = await askGemini(`Generate 3 short sales talking points for a consultant showing this Google audit to a business owner. Score: ${tScore}/100. Findings: ${findingsList}. ${compLine} Make them conversational, urgent, specific. Each under 20 words. Return as JSON array of 3 strings.`, 6000);
      if (tpRes) { try { talkingPoints = JSON.parse(tpRes.match(/\[[\s\S]*\]/)?.[0] || '[]'); } catch { talkingPoints = [tpRes]; } }
    } catch {}

    return {
      type: 'teaser', teaser: true,
      businessName: g.name || businessName, city, state,
      scannedAt: new Date().toISOString(),
      preliminaryScore: tScore, scoreLabel: getScoreLabel(tScore),
      rating: g.rating, reviewCount: g.reviewCount,
      hasWebsite: g.hasWebsite, hasHours: g.hasHours, hasPhone: g.hasPhone,
      photoCount: g.photoCount, recentReview: g.daysSinceReview <= 90,
      address: g.address, phone: g.phone, website: g.website,
      categories: g.types, google: g,
      findings: tFindings, topCompetitor, talkingPoints,
      checksShown: 5, totalChecks: 47,
      note: 'Preliminary scan showing 5 of 47 checks. Full audit reveals Facebook, Yelp, Bing, BBB, Apple Maps, competitor ads, and more.',
    };
  } catch (e) { console.error('[SCAN] Teaser CRASH:', e.message); return { error: 'Scan failed.', businessName, city, state }; }
}

module.exports = { runFullScan, runTeaserScan };
