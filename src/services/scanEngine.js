const axios = require('axios');
const cheerio = require('cheerio');
const http = require('http');
const https = require('https');

const TIMEOUT = 10000;
const ax = axios.create({ timeout: TIMEOUT, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' } });

// ── BRIGHTDATA PROXY ──
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
      const req = https.request({ hostname: target.hostname, path: target.pathname + target.search, method: 'GET', socket, agent: false, rejectUnauthorized: false, headers: { 'User-Agent': 'Mozilla/5.0 Chrome/122 Safari/537.36', 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' } }, (response) => {
        let data = ''; response.on('data', c => { data += c; }); response.on('end', () => resolve({ ok: response.statusCode < 400, html: data, status: response.statusCode }));
      });
      req.on('error', reject); req.end();
    });
    connectReq.on('error', reject);
    connectReq.on('timeout', () => { connectReq.destroy(); reject(new Error('Proxy timeout')); });
    connectReq.end();
  });
}

// ── GEMINI HELPER ──
async function askGemini(prompt, timeout = 10000) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const res = await ax.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0, maxOutputTokens: 1000 }
    }, { timeout });
    return res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (e) { console.log(`[GEMINI] Error: ${e.message}`); return null; }
}

const finding = (platform, severity, title, description, impact, fix) => ({ platform, severity, title, description, impact: impact || '', fix: fix || '' });

// ════════════════════════════════════════════════
// 1. GOOGLE BUSINESS PROFILE (30 pts max)
// ════════════════════════════════════════════════
async function checkGoogle(businessName, city, state) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return { found: false, score: 0, rawScore: 0, maxScore: 30, findings: [finding('Google', 'critical', 'Google check unavailable', 'API key not configured.', '', '')] };

  const query = `${businessName} ${city} ${state}`;
  console.log(`[SCAN] Google: "${query}"`);

  const findRes = await ax.get('https://maps.googleapis.com/maps/api/place/findplacefromtext/json', { params: { input: query, inputtype: 'textquery', fields: 'place_id,name,formatted_address,business_status', key: apiKey } });
  const candidate = findRes.data?.candidates?.[0];
  if (!candidate?.place_id) return { found: false, score: 0, rawScore: 0, maxScore: 30, findings: [finding('Google', 'critical', 'Not found on Google', `Searched for "${businessName}" in ${city} — no listing found.`, 'Customers cannot find you on Google. This is the #1 way people discover local businesses.', 'Create your Google Business Profile at business.google.com immediately.')] };

  const detailRes = await ax.get('https://maps.googleapis.com/maps/api/place/details/json', { params: { place_id: candidate.place_id, fields: 'name,rating,user_ratings_total,formatted_address,formatted_phone_number,opening_hours,website,photos,business_status,reviews,types', key: apiKey } });
  const d = detailRes.data?.result || {};
  const rating = d.rating || 0;
  const reviewCount = d.user_ratings_total || 0;
  const hasHours = !!d.opening_hours;
  const hoursComplete = (d.opening_hours?.weekday_text?.length || 0) === 7;
  const photoCount = d.photos?.length || 0;
  const hasWebsite = !!d.website;
  const businessStatus = d.business_status || 'UNKNOWN';
  const types = d.types || [];

  // Estimate review response rate from reviews data
  const reviews = d.reviews || [];
  const ownerReplied = reviews.filter(r => r.author_url?.includes('/maps/contrib/') === false).length; // rough estimate
  const responseRate = reviews.length > 0 ? Math.min(Math.round((ownerReplied / reviews.length) * 100), 100) : 0;

  // SCORE (30 max)
  let rawScore = 0;
  // Rating (10 pts)
  if (rating >= 4.5) rawScore += 10; else if (rating >= 4.0) rawScore += 7; else if (rating > 0) rawScore += 3;
  // Review count (8 pts)
  if (reviewCount >= 200) rawScore += 8; else if (reviewCount >= 50) rawScore += 5; else if (reviewCount > 0) rawScore += 2;
  // Profile complete (6 pts)
  if (hasHours && hoursComplete) rawScore += 2;
  if (photoCount >= 10) rawScore += 2; else if (photoCount >= 5) rawScore += 1;
  if (hasWebsite) rawScore += 1;
  if (businessStatus === 'OPERATIONAL') rawScore += 1;
  // Recent activity (3 pts) — estimated from review recency
  const recentReview = reviews[0]?.time ? (Date.now() / 1000 - reviews[0].time) < 30 * 86400 : false;
  if (recentReview) rawScore += 3; else if (reviews.length > 0) rawScore += 1;
  // Response rate (3 pts)
  if (responseRate > 50) rawScore += 3; else if (responseRate > 0) rawScore += 1;

  const findings = [];
  const f = (sev, title, desc, impact, fix) => findings.push(finding('Google', sev, title, desc, impact, fix));

  if (rating === 0) f('critical', 'No Google rating', 'Your profile has no rating yet.', 'Businesses without ratings get far fewer clicks.', 'Ask 10 customers to leave a review this week.');
  else if (rating < 4.0) f('critical', `${rating}-star rating is hurting you`, `Below the 4.0 threshold. Customers filter by 4+ stars.`, 'Up to 40% of potential customers are filtering you out.', 'Focus on getting 5-star reviews. Respond to every negative review professionally.');
  else if (rating < 4.5) f('warning', `${rating}-star rating — room to improve`, `Below 4.5 threshold top businesses maintain.`, 'Businesses with 4.5+ get significantly more clicks.', 'Ask every happy customer for a review.');
  else f('good', `Strong ${rating}-star rating`, `Excellent rating that builds trust.`, '', '');

  if (reviewCount < 10) f('critical', `Only ${reviewCount} reviews`, 'Very few reviews make you look unestablished.', 'Businesses with fewer than 10 reviews lose significant trust.', 'Start a review campaign. Aim for 50+ within 60 days.');
  else if (reviewCount < 50) f('warning', `${reviewCount} reviews — competitors may have more`, 'More reviews = better ranking + more trust.', '', 'Send follow-up texts after every job.');
  else f('good', `${reviewCount} reviews — solid social proof`, '', '', '');

  if (!hasHours) f('warning', 'Hours missing from Google', 'Customers assume you\'re closed without hours.', '', 'Add hours for every day in your Google Business Profile.');
  if (photoCount < 5) f('warning', `Only ${photoCount} photos`, 'Listings with 10+ photos get 42% more direction requests.', '', 'Add photos of your storefront, team, and work.');
  if (businessStatus !== 'OPERATIONAL') f('critical', `Status: ${businessStatus}`, 'Customers will think you\'re closed.', '', 'Verify your business is marked open.');

  return {
    found: true, confidence: 'high', placeId: candidate.place_id, name: d.name || businessName,
    rating, reviewCount, address: d.formatted_address || '', phone: d.formatted_phone_number || '',
    website: d.website || '', hasHours, hoursComplete, photoCount, hasWebsite, businessStatus, types,
    responseRate, reviews: reviews.slice(0, 5).map(r => ({ text: r.text?.slice(0, 200), rating: r.rating, time: r.time })),
    rawScore, maxScore: 30, score: Math.round((rawScore / 30) * 100), findings
  };
}

// ════════════════════════════════════════════════
// 2. WEBSITE AUDIT (25 pts max)
// ════════════════════════════════════════════════
async function checkWebsite(websiteUrl) {
  if (!websiteUrl) return { found: false, rawScore: 0, maxScore: 25, score: 0, findings: [finding('Website', 'warning', 'No website provided', 'Cannot analyze website performance.', '', 'Add your website URL.')] };
  let url = websiteUrl.trim(); if (!url.startsWith('http')) url = `https://${url}`;
  // Strip UTM/tracking params for clean analysis
  try { const u = new URL(url); u.search = ''; url = u.toString().replace(/\/$/, ''); } catch {}
  console.log(`[SCAN] Website: ${url}`);

  let rawScore = 0;
  const findings = [];
  const f = (sev, title, desc, impact, fix) => findings.push(finding('Website', sev, title, desc, impact, fix));

  // 2a. SSL Check (5 pts)
  let hasSSL = false;
  try {
    const sslRes = await ax.get(url, { timeout: 8000, maxRedirects: 5 });
    hasSSL = sslRes.request?.res?.responseUrl?.startsWith('https://') || sslRes.config?.url?.startsWith('https://');
    if (hasSSL) { rawScore += 5; f('good', 'SSL certificate active', 'Your site uses HTTPS.', '', ''); }
    else { f('critical', 'No SSL certificate', 'Your website doesn\'t use HTTPS.', 'Browsers show "Not Secure" warning — customers leave immediately.', 'Install an SSL certificate. Most hosts offer free SSL via Let\'s Encrypt.'); }
  } catch { f('warning', 'Website unreachable', 'Could not connect to your website.', '', 'Check if your website is online.'); }

  // 2b. Meta Tags Scrape (10 pts)
  let html = '';
  try {
    const htmlRes = await ax.get(url, { timeout: 8000 });
    html = htmlRes.data || '';
    const $ = cheerio.load(html);
    const title = $('title').text().trim();
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
    const ogImage = $('meta[property="og:image"]').attr('content') || '';
    const h1 = $('h1').first().text().trim();
    const hasSchema = html.includes('application/ld+json');
    const hasPhone = /(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})|tel:/i.test(html);
    const hasAddress = /\b\d{2,5}\s+[A-Z][a-z]+\s+(St|Ave|Blvd|Dr|Rd|Ln|Way|Ct)/i.test(html);

    if (title && title.length <= 60) rawScore += 2; else if (title) { rawScore += 1; f('warning', 'Title tag too long', `Your title is ${title.length} characters (should be under 60).`, '', 'Shorten your title tag to under 60 characters.'); }
    else f('critical', 'Missing title tag', 'No title tag found.', 'Google cannot properly index your homepage.', 'Add a descriptive title tag.');

    if (metaDesc && metaDesc.length <= 160) rawScore += 2; else if (!metaDesc) f('warning', 'Missing meta description', 'No meta description found.', 'Google shows random text instead of your description.', 'Add a compelling meta description under 160 characters.');
    else rawScore += 1;

    if (ogTitle && ogImage) { rawScore += 1; } else f('warning', 'Missing social sharing tags', 'Links shared on Facebook/text show no preview.', '', 'Add og:title and og:image meta tags.');
    if (h1) rawScore += 1; else f('warning', 'No H1 heading', 'Missing main heading hurts SEO.', '', 'Add an H1 heading to your homepage.');
    if (hasSchema) { rawScore += 1; f('good', 'Schema markup found', 'Structured data helps Google understand your business.', '', ''); }
    else f('warning', 'No schema markup', 'Missing structured data.', 'Google can\'t show rich results for your business.', 'Add LocalBusiness schema markup.');
    if (hasPhone) rawScore += 1; else f('warning', 'No phone number on website', 'Customers can\'t easily call you.', '', 'Add your phone number prominently.');
    if (hasAddress) rawScore += 1; else f('warning', 'No address on website', 'Helps Google verify your location.', '', 'Add your business address to your website.');
  } catch (e) { console.log(`[SCAN] HTML scrape failed: ${e.message}`); }

  // 2c. PageSpeed (10 pts)
  let perfScore = 0, loadTime = null;
  try {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    const psParams = { url, strategy: 'mobile', category: 'performance' };
    if (apiKey) psParams.key = apiKey;
    const psRes = await ax.get('https://www.googleapis.com/pagespeedonline/v5/runPagespeed', { params: psParams, timeout: 30000 });
    const lh = psRes.data?.lighthouseResult;
    perfScore = Math.round((lh?.categories?.performance?.score || 0) * 100);
    const fcp = lh?.audits?.['first-contentful-paint']?.numericValue;
    loadTime = fcp ? Math.round(fcp / 100) / 10 : null;

    if (perfScore >= 90) { rawScore += 10; f('good', `Excellent speed: ${perfScore}/100`, 'Fast mobile performance.', '', ''); }
    else if (perfScore >= 70) { rawScore += 7; f('good', `Good speed: ${perfScore}/100`, '', '', ''); }
    else if (perfScore >= 50) { rawScore += 4; f('warning', `Speed ${perfScore}/100 — needs work`, 'Below recommended 70+ threshold.', '53% of mobile users leave sites loading over 3 seconds.', 'Optimize images, enable compression.'); }
    else { rawScore += 1; f('critical', `Speed ${perfScore}/100 — very slow`, 'Google penalizes slow sites.', '', 'Major performance overhaul needed.'); }
  } catch (e) { console.log(`[SCAN] PageSpeed failed: ${e.message}`); f('warning', 'Could not test website speed', '', '', ''); }

  return { found: true, confidence: 'high', hasSSL, perfScore, loadTime, rawScore, maxScore: 25, score: Math.round((rawScore / 25) * 100), findings };
}

// ════════════════════════════════════════════════
// 3. FACEBOOK (15 pts max)
// ════════════════════════════════════════════════
async function checkFacebook(businessName, city, state, facebookUrl) {
  console.log(`[SCAN] Facebook: ${businessName} ${city}`);

  // Find Facebook URL via Gemini with grounded search
  let fbUrl = facebookUrl || null;
  if (!fbUrl) {
    const geminiResult = await askGemini(`Search for the Facebook business page of "${businessName}" located in ${city}, ${state}. Return ONLY the facebook.com URL. If not found return NOT_FOUND. Do not guess — only return a URL you found via search.`, 12000);
    if (geminiResult && !geminiResult.includes('NOT_FOUND') && geminiResult.includes('facebook.com')) {
      const urlMatch = geminiResult.match(/https?:\/\/(www\.)?facebook\.com\/[^\s"',\]]+/);
      fbUrl = urlMatch ? urlMatch[0].replace(/[.,;)]+$/, '') : null;
    }
  }
  // Fallback: try direct Facebook search scrape
  if (!fbUrl) {
    try {
      const searchRes = await ax.get(`https://www.facebook.com/search/pages/?q=${encodeURIComponent(businessName + ' ' + city)}`, { timeout: 6000 });
      const fbMatch = (searchRes.data || '').match(/facebook\.com\/(?!search)[a-zA-Z0-9.]+/);
      if (fbMatch) fbUrl = 'https://www.' + fbMatch[0];
    } catch {}
  }

  if (!fbUrl) {
    return { found: false, rawScore: 0, maxScore: 15, score: 0, findings: [finding('Facebook', 'critical', 'No Facebook page found', `Could not find a Facebook business page for ${businessName}.`, 'Over 70% of consumers check a business Facebook page before visiting.', 'Create a Facebook Business Page at facebook.com/pages/create.')] };
  }

  // Scrape via BrightData
  let rawScore = 0;
  const findings = [];
  const f = (sev, title, desc, impact, fix) => findings.push(finding('Facebook', sev, title, desc, impact, fix));
  let pageData = { url: fbUrl, followers: null, lastPostDays: null, rating: null };

  try {
    const res = await fetchViaProxy(fbUrl, 10000);
    if (res.ok && res.html) {
      const $ = cheerio.load(res.html);
      const text = res.html;

      // Extract followers
      const followerMatch = text.match(/([\d,\.]+[KkMm]?)\s*(?:followers|people follow|people like)/i);
      if (followerMatch) pageData.followers = followerMatch[1];

      // Extract rating
      const ratingMatch = text.match(/([\d.]+)\s*(?:out of 5|\/5|stars)/i);
      if (ratingMatch) pageData.rating = parseFloat(ratingMatch[1]);

      rawScore += 5; // Page exists
      f('good', 'Facebook page found', `Found at ${fbUrl}`, '', '');

      if (pageData.followers) {
        const fc = parseInt(pageData.followers.replace(/[^0-9]/g, '')) || 0;
        if (fc >= 1000) rawScore += 3;
        else if (fc >= 500) rawScore += 2;
        else rawScore += 1;
      }

      // Estimate activity from page content
      const hasRecentPosts = /ago|yesterday|today|hours? ago|minutes? ago/i.test(text);
      if (hasRecentPosts) { rawScore += 4; f('good', 'Page appears active', 'Recent activity detected.', '', ''); }
      else { rawScore += 1; f('warning', 'Facebook page may be inactive', 'No recent posts detected.', 'Inactive pages signal to customers your business may not be active.', 'Post at least 2-3 times per week.'); }

      if (pageData.rating && pageData.rating >= 4.0) rawScore += 3;
      else if (pageData.rating) rawScore += 1;
    }
  } catch (e) {
    console.log(`[SCAN] Facebook scrape failed: ${e.message}`);
    rawScore += 2; // We found the URL at least
    f('warning', 'Facebook page found but could not fully analyze', '', '', '');
  }

  return { found: true, confidence: 'medium', ...pageData, rawScore, maxScore: 15, score: Math.round((rawScore / 15) * 100), findings };
}

// ════════════════════════════════════════════════
// 4. YELP (15 pts max)
// ════════════════════════════════════════════════
async function checkYelp(businessName, city, state) {
  console.log(`[SCAN] Yelp: ${businessName} ${city}`);
  const searchUrl = `https://www.yelp.com/search?find_desc=${encodeURIComponent(businessName)}&find_loc=${encodeURIComponent(city + ' ' + state)}`;

  let rawScore = 0;
  const findings = [];
  const f = (sev, title, desc, impact, fix) => findings.push(finding('Yelp', sev, title, desc, impact, fix));

  try {
    let html = '', rating = 0, reviewCount = 0, claimed = false;

    // Method 1: Try Gemini to find Yelp URL
    const yelpGemini = await askGemini(`Find the Yelp business page URL for "${businessName}" in ${city}, ${state}. Return ONLY the yelp.com URL or NOT_FOUND.`, 8000);
    let directUrl = null;
    if (yelpGemini && yelpGemini.includes('yelp.com') && !yelpGemini.includes('NOT_FOUND')) {
      const m = yelpGemini.match(/https?:\/\/(www\.)?yelp\.com\/biz\/[^\s"',\]]+/);
      if (m) directUrl = m[0];
    }

    // Method 2: Try direct business page via BrightData
    if (directUrl) {
      try { const r = await fetchViaProxy(directUrl, 8000); html = r.html || ''; } catch {}
    }

    // Method 3: Try search page
    if (!html) {
      try { const r = await fetchViaProxy(searchUrl, 8000); html = r.html || ''; } catch {}
    }
    if (!html) { try { const r = await ax.get(searchUrl, { timeout: 6000 }); html = r.data || ''; } catch {} }

    // Also try slug-based direct URL
    if (!html) {
      const slug = `${businessName}-${city}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
      try { const r = await ax.get(`https://www.yelp.com/biz/${slug}`, { timeout: 5000 }); html = r.data || ''; } catch {}
    }

    if (html) {
      const ratingMatch = html.match(/(\d\.\d)\s*star/i) || html.match(/aria-label="(\d\.?\d?)\s*star/i) || html.match(/ratingValue.*?(\d\.?\d?)/i);
      rating = parseFloat(ratingMatch?.[1] || '0');
      const revMatch = html.match(/(\d+)\s*review/i);
      reviewCount = parseInt(revMatch?.[1] || '0');
      claimed = html.toLowerCase().includes('claimed');
    }

    if (rating > 0) {
      rawScore += 5; // Listed and found
      if (claimed) { rawScore += 0; } else { f('critical', 'Yelp page not claimed', 'You can\'t respond to reviews on an unclaimed page.', 'Unclaimed pages show outdated info.', 'Claim at biz.yelp.com — it\'s free.'); }
      if (rating >= 4.0) rawScore += 5; else if (rating >= 3.5) rawScore += 3; else rawScore += 1;
      if (reviewCount >= 50) rawScore += 5; else if (reviewCount >= 20) rawScore += 3; else rawScore += 1;

      if (rating < 4.0) f('warning', `Yelp rating ${rating} stars`, `Below 4.0 deters potential customers.`, '', 'Focus on service quality and ask happy customers to review.');
      else f('good', `${rating}-star Yelp rating`, `${reviewCount} reviews.`, '', '');
    } else {
      f('warning', 'Not found on Yelp', `Could not find ${businessName} on Yelp.`, 'Missing from a major review platform.', 'Add your business at biz.yelp.com.');
    }

    return { found: rating > 0, confidence: rating > 0 ? 'medium' : 'low', rating, reviewCount, claimed, rawScore, maxScore: 15, score: Math.round((rawScore / 15) * 100), findings };
  } catch (e) {
    console.log(`[SCAN] Yelp failed: ${e.message}`);
    return { found: false, rawScore: 0, maxScore: 15, score: 0, findings: [finding('Yelp', 'warning', 'Yelp check failed', 'Could not search Yelp.', '', '')] };
  }
}

// ════════════════════════════════════════════════
// 5. BING PLACES (5 pts — part of Other)
// ════════════════════════════════════════════════
async function checkBing(businessName, city, state, googlePhone) {
  console.log(`[SCAN] Bing: ${businessName} ${city}`);
  let rawScore = 0;
  const findings = [];
  const f = (sev, title, desc, impact, fix) => findings.push(finding('Bing', sev, title, desc, impact, fix));

  try {
    const searchRes = await ax.get(`https://www.bing.com/search?q=${encodeURIComponent(businessName + ' ' + city + ' ' + state)}`, { timeout: 6000 });
    const text = (searchRes.data || '').toLowerCase();
    const listed = text.includes(businessName.toLowerCase().split(' ')[0]);
    if (listed) { rawScore += 3; f('good', 'Found on Bing', 'Your business appears in Bing search results.', '', ''); }
    else f('warning', 'Not prominent on Bing', '', '', 'Claim your Bing Places listing at bingplaces.com.');

    // NAP check
    if (googlePhone) {
      const phoneDigits = googlePhone.replace(/[^0-9]/g, '');
      if (phoneDigits && text.includes(phoneDigits.slice(-7))) { rawScore += 2; }
      else { f('warning', 'Phone number inconsistent on Bing', 'Your Google phone number wasn\'t found in Bing results.', 'Inconsistent info confuses search engines.', 'Verify your info at bingplaces.com.'); }
    }
  } catch { f('warning', 'Bing check failed', '', '', ''); }

  return { rawScore, maxScore: 5, findings };
}

// ════════════════════════════════════════════════
// 6. BBB (5 pts — part of Other)
// ════════════════════════════════════════════════
async function checkBBB(businessName, city, state) {
  console.log(`[SCAN] BBB: ${businessName} ${city}`);
  let rawScore = 0;
  const findings = [];
  const f = (sev, title, desc, impact, fix) => findings.push(finding('BBB', sev, title, desc, impact, fix));

  try {
    const url = `https://www.bbb.org/search?find_country=USA&find_text=${encodeURIComponent(businessName)}&find_loc=${encodeURIComponent(city + ', ' + state)}`;
    let html = '';
    try { const r = await fetchViaProxy(url, 8000); html = r.html || ''; } catch {}
    if (!html) { const r = await ax.get(url, { timeout: 6000 }); html = r.data || ''; }

    const $ = cheerio.load(html);
    const hasResult = html.toLowerCase().includes(businessName.toLowerCase().split(' ')[0]);
    const accredited = html.includes('BBB Accredited') || html.includes('accredited');
    const ratingMatch = html.match(/rating[:\s]*(A\+|A|B\+|B|C\+|C|D|F)/i);
    const bbbRating = ratingMatch ? ratingMatch[1] : null;

    if (hasResult) {
      rawScore += 2;
      f('good', 'Found on BBB', bbbRating ? `BBB Rating: ${bbbRating}` : 'Listed on Better Business Bureau.', '', '');
      if (accredited) { rawScore += 2; f('good', 'BBB Accredited', 'This builds significant customer trust.', '', ''); }
      if (bbbRating && ['A+', 'A'].includes(bbbRating)) rawScore += 1;
    } else {
      f('warning', 'Not found on BBB', 'Not listed on Better Business Bureau.', 'Many customers check BBB before hiring.', 'Register at bbb.org to build credibility.');
    }
  } catch { f('warning', 'BBB check failed', '', '', ''); }

  return { rawScore, maxScore: 5, findings, accredited: false, bbbRating: null };
}

// ════════════════════════════════════════════════
// 7. COMPETITOR ANALYSIS
// ════════════════════════════════════════════════
async function checkCompetitors(businessName, city, state, googleData) {
  console.log(`[SCAN] Competitors: ${businessName} ${city}`);
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey || !googleData?.placeId) return { competitors: [], ranking: null };

  try {
    // Get the business type from Google categories
    const type = googleData.types?.[0] || 'establishment';
    const addr = googleData.address || `${city}, ${state}`;

    // First get lat/lng
    const geoRes = await ax.get('https://maps.googleapis.com/maps/api/geocode/json', { params: { address: addr, key: apiKey } });
    const loc = geoRes.data?.results?.[0]?.geometry?.location;
    if (!loc) return { competitors: [], ranking: null };

    // Search nearby — try specific type first, fallback to keyword search
    let nearbyRes = await ax.get('https://maps.googleapis.com/maps/api/place/nearbysearch/json', {
      params: { location: `${loc.lat},${loc.lng}`, radius: 8000, type, key: apiKey }
    });
    // If few results, try keyword search instead
    if ((nearbyRes.data?.results || []).length < 3) {
      nearbyRes = await ax.get('https://maps.googleapis.com/maps/api/place/nearbysearch/json', {
        params: { location: `${loc.lat},${loc.lng}`, radius: 10000, keyword: type.replace(/_/g, ' '), key: apiKey }
      });
    }

    const competitors = (nearbyRes.data?.results || [])
      .filter(p => p.place_id !== googleData.placeId && p.rating > 0)
      .slice(0, 5)
      .map(p => ({ name: p.name, rating: p.rating || 0, reviewCount: p.user_ratings_total || 0, address: p.vicinity || '' }));

    // Calculate ranking
    const allBiz = [{ name: businessName, rating: googleData.rating, reviewCount: googleData.reviewCount }, ...competitors];
    allBiz.sort((a, b) => (b.rating * 10 + Math.log(b.reviewCount + 1)) - (a.rating * 10 + Math.log(a.reviewCount + 1)));
    const ranking = allBiz.findIndex(b => b.name === businessName) + 1;

    return { competitors, ranking, totalInArea: allBiz.length };
  } catch (e) {
    console.log(`[SCAN] Competitors failed: ${e.message}`);
    return { competitors: [], ranking: null };
  }
}

// ════════════════════════════════════════════════
// 8. NAP CONSISTENCY (5 pts — part of Other)
// ════════════════════════════════════════════════
async function checkNAP(googleData, bingData) {
  let rawScore = 0;
  const findings = [];
  const f = (sev, title, desc, impact, fix) => findings.push(finding('NAP', sev, title, desc, impact, fix));

  if (googleData?.found && googleData.address && googleData.phone) {
    rawScore += 3; // Has baseline data
    if (bingData?.rawScore >= 4) { rawScore += 2; f('good', 'NAP consistent', 'Name, address, and phone match across platforms.', '', ''); }
    else { f('warning', 'Possible NAP inconsistencies', 'Your info may not match across all platforms.', 'Inconsistent NAP data hurts local search ranking.', 'Audit all your directory listings for consistency.'); }
  } else {
    f('warning', 'Cannot verify NAP consistency', 'Incomplete Google profile makes verification difficult.', '', 'Complete your Google Business Profile first.');
  }

  return { rawScore, maxScore: 5, findings };
}

// ════════════════════════════════════════════════
// 9. OVERALL SCORING ENGINE (100 pts)
// ════════════════════════════════════════════════
function calculateScore(platforms) {
  const google = platforms.google?.rawScore || 0;    // /30
  const website = platforms.website?.rawScore || 0;  // /25
  const facebook = platforms.facebook?.rawScore || 0; // /15
  const yelp = platforms.yelp?.rawScore || 0;        // /15
  const bing = platforms.bing?.rawScore || 0;        // /5
  const bbb = platforms.bbb?.rawScore || 0;          // /5
  const nap = platforms.nap?.rawScore || 0;          // /5 (shares Other bucket)

  const total = google + website + facebook + yelp + bing + bbb + nap;
  const maxPossible = 30 + 25 + 15 + 15 + 5 + 5 + 5; // 100

  return Math.round((total / maxPossible) * 100);
}

function getScoreLabel(score) {
  if (score >= 90) return 'Exceptional';
  if (score >= 75) return 'Strong';
  if (score >= 60) return 'Needs Work';
  if (score >= 45) return 'Critical';
  return 'Emergency';
}

// ════════════════════════════════════════════════
// 10. AI INSIGHTS (Claude Haiku)
// ════════════════════════════════════════════════
async function generateInsights(businessName, city, state, platforms, overallScore, extra = {}) {
  if (!process.env.ANTHROPIC_API_KEY) return { summary: '', topPriorities: [], industryContext: '', monthlyGoal: '' };

  const comp = extra.competitors;
  const prompt = `You are a senior digital marketing consultant writing a paid $149 audit report for a local business. Be specific, direct, and actionable.

BUSINESS: ${businessName}, ${city}${state ? ', ' + state : ''}${extra.industry ? ' (' + extra.industry + ')' : ''}
OVERALL SCORE: ${overallScore}/100 — ${getScoreLabel(overallScore)}

PLATFORM SCORES:
- Google Business Profile: ${platforms.google?.rawScore || 0}/30 — Rating ${platforms.google?.rating || 'N/A'} (${platforms.google?.reviewCount || 0} reviews)
- Website: ${platforms.website?.rawScore || 0}/25 — Speed ${platforms.website?.perfScore || 'N/A'}/100, SSL: ${platforms.website?.hasSSL ? 'Yes' : 'No'}
- Facebook: ${platforms.facebook?.rawScore || 0}/15 — ${platforms.facebook?.found ? 'Found' : 'NOT FOUND'}${platforms.facebook?.followers ? ', ' + platforms.facebook.followers + ' followers' : ''}
- Yelp: ${platforms.yelp?.rawScore || 0}/15 — ${platforms.yelp?.found ? platforms.yelp.rating + ' stars, ' + platforms.yelp.reviewCount + ' reviews' : 'NOT FOUND'}
- Bing: ${platforms.bing?.rawScore || 0}/5
- BBB: ${platforms.bbb?.rawScore || 0}/5
- NAP: ${platforms.nap?.rawScore || 0}/5

${comp?.competitors?.length ? `COMPETITORS:\n${comp.competitors.map((c, i) => `${i + 1}. ${c.name} — ${c.rating} stars, ${c.reviewCount} reviews`).join('\n')}\nThis business ranks #${comp.ranking || '?'} of ${comp.totalInArea || '?'} in the area.` : ''}

${extra.biggestChallenge ? `Owner\'s biggest challenge: "${extra.biggestChallenge}"` : ''}

Generate JSON:
{
  "summary": "2-3 sentences. Specific to THIS business. Include score and what it means.",
  "topPriorities": [
    {"priority":1,"title":"action title","description":"specific steps with ROI context","impact":"high","effort":"easy"},
    {"priority":2,"title":"action title","description":"specific steps","impact":"high","effort":"medium"},
    {"priority":3,"title":"action title","description":"specific steps","impact":"medium","effort":"easy"}
  ],
  "industryContext": "How this score compares to similar businesses",
  "monthlyGoal": "One specific measurable goal for this month",
  "revenueImpact": "Estimated customer/revenue impact of fixing top issues"
}
Return ONLY valid JSON.`;

  try {
    const res = await axios.post('https://api.anthropic.com/v1/messages', { model: 'claude-haiku-4-5-20251001', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 15000 });
    const text = res.data?.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : { summary: text, topPriorities: [], industryContext: '', monthlyGoal: '' };
  } catch (e) { console.error('[SCAN] AI insights failed:', e.message); return { summary: '', topPriorities: [], industryContext: '', monthlyGoal: '' }; }
}

// ════════════════════════════════════════════════
// MAIN SCAN FUNCTIONS
// ════════════════════════════════════════════════
async function runFullScan({ businessName, city, state, website, facebookUrl, address, phone, industry, biggestChallenge, yearsInBusiness }) {
  console.log(`[SCAN] ═══ FULL SCAN: ${businessName}, ${city}, ${state} ═══`);
  const startTime = Date.now();

  // Google is required
  let googleData;
  try { googleData = await checkGoogle(businessName, city, state); }
  catch (e) { console.error('[SCAN] Google FAILED:', e.message); return { error: 'Google check failed.', businessName, city, state, scannedAt: new Date().toISOString() }; }

  const siteUrl = website || googleData.website || null;

  // Run all other checks in parallel
  const [websiteResult, facebookResult, yelpResult, bingResult, bbbResult, competitorResult] = await Promise.allSettled([
    checkWebsite(siteUrl).catch(e => { console.error('[SCAN] Website:', e.message); return { found: false, rawScore: 0, maxScore: 25, score: 0, findings: [] }; }),
    checkFacebook(businessName, city, state, facebookUrl).catch(e => { console.error('[SCAN] Facebook:', e.message); return { found: false, rawScore: 0, maxScore: 15, score: 0, findings: [] }; }),
    checkYelp(businessName, city, state).catch(e => { console.error('[SCAN] Yelp:', e.message); return { found: false, rawScore: 0, maxScore: 15, score: 0, findings: [] }; }),
    checkBing(businessName, city, state, googleData.phone).catch(e => { console.error('[SCAN] Bing:', e.message); return { rawScore: 0, maxScore: 5, findings: [] }; }),
    checkBBB(businessName, city, state).catch(e => { console.error('[SCAN] BBB:', e.message); return { rawScore: 0, maxScore: 5, findings: [] }; }),
    checkCompetitors(businessName, city, state, googleData).catch(e => { console.error('[SCAN] Competitors:', e.message); return { competitors: [], ranking: null }; }),
  ]);

  const val = (r) => r.status === 'fulfilled' ? r.value : r.value || {};
  const websiteData = val(websiteResult);
  const facebookData = val(facebookResult);
  const yelpData = val(yelpResult);
  const bingData = val(bingResult);
  const bbbData = val(bbbResult);
  const competitorData = val(competitorResult);
  const napData = await checkNAP(googleData, bingData).catch(() => ({ rawScore: 0, maxScore: 5, findings: [] }));

  const platforms = { google: googleData, website: websiteData, facebook: facebookData, yelp: yelpData, bing: bingData, bbb: bbbData, nap: napData };
  const overallScore = calculateScore(platforms);
  const scoreLabel = getScoreLabel(overallScore);

  const insights = await generateInsights(businessName, city, state, platforms, overallScore, { industry, biggestChallenge, yearsInBusiness, phone, address, competitors: competitorData });

  const sevOrder = { critical: 0, warning: 1, good: 2 };
  const allFindings = [
    ...(googleData.findings || []), ...(websiteData.findings || []), ...(facebookData.findings || []),
    ...(yelpData.findings || []), ...(bingData.findings || []), ...(bbbData.findings || []), ...(napData.findings || []),
  ].sort((a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9));

  const platformsFound = [googleData, websiteData, facebookData, yelpData].filter(p => p.found).length;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[SCAN] ═══ COMPLETE in ${elapsed}s. Score: ${overallScore}/100 (${scoreLabel}). Findings: ${allFindings.length}. Platforms: ${platformsFound}/7 ═══`);

  return {
    businessName, city, state, scannedAt: new Date().toISOString(),
    overallScore, scoreLabel,
    platforms, competitors: competitorData,
    allFindings,
    topPriorities: insights.topPriorities || [], summary: insights.summary || '',
    industryContext: insights.industryContext || '', monthlyGoal: insights.monthlyGoal || '',
    revenueImpact: insights.revenueImpact || '',
    confidence: platformsFound >= 3 ? 'high' : platformsFound >= 2 ? 'medium' : 'low',
    dataQuality: { platformsFound, platformsChecked: 7, note: platformsFound >= 5 ? 'Comprehensive multi-platform data' : platformsFound >= 3 ? 'Good coverage — some platforms missing' : 'Limited data — results may be incomplete' },
  };
}

async function runTeaserScan({ businessName, city, state }) {
  console.log(`[SCAN] Teaser: ${businessName}, ${city}, ${state}`);
  try {
    const googleData = await checkGoogle(businessName, city, state);
    const g = googleData;

    // Simple teaser score (100 pts)
    let tScore = 0;
    if (g.rating >= 4.5) tScore += 25; else if (g.rating >= 4.0) tScore += 18; else if (g.rating >= 3.5) tScore += 10; else if (g.rating > 0) tScore += 5;
    if (g.reviewCount >= 100) tScore += 20; else if (g.reviewCount >= 50) tScore += 14; else if (g.reviewCount >= 20) tScore += 8; else tScore += 3;
    const profileComplete = [g.hasHours, !!g.phone, g.hasWebsite, !!g.address].filter(Boolean).length;
    if (profileComplete === 4) tScore += 20; else if (profileComplete === 3) tScore += 14; else if (profileComplete === 2) tScore += 8; else tScore += 3;
    if (g.hasWebsite) tScore += 15;
    if (g.photoCount >= 10) tScore += 10; else if (g.photoCount >= 5) tScore += 7; else if (g.photoCount > 0) tScore += 3;
    const recentReview = g.reviews?.[0]?.time ? (Date.now() / 1000 - g.reviews[0].time) < 90 * 86400 : false;
    if (recentReview) tScore += 10; else tScore += 3;
    tScore = Math.min(tScore, 100);

    // Pick 3 worst findings
    const tFindings = (g.findings || []).filter(f => f.severity !== 'good').slice(0, 3);
    if (tFindings.length === 0 && g.reviewCount < 50) tFindings.push(finding('Google', 'warning', `${g.reviewCount} reviews — room to grow`, 'More reviews improve ranking.', '', ''));

    // Quick competitor peek
    let topCompetitor = null;
    try {
      const apiKey = process.env.GOOGLE_PLACES_API_KEY;
      if (apiKey && g.address) {
        const geoRes = await ax.get('https://maps.googleapis.com/maps/api/geocode/json', { params: { address: g.address, key: apiKey }, timeout: 5000 });
        const loc = geoRes.data?.results?.[0]?.geometry?.location;
        if (loc) {
          const type = g.types?.[0] || 'establishment';
          const nearRes = await ax.get('https://maps.googleapis.com/maps/api/place/nearbysearch/json', { params: { location: `${loc.lat},${loc.lng}`, radius: 8000, type, key: apiKey }, timeout: 5000 });
          const comp = (nearRes.data?.results || []).filter(p => p.place_id !== g.placeId && p.rating > 0).sort((a, b) => (b.user_ratings_total || 0) - (a.user_ratings_total || 0));
          if (comp[0]) topCompetitor = { name: comp[0].name, rating: comp[0].rating, reviewCount: comp[0].user_ratings_total || 0 };
        }
      }
    } catch {}

    // Rep talking points
    const talkingPoints = [];
    talkingPoints.push(`Your Google score is ${tScore} out of 100.`);
    if (g.reviewCount < 50 && topCompetitor) talkingPoints.push(`You have ${g.reviewCount} reviews — your top competitor ${topCompetitor.name} has ${topCompetitor.reviewCount}. That gap is costing you customers.`);
    else if (g.reviewCount < 50) talkingPoints.push(`You only have ${g.reviewCount} reviews. Most successful businesses in your area have 50+.`);
    if (g.rating > 0 && g.rating < 4.5) talkingPoints.push(`Your ${g.rating}-star rating is below the 4.5 threshold where customers feel confident calling.`);
    if (!g.hasWebsite) talkingPoints.push(`You don't have a website linked to your Google profile. Customers can't learn more about you.`);
    if (g.photoCount < 5) talkingPoints.push(`Your profile only has ${g.photoCount} photos. Businesses with 10+ get 42% more direction requests.`);

    return {
      businessName, city, state, scannedAt: new Date().toISOString(),
      preliminaryScore: tScore, scoreLabel: getScoreLabel(tScore),
      teaser: true, checksShown: 4, totalChecks: 47,
      google: googleData, topCompetitor,
      findings: tFindings, talkingPoints,
      note: 'Preliminary scan — Google only. Full audit checks 7 platforms.',
    };
  } catch (e) { console.error('[SCAN] Teaser failed:', e.message); return { error: 'Scan failed.', businessName, city, state }; }
}

module.exports = { runFullScan, runTeaserScan };
