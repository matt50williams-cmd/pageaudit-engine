const axios = require('axios');
const cheerio = require('cheerio');
const { getFacebookData } = require('./facebook');
const { getYelpData } = require('./yelp');

const ax = axios.create({ timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36' } });
const F = (platform, severity, title, description, impact, fix, estimatedLoss) => ({ platform, severity, title, description, impact: impact || '', fix: fix || '', estimatedLoss: estimatedLoss || '' });
function cleanUrl(u) { if (!u) return null; let url = u.trim(); if (!url.startsWith('http')) url = 'https://' + url; try { const p = new URL(url); p.search = ''; return p.toString().replace(/\/$/, ''); } catch { return url; } }

// ══════════════════════════════════════════════════
// CHECK 1: GOOGLE BUSINESS PROFILE (35pts max)
// ══════════════════════════════════════════════════
async function checkGoogle(businessName, city, state) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return { found: false, rawScore: 0, maxScore: 35, excluded: true, findings: [F('Google', 'warning', 'Google check unavailable', 'API key not configured.', '', '')] };

  console.log(`[SCAN] Google: "${businessName} ${city} ${state}"`);
  const findRes = await ax.get('https://maps.googleapis.com/maps/api/place/findplacefromtext/json', { params: { input: `${businessName} ${city} ${state}`, inputtype: 'textquery', fields: 'place_id,name,formatted_address,business_status', key } });
  const candidate = findRes.data?.candidates?.[0];
  if (!candidate?.place_id) return { found: false, rawScore: 0, maxScore: 35, findings: [F('Google', 'critical', 'Not found on Google', `No listing found for "${businessName}" in ${city}.`, 'The #1 way customers find local businesses.', 'Create your Google Business Profile at business.google.com.')] };

  const d = (await ax.get('https://maps.googleapis.com/maps/api/place/details/json', { params: { place_id: candidate.place_id, fields: 'name,rating,user_ratings_total,formatted_address,formatted_phone_number,opening_hours,website,photos,business_status,reviews,types,editorial_summary', key } })).data?.result || {};

  const rating = d.rating || 0, reviewCount = d.user_ratings_total || 0;
  const hasHours = !!d.opening_hours, hoursComplete = (d.opening_hours?.weekday_text?.length || 0) === 7;
  const photoCount = d.photos?.length || 0, hasWebsite = !!d.website, hasPhone = !!d.formatted_phone_number;
  const hasDescription = !!d.editorial_summary?.overview;
  const businessStatus = d.business_status || 'UNKNOWN', types = d.types || [];
  const reviews = d.reviews || [];
  const now = Date.now() / 1000;
  const daysSinceReview = reviews[0]?.time ? Math.round((now - reviews[0].time) / 86400) : 999;
  // Google Places API does not reliably expose owner replies — do not score or report response rate
  const responseRate = null;

  // SCORING (35pts)
  let raw = 0;
  // Rating (14pts — increased from 12 to absorb removed response rate)
  if (rating >= 4.8) raw += 14; else if (rating >= 4.5) raw += 12; else if (rating >= 4.0) raw += 9; else if (rating >= 3.5) raw += 5; else if (rating > 0) raw += 2;
  // Review count (11pts — increased from 10)
  if (reviewCount >= 500) raw += 11; else if (reviewCount >= 200) raw += 9; else if (reviewCount >= 100) raw += 7; else if (reviewCount >= 50) raw += 5; else if (reviewCount >= 20) raw += 3; else if (reviewCount > 0) raw += 1;
  // Profile (5pts)
  if (hasHours) raw += 1; if (hasWebsite) raw += 1; if (hasPhone) raw += 1; if (photoCount >= 10) raw += 1; if (hasDescription) raw += 1;
  // Recent (3pts)
  if (daysSinceReview <= 30) raw += 3; else if (daysSinceReview <= 90) raw += 2; else if (daysSinceReview <= 180) raw += 1;
  // Authority bonus (2pts)
  if (reviewCount >= 1000 && rating >= 4.5) raw += 2;
  else if (reviewCount >= 500 && rating >= 4.5) raw += 1;
  raw = Math.min(raw, 35);

  // FINDINGS
  const findings = [];
  if (rating === 0) findings.push(F('Google', 'critical', 'No Google rating', 'On your Google Business Profile, there is no star rating visible to customers.', 'When someone searches for your type of business, Google shows rated competitors first — you are invisible in comparison.', 'Ask 10 of your best customers to leave a Google review this week. Send them a direct link to your review page.'));
  else if (rating < 4.0) findings.push(F('Google', 'critical', `${rating}-star rating is below the trust threshold`, `On your Google Business Profile, your ${rating}-star rating falls below the 4.0 mark that most customers use as a filter.`, 'Up to 40% of customers automatically skip businesses rated below 4.0 — they never even see your listing.', 'Respond professionally to every negative review. Then ask your 5 happiest customers to leave a review today.'));
  else if (rating < 4.5) findings.push(F('Google', 'warning', `${rating}-star rating — close but not top-tier`, `On your Google Business Profile, your ${rating}-star rating is solid but sits below the 4.5+ that top local competitors maintain.`, 'Customers comparing two similar businesses will pick the one with higher stars — even a 0.3 difference matters.', 'Ask every satisfied customer for a review. A simple follow-up text after service works best.'));
  else findings.push(F('Google', 'good', `Strong ${rating}-star rating`, `On your Google Business Profile, your ${rating}-star rating is a strong trust signal to customers.`, 'This puts you in the top tier — customers are more likely to click your listing over lower-rated competitors.', ''));

  if (reviewCount === 0) findings.push(F('Google', 'critical', 'No Google reviews', 'On your Google Business Profile, you have zero reviews.', 'Customers trust reviews more than ads. Without any, most people will choose a competitor who has them.', 'Start today — send your 10 best customers a direct link to your Google review page. Aim for 50+ reviews.'));
  else if (reviewCount < 20) findings.push(F('Google', 'critical', `Only ${reviewCount} reviews`, `On your Google Business Profile, you have just ${reviewCount} reviews.`, 'Businesses with fewer than 20 reviews look new or unestablished — customers hesitate to trust them.', 'Launch a review campaign. Text or email every customer after service with your Google review link. Target 50+.'));
  else if (reviewCount < 50) findings.push(F('Google', 'warning', `${reviewCount} reviews — competitors likely have more`, `On your Google Business Profile, you have ${reviewCount} reviews.`, 'Competitors in your area with 100+ reviews will appear more trustworthy to customers comparing options.', 'Send a follow-up text after every job asking for a review. Consistency is more important than big pushes.'));
  else findings.push(F('Google', 'good', `${reviewCount} reviews — solid social proof`, `On your Google Business Profile, ${reviewCount} reviews show customers that your business is active and trusted.`, 'This volume of reviews gives you a real edge over competitors with fewer.', ''));

  // Response rate finding removed — Google Places API does not reliably expose owner replies
  if (!hasHours) findings.push(F('Google', 'warning', 'Business hours not listed', 'On your Google Business Profile, your operating hours are missing.', 'Customers who can\'t see your hours assume you might be closed — and they\'ll call a competitor instead.', 'Log into Google Business Profile and add your hours for every day of the week, including days you\'re closed.'));
  if (photoCount < 5) findings.push(F('Google', 'warning', `Only ${photoCount} photo${photoCount === 1 ? '' : 's'} on your profile`, `On your Google Business Profile, you have only ${photoCount} photo${photoCount === 1 ? '' : 's'}.`, 'Google reports that businesses with 10+ photos receive 42% more requests for directions and 35% more website clicks.', 'Upload photos of your storefront, your team at work, completed projects, and your interior. Aim for 10+ photos.'));
  if (!hasWebsite) findings.push(F('Google', 'critical', 'No website linked on Google', 'On your Google Business Profile, there is no website link.', 'Customers who find you on Google have no way to learn more about your services, prices, or credibility — so they move on.', 'Add your website URL in Google Business Profile under the Info section.'));
  if (!hasDescription) findings.push(F('Google', 'warning', 'No business description', 'On your Google Business Profile, the business description field is empty.', 'This is a missed opportunity to tell customers what you do, what makes you different, and why they should choose you.', 'Write a 2-3 sentence description that includes your business name, city, and main services. Add it in Google Business Profile under Info.'));
  if (daysSinceReview > 180) findings.push(F('Google', 'warning', 'No recent reviews', `On your Google Business Profile, your most recent review is over ${Math.round(daysSinceReview / 30)} months old.`, 'An inactive review profile signals to customers that your business may have slowed down or closed.', 'Ask a recent customer for a review today. Set up a recurring habit — after every completed job, send the review link.'));
  if (businessStatus !== 'OPERATIONAL') findings.push(F('Google', 'critical', `Google shows your business as "${businessStatus.toLowerCase()}"`, `On your Google Business Profile, your business status is listed as "${businessStatus}" instead of "Operational".`, 'Customers who see this status will not contact you — they assume you are permanently closed.', 'Log into Google Business Profile immediately and update your status to "Open". If this is incorrect, request a correction from Google.'));

  const dataPoints = 15 + reviews.length * 5; // base fields + review analysis

  return { found: true, placeId: candidate.place_id, name: d.name || businessName, rating, reviewCount, address: d.formatted_address || '', phone: d.formatted_phone_number || '', website: d.website || '', hasHours, hoursComplete, photoCount, hasWebsite, hasPhone, hasDescription, businessStatus, types, responseRate, daysSinceReview, reviews: reviews.slice(0, 5).map(r => ({ text: r.text?.slice(0, 200), rating: r.rating, time: r.time })), rawScore: raw, maxScore: 35, score: Math.round((raw / 35) * 100), findings, dataPoints };
}

// ══════════════════════════════════════════════════
// CHECK 2: WEBSITE AUDIT (25pts max)
// ══════════════════════════════════════════════════
async function checkWebsite(websiteUrl) {
  if (!websiteUrl) return { found: false, rawScore: 0, maxScore: 25, excluded: true, findings: [F('Website', 'warning', 'No website', '', '', 'Get a website.')] };
  const url = cleanUrl(websiteUrl);
  console.log(`[SCAN] Website: ${url}`);
  let raw = 0, dataPoints = 0;
  const findings = [];

  // SSL (5pts)
  let hasSSL = false, html = '';
  try {
    const r = await ax.get(url, { timeout: 8000, maxRedirects: 5 });
    hasSSL = (r.request?.res?.responseUrl || r.config?.url || '').startsWith('https://');
    html = r.data || '';
    dataPoints += 1;
    if (hasSSL) { raw += 5; findings.push(F('Website', 'good', 'SSL security is active', 'On your website (shown above), the security padlock is visible in the browser.', 'Customers see your site is secure — this builds trust and Google rewards it with higher rankings.', '')); }
    else findings.push(F('Website', 'critical', 'No SSL security — browser shows "Not Secure"', 'On your website (shown above), visitors see a "Not Secure" warning in their browser.', 'Most customers will leave immediately when they see this warning — it signals that your site may not be safe.', 'Contact your hosting provider and enable SSL. Most hosts (GoDaddy, Bluehost, Squarespace) offer free SSL through Let\'s Encrypt.'));
  } catch { findings.push(F('Website', 'warning', 'Website is unreachable', 'Your website could not be loaded during our scan.', 'If your site is down, every potential customer who tries to visit sees an error page and goes to a competitor instead.', 'Check that your website is online and the URL is correct. Contact your hosting provider if the site is down.')); return { found: false, rawScore: 0, maxScore: 25, excluded: true, hasSSL, findings, dataPoints }; }

  // Meta tags (10pts)
  if (html) {
    const $ = cheerio.load(html);
    const title = $('title').text().trim();
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    const h1 = $('h1').first().text().trim();
    const hasSchema = html.includes('application/ld+json');
    const hasPhoneOnSite = /(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})|tel:/i.test(html);
    const hasAddr = /\b\d{2,5}\s+[A-Z][a-z]+\s+(St|Ave|Blvd|Dr|Rd|Ln|Way|Ct)/i.test(html);
    const hasCTA = /book\s*(now|online|appointment)|call\s*(us|now|today)|contact\s*us|schedule|get\s*quote/i.test(html);

    if (title && title.length <= 60) { raw += 2; dataPoints++; }
    else if (title) { raw += 1; dataPoints++; findings.push(F('Website', 'warning', 'Page title is too long', `On your website (shown above), the browser tab title is ${title.length} characters — Google will cut it off in search results.`, 'A truncated title looks unprofessional in search results and may lose you clicks.', 'Shorten your title tag to under 60 characters. Include your business name and main service.')); }
    else findings.push(F('Website', 'warning', 'Missing page title', 'On your website (shown above), there is no title tag — this is what appears in the browser tab and Google search results.', 'Without a title, Google guesses what to show — and it usually guesses poorly. Customers may not click your listing.', 'Add a title tag like: "Your Business Name | Main Service in Your City". Ask your web person or find it in Settings > SEO in most website builders.'));

    if (metaDesc) { raw += 2; dataPoints++; }
    else findings.push(F('Website', 'warning', 'No Google preview description', 'On your website (shown above), there is no meta description — this is the 2-line preview that appears under your link on Google.', 'Without it, Google auto-generates a description from random page text — often confusing or irrelevant to customers.', 'Add a meta description under 160 characters that describes what your business does and why customers should click. In most website builders, find it in SEO Settings.'));

    if (h1) { raw += 1; dataPoints++; }
    else findings.push(F('Website', 'warning', 'No main headline on homepage', 'On your website (shown above), there is no clear main headline (H1) visible to visitors.', 'A strong headline immediately tells visitors what your business does — without it, visitors are confused and may leave.', 'Add a clear headline at the top of your homepage. Example: "Trusted [Service] in [City] — Call Today for a Free Quote".'));

    if (hasSchema) { raw += 1; dataPoints++; findings.push(F('Website', 'good', 'Structured data found', 'On your website (shown above), schema markup is present.', 'This helps Google understand your business and can display rich results like star ratings and hours directly in search.', '')); }
    else findings.push(F('Website', 'warning', 'No structured data for Google', 'On your website (shown above), there is no schema markup to help Google understand your business.', 'Without structured data, Google cannot show rich details like your star rating, hours, or address directly in search results.', 'Add LocalBusiness JSON-LD markup to your site. Use the free generator at technicalseo.com/tools/schema-markup-generator and ask your web person to paste it into your site.'));

    if (hasPhoneOnSite) { raw += 2; dataPoints++; }
    else findings.push(F('Website', 'critical', 'No phone number visible on website', 'On your website (shown above), we could not find a phone number.', 'Customers who want to call you right now cannot — they will call a competitor whose number is easy to find.', 'Add your phone number to the header or top of every page. Make it clickable on mobile with a tel: link.'));

    if (hasCTA) { raw += 1; dataPoints++; }
    else findings.push(F('Website', 'warning', 'No clear call-to-action', 'On your website (shown above), there is no visible button or prompt to book, call, or contact you.', 'Visitors who are ready to take action don\'t know what to do next — you are likely losing ready-to-buy customers.', 'Add a prominent button like "Call Now", "Book Online", or "Get a Free Quote" near the top of every page.'));

    if (hasAddr) { raw += 1; dataPoints++; }
  }

  // PageSpeed (10pts)
  let perfScore = 0, loadTime = null;
  try {
    const params = { url, strategy: 'mobile', category: 'performance' };
    if (process.env.GOOGLE_PLACES_API_KEY) params.key = process.env.GOOGLE_PLACES_API_KEY;
    const r = await ax.get('https://www.googleapis.com/pagespeedonline/v5/runPagespeed', { params, timeout: 30000 });
    perfScore = Math.round((r.data?.lighthouseResult?.categories?.performance?.score || 0) * 100);
    const fcp = r.data?.lighthouseResult?.audits?.['first-contentful-paint']?.numericValue;
    loadTime = fcp ? Math.round(fcp / 100) / 10 : null;
    dataPoints += 3;
    if (perfScore >= 90) { raw += 10; findings.push(F('Website', 'good', `Speed ${perfScore}/100`, 'Fast mobile performance.', '', '')); }
    else if (perfScore >= 70) { raw += 7; findings.push(F('Website', 'good', `Speed ${perfScore}/100`, '', '', '')); }
    else if (perfScore >= 50) { raw += 4; findings.push(F('Website', 'warning', `Speed ${perfScore}/100 — slow`, 'Below 70 threshold.', '53% of users leave slow sites.', 'Optimize images at squoosh.app. Test at gtmetrix.com')); }
    else if (perfScore > 0) { raw += 1; findings.push(F('Website', 'critical', `Speed ${perfScore}/100 — very slow`, 'Losing 53% of mobile visitors.', 'Google penalizes slow sites.', 'Major overhaul needed. Start at gtmetrix.com')); }
  } catch (e) { console.log(`[SCAN] PageSpeed: ${e.message}`); }

  raw = Math.min(raw, 25);
  return { found: true, hasSSL, perfScore, loadTime, html, rawScore: raw, maxScore: 25, score: Math.round((raw / 25) * 100), findings, dataPoints };
}

// ══════════════════════════════════════════════════
// CHECK 3: SEARCH VISIBILITY (20pts max)
// ══════════════════════════════════════════════════
async function checkSearchVisibility(businessName, city, state, businessType) {
  const dfsLogin = process.env.DATAFORSEO_LOGIN, dfsPass = process.env.DATAFORSEO_PASSWORD;
  if (!dfsLogin || !dfsPass) {
    console.log('[SCAN] DataForSEO: no credentials');
    return { rawScore: 0, maxScore: 20, excluded: true, findings: [], dataPoints: 0 };
  }

  console.log(`[SCAN] Search visibility: ${businessType} ${city} ${state}`);
  const auth = Buffer.from(`${dfsLogin}:${dfsPass}`).toString('base64');
  const dfs = async (endpoint, body) => {
    const r = await ax.post(`https://api.dataforseo.com/v3/${endpoint}`, body, { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, timeout: 20000 });
    return r.data;
  };

  let raw = 0, dataPoints = 0;
  const findings = [];
  const keyword = `${businessType || 'business'} ${city} ${state}`.trim();

  // Maps 3-pack (10pts)
  try {
    const mapsRes = await dfs('serp/google/maps/live/advanced', [{ keyword, location_name: `${city},${state},United States`, language_name: 'English', depth: 10 }]);
    const items = mapsRes?.tasks?.[0]?.result?.[0]?.items || [];
    const pos = items.findIndex(i => i.title?.toLowerCase().includes(businessName.toLowerCase().split(' ')[0]));
    dataPoints += items.length * 3;
    if (pos >= 0 && pos < 3) { raw += 10; findings.push(F('Search', 'good', `#${pos + 1} in Google Maps 3-pack`, 'You appear in the top 3 map results.', '', '')); }
    else if (pos >= 0) { raw += 5; findings.push(F('Search', 'warning', `#${pos + 1} in Google Maps — not in top 3`, '70% of clicks go to top 3 results only.', '', 'Improve Google profile: more reviews, photos, and responses.')); }
    else findings.push(F('Search', 'critical', 'Not in Google Maps results', `Searched "${keyword}" — you didn't appear.`, '70% of local clicks go to Maps top 3.', 'Complete your Google Business Profile. Respond to reviews. Add photos.'));
  } catch (e) { console.log(`[SCAN] DFS Maps: ${e.message}`); }

  // Organic ranking (5pts)
  try {
    const orgRes = await dfs('serp/google/organic/live/advanced', [{ keyword, location_name: `${city},${state},United States`, language_name: 'English', depth: 20 }]);
    const items = orgRes?.tasks?.[0]?.result?.[0]?.items || [];
    const pos = items.findIndex(i => i.title?.toLowerCase().includes(businessName.toLowerCase().split(' ')[0]) || i.url?.toLowerCase().includes(businessName.toLowerCase().replace(/\s+/g, '')));
    dataPoints += items.length * 3;
    if (pos >= 0 && pos < 10) { raw += 5; findings.push(F('Search', 'good', `Page 1 organic for "${keyword}"`, '', '', '')); }
    else if (pos >= 0) { raw += 2; findings.push(F('Search', 'warning', `Page 2 for "${keyword}"`, 'Only 0.63% of users go to page 2.', '', 'Add your city and service to your website title tag.')); }
    else findings.push(F('Search', 'critical', `Not ranking for "${keyword}"`, '', 'Customers searching this keyword don\'t find you.', 'Optimize your website for local SEO. Add city + service to title tag.'));
  } catch (e) { console.log(`[SCAN] DFS Organic: ${e.message}`); }

  // Brand search (5pts)
  try {
    const volRes = await dfs('keywords_data/google_ads/search_volume/live', [{ keywords: [businessName], location_name: `${city},${state},United States`, language_name: 'English' }]);
    const vol = volRes?.tasks?.[0]?.result?.[0]?.search_volume || 0;
    dataPoints += 3;
    if (vol >= 500) { raw += 5; findings.push(F('Search', 'good', `${vol} monthly brand searches`, 'Strong brand awareness.', '', '')); }
    else if (vol >= 100) { raw += 3; findings.push(F('Search', 'good', `${vol} monthly brand searches`, '', '', '')); }
    else { raw += 1; findings.push(F('Search', 'warning', 'Low brand search volume', `Under 100 searches/month for "${businessName}".`, '', 'Build brand awareness through reviews and local marketing.')); }
  } catch (e) { console.log(`[SCAN] DFS Volume: ${e.message}`); }

  return { rawScore: Math.min(raw, 20), maxScore: 20, score: Math.round((Math.min(raw, 20) / 20) * 100), findings, dataPoints };
}

// ══════════════════════════════════════════════════
// CHECK 4: COMPETITORS
// ══════════════════════════════════════════════════
async function checkCompetitors(businessName, city, state, googleData) {
  console.log(`[SCAN] Competitors: ${businessName}`);
  const key = process.env.GOOGLE_PLACES_API_KEY;
  const fallbackResult = (source) => ({
    competitors: [], ranking: null, dataPoints: 0, findings: [],
    estimated: true, source,
  });

  if (!key) { console.log('[SCAN] Competitors: no API key'); return fallbackResult('no_api_key'); }

  try {
    // Get location for nearby search
    const geoQuery = googleData?.address || `${businessName} ${city} ${state}`;
    const geo = await ax.get('https://maps.googleapis.com/maps/api/geocode/json', { params: { address: geoQuery, key } });
    const loc = geo.data?.results?.[0]?.geometry?.location;
    if (!loc) { console.log('[SCAN] Competitors: geocode failed'); return fallbackResult('geocode_failed'); }

    const type = googleData?.types?.[0] || 'establishment';
    const bizPlaceId = googleData?.placeId || null;

    // Try multiple search strategies
    let results = [];
    const searches = [
      { location: `${loc.lat},${loc.lng}`, radius: 10000, type, key },
      { location: `${loc.lat},${loc.lng}`, radius: 15000, keyword: type.replace(/_/g, ' '), key },
      { location: `${loc.lat},${loc.lng}`, radius: 20000, keyword: `${type.replace(/_/g, ' ')} ${city}`, key },
    ];
    for (const params of searches) {
      const r = await ax.get('https://maps.googleapis.com/maps/api/place/nearbysearch/json', { params });
      const filtered = (r.data?.results || []).filter(p => (!bizPlaceId || p.place_id !== bizPlaceId));
      // Include businesses even without rating — they still exist as competitors
      if (filtered.length > results.length) results = filtered;
      if (results.length >= 5) break;
    }

    console.log(`[SCAN] Competitors: found ${results.length} nearby businesses`);

    const competitors = results.slice(0, 5).map(p => ({
      name: p.name,
      rating: p.rating || null,
      reviewCount: p.user_ratings_total || 0,
      address: p.vicinity || '',
      placeId: p.place_id || null,
      types: p.types || [],
      estimated: !p.rating,
    }));

    // Ranking only if we have Google data for this business
    let ranking = null, totalInArea = competitors.length + 1, reviewGap = 0;
    if (googleData?.rating && competitors.length > 0) {
      const all = [{ name: businessName, rating: googleData.rating, reviewCount: googleData.reviewCount || 0 }, ...competitors.filter(c => c.rating)];
      all.sort((a, b) => (b.rating * 10 + Math.log((b.reviewCount || 0) + 1)) - (a.rating * 10 + Math.log((a.reviewCount || 0) + 1)));
      ranking = all.findIndex(b => b.name === businessName) + 1;
      totalInArea = all.length;
    }
    const leader = competitors.filter(c => c.rating).sort((a, b) => (b.reviewCount || 0) - (a.reviewCount || 0))[0];
    reviewGap = leader ? (leader.reviewCount || 0) - (googleData?.reviewCount || 0) : 0;

    const findings = [];
    if (ranking && ranking > 3) findings.push(F('Competitors', 'warning', `You rank #${ranking} out of ${totalInArea} similar businesses nearby`, `When a customer searches for your type of business in your area, ${totalInArea} competitors appear — and you are #${ranking}.`, 'Customers rarely look past the top 3 results.', 'Focus on getting more reviews and completing your Google Business Profile.'));
    else if (ranking && ranking > 0) findings.push(F('Competitors', 'good', `You rank #${ranking} out of ${totalInArea} similar businesses nearby`, `Among ${totalInArea} competitors in your area, you are in the top ${ranking}.`, 'Customers see top-ranked businesses first.', ''));
    if (leader && reviewGap > 50) findings.push(F('Competitors', 'warning', `Top competitor has ${reviewGap} more reviews than you`, `${leader.name} leads with ${leader.reviewCount} reviews compared to your ${googleData?.reviewCount || 0}.`, 'Customers trust businesses with more reviews.', `Start a review campaign to close this gap.`));

    return {
      competitors,
      ranking,
      totalInArea,
      reviewGap,
      findings,
      dataPoints: competitors.length * 8,
      estimated: competitors.length === 0,
      source: competitors.length > 0 ? 'google_nearby' : 'no_results',
    };
  } catch (e) {
    console.error(`[SCAN] Competitors error: ${e.message}`);
    return fallbackResult('error');
  }
}

// ══════════════════════════════════════════════════
// CHECK 5: NAP CONSISTENCY (10pts max)
// ══════════════════════════════════════════════════
async function checkNAP(googleData, websiteData) {
  console.log('[SCAN] NAP consistency');
  let raw = 0, dataPoints = 0;
  const findings = [];

  if (!googleData?.found) return { rawScore: 0, maxScore: 10, excluded: true, findings: [F('NAP', 'warning', 'Cannot verify business info consistency', 'No Google listing was found, so we cannot compare your business name, address, and phone across platforms.', 'Inconsistent or missing business info across the web confuses Google and reduces your search visibility.', 'Create your Google Business Profile at business.google.com first, then ensure your info matches everywhere.')], dataPoints: 0 };

  const gPhone = (googleData.phone || '').replace(/[^0-9]/g, '');
  const gAddr = (googleData.address || '').toLowerCase();
  const html = (websiteData?.html || '').toLowerCase();

  // Phone match (3pts)
  if (gPhone && html.includes(gPhone.slice(-7))) { raw += 3; dataPoints += 2; findings.push(F('NAP', 'good', 'Phone number is consistent', 'The phone number on your website matches what\'s listed on your Google Business Profile.', 'Consistent contact info across platforms builds trust with both Google and customers.', '')); }
  else if (gPhone) { findings.push(F('NAP', 'warning', 'Phone number may not match across platforms', 'The phone number on your Google Business Profile was not found on your website (shown above).', 'When Google sees different phone numbers on your website vs. your Google listing, it loses confidence in your business info — which lowers your search ranking.', 'Make sure the exact same phone number appears on your website, Google Business Profile, Facebook page, and Yelp listing.')); dataPoints += 2; }

  // Address match (3pts)
  const addrParts = gAddr.split(',')[0]?.trim();
  if (addrParts && html.includes(addrParts)) { raw += 3; dataPoints += 2; findings.push(F('NAP', 'good', 'Address is consistent', 'Your business address on your website matches your Google Business Profile.', 'Consistent address info helps Google confidently show your business in local search results.', '')); }
  else if (addrParts) { findings.push(F('NAP', 'warning', 'Address may not match across platforms', 'The address on your Google Business Profile does not appear to match what\'s on your website (shown above).', 'Address mismatches confuse Google\'s local search algorithm and can prevent you from appearing in "near me" searches.', 'Verify that your exact street address — including suite numbers and abbreviations — is identical on your website, Google, Facebook, and Yelp.')); dataPoints += 2; }

  // Business name (2pts)
  const nameLower = (googleData.name || '').toLowerCase();
  if (nameLower && html.includes(nameLower.split(' ')[0])) { raw += 2; dataPoints += 2; }

  // Bing check (2pts)
  try {
    const r = await ax.get(`https://www.bing.com/search?q=${encodeURIComponent(googleData.name + ' ' + googleData.address?.split(',')[1]?.trim())}`, { timeout: 5000 });
    const text = (r.data || '').toLowerCase();
    dataPoints += 2;
    if (gPhone && text.includes(gPhone.slice(-7))) { raw += 2; findings.push(F('NAP', 'good', 'Business info found on Bing', 'Your business information appears consistently on Bing search.', 'Being listed on multiple search engines with consistent info strengthens your overall online presence.', '')); }
    else { findings.push(F('NAP', 'warning', 'Business info inconsistent on Bing', 'Your business info on Bing does not match your Google listing.', 'Bing powers search for Alexa, Siri, and many directory sites — inconsistent info here means you\'re invisible to those customers.', 'Claim your free listing at bingplaces.com and make sure your name, address, and phone match your Google profile exactly.')); }
  } catch {}

  return { rawScore: Math.min(raw, 10), maxScore: 10, score: Math.round((Math.min(raw, 10) / 10) * 100), findings, dataPoints };
}

// ══════════════════════════════════════════════════
// CHECK 6: REVIEW INTELLIGENCE (10pts max)
// ══════════════════════════════════════════════════
async function checkReviews(googleData) {
  console.log('[SCAN] Review intelligence');
  const reviews = googleData?.reviews || [];
  if (reviews.length < 2) return { rawScore: 0, maxScore: 10, excluded: true, findings: [], sentiment: null, dataPoints: 0 };

  let raw = 0, dataPoints = reviews.length * 5;
  const findings = [];
  let sentiment = null;

  // Use Claude Haiku for sentiment
  if (process.env.ANTHROPIC_API_KEY && reviews.length >= 3) {
    try {
      const reviewTexts = reviews.slice(0, 5).map(r => `${r.rating}★: "${(r.text || '').slice(0, 150)}"`).join('\n');
      const res = await axios.post('https://api.anthropic.com/v1/messages', { model: 'claude-haiku-4-5-20251001', max_tokens: 500, messages: [{ role: 'user', content: `Analyze these Google reviews:\n${reviewTexts}\nReturn ONLY JSON: {"praiseThemes":["top 3"],"complaintThemes":["top 3"],"sentimentScore":1-10,"reviewVelocity":"increasing/steady/declining"}` }] },
        { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 10000 });
      const text = res.data?.content?.[0]?.text || '';
      const m = text.match(/\{[\s\S]*\}/);
      if (m) sentiment = JSON.parse(m[0]);
    } catch (e) { console.log(`[SCAN] Review sentiment: ${e.message}`); }
  }

  // Score based on sentiment
  const ss = sentiment?.sentimentScore || 0;
  if (ss >= 8) raw += 10; else if (ss >= 6) raw += 7; else if (ss >= 4) raw += 4; else if (ss > 0) raw += 1;
  // Bonus: recent reviews
  if (googleData.daysSinceReview <= 30) raw += 2;
  if (googleData.daysSinceReview <= 90) raw += 1;
  raw = Math.min(raw, 10);

  if (sentiment?.complaintThemes?.length) findings.push(F('Reviews', 'warning', `Customers mention: ${sentiment.complaintThemes.slice(0, 2).join(', ')}`, 'Recurring complaint themes in recent reviews.', '', 'Address these themes to improve satisfaction.'));
  if (sentiment?.praiseThemes?.length) findings.push(F('Reviews', 'good', `Praised for: ${sentiment.praiseThemes.slice(0, 2).join(', ')}`, '', '', ''));

  return { rawScore: raw, maxScore: 10, score: Math.round((raw / 10) * 100), sentiment, findings, dataPoints };
}

// ══════════════════════════════════════════════════
// CHECK 7: FACEBOOK PAGE (10pts max) — via Apify
// ══════════════════════════════════════════════════
async function checkFacebook(facebookUrl) {
  console.log(`[SCAN] Facebook: url=${facebookUrl || 'NONE'} apify_token=${process.env.APIFY_API_TOKEN ? 'SET' : 'MISSING'}`);

  if (!facebookUrl) {
    return { found: false, rawScore: 0, maxScore: 10, excluded: true, findings: [F('Facebook', 'warning', 'No Facebook URL provided', 'Cannot analyze Facebook presence without a page URL.', '', 'Add your Facebook page URL.')], dataPoints: 0 };
  }

  if (!process.env.APIFY_API_TOKEN) {
    console.error('[SCAN] Facebook: APIFY_API_TOKEN missing — skipping');
    return { found: false, rawScore: 0, maxScore: 10, excluded: true, findings: [F('Facebook', 'warning', 'Facebook check unavailable', 'Apify token not configured.', '', '')], dataPoints: 0 };
  }

  try {
    console.log(`[SCAN] Facebook: calling Apify for ${facebookUrl}`);
    const fbData = await getFacebookData(facebookUrl);
    console.log(`[SCAN] Facebook: Apify returned ok=${fbData.ok} name=${fbData.name || 'N/A'} followers=${fbData.followers || 0} posts=${fbData.posts?.length || 0}`);

    if (!fbData.ok) {
      console.log(`[SCAN] Facebook: Apify failed — ${fbData.error || 'unknown'}`);
      return { found: false, rawScore: 0, maxScore: 10, excluded: false, findings: [F('Facebook', 'warning', 'Could not access Facebook page', 'Page may be restricted or URL may be incorrect.', '', 'Verify your Facebook page URL is correct and publicly visible.')], dataPoints: 0 };
    }

    const followers = fbData.followers || 0;
    const pageLikes = fbData.likes || 0;
    const posts = fbData.posts || [];
    const postCount = posts.length;
    const totalPostLikes = posts.reduce((sum, p) => sum + (p.likes || 0), 0);

    // Scoring (10pts)
    let raw = 0;
    if (followers > 1000) raw += 4;
    else if (followers > 100) raw += 2;
    if (postCount >= 2) raw += 3;
    if (pageLikes > 100 || totalPostLikes > 100) raw += 3;
    raw = Math.min(raw, 10);

    // Findings
    const findings = [];
    if (followers > 500) findings.push(F('Facebook', 'good', `${followers.toLocaleString()} followers`, `On your Facebook page (shown above), you have ${followers.toLocaleString()} followers — a solid audience base.`, 'This gives you built-in reach every time you post. Customers checking your page see an active, trusted business.', ''));
    else if (followers > 0) findings.push(F('Facebook', 'warning', `Only ${followers.toLocaleString()} followers`, `On your Facebook page (shown above), your follower count is ${followers.toLocaleString()}.`, 'A low follower count makes your business look new or inactive to customers checking you out on social media.', 'Invite your existing customers to like your page. Add a "Follow us on Facebook" link to your website, email signature, and receipts.'));
    else findings.push(F('Facebook', 'warning', 'Follower count not available', 'On your Facebook page (shown above), we could not determine your follower count.', 'Customers checking your page may see a low number and hesitate to trust your business.', 'Make sure your page is public and your follower count is visible in Page Settings.'));

    if (postCount === 0) findings.push(F('Facebook', 'critical', 'No recent posts found', 'On your Facebook page (shown above), there are no recent posts visible.', 'An inactive Facebook page signals to customers that your business may be closed or not engaged — Facebook also hides inactive pages from search results.', 'Start posting today. Share a photo of recent work, a customer testimonial, or a behind-the-scenes moment. Aim for 2-3 posts per week.'));
    else if (postCount < 2) findings.push(F('Facebook', 'warning', `Only ${postCount} recent post visible`, `On your Facebook page (shown above), only ${postCount} recent post was found.`, 'Inconsistent posting tells Facebook\'s algorithm to stop showing your content to followers — your reach drops dramatically.', 'Commit to posting 2-3 times per week. Use a mix of photos, tips, and customer stories. Consistency matters more than perfection.'));
    else findings.push(F('Facebook', 'good', `${postCount} recent posts found`, `On your Facebook page (shown above), ${postCount} recent posts show an active presence.`, 'Consistent posting keeps you visible in your followers\' feeds and signals to new visitors that your business is active.', ''));

    console.log(`[SCAN] Facebook: score=${raw}/10 followers=${followers} posts=${postCount}`);

    return {
      found: true, pageName: fbData.name, followers, postCount,
      avgLikes: postCount > 0 ? Math.round(totalPostLikes / postCount) : 0,
      rawScore: raw, maxScore: 10, score: Math.round((raw / 10) * 100),
      findings, dataPoints: 2 + postCount,
    };
  } catch (e) {
    console.error('[SCAN] Facebook CRASH:', e.message);
    return { found: false, rawScore: 0, maxScore: 10, excluded: false, findings: [F('Facebook', 'warning', 'Facebook check failed', e.message, '', '')], dataPoints: 0 };
  }
}

// ══════════════════════════════════════════════════
// CHECK 8: YELP (10pts max) — via Apify
// ══════════════════════════════════════════════════
async function checkYelp(yelpUrl) {
  console.log(`[SCAN] Yelp: url=${yelpUrl || 'NONE'} apify_token=${process.env.APIFY_API_TOKEN ? 'SET' : 'MISSING'}`);

  if (!yelpUrl) {
    return { found: false, rawScore: 0, maxScore: 10, excluded: true, findings: [F('Yelp', 'warning', 'No Yelp listing provided', 'No Yelp URL was available for this business.', 'Many customers — especially in service and food industries — check Yelp before choosing a business. Not being listed means you are invisible to them.', 'Search for your business on yelp.com. If it exists, claim it. If not, create a free listing.', 'Customers searching Yelp are choosing competitors who are listed', 'Every day without a Yelp listing, customers in your area who prefer Yelp are finding competitors instead of you.', 'Most local competitors have claimed Yelp listings — not having one puts you at a disadvantage.', '', 'yelp')], dataPoints: 0 };
  }

  if (!process.env.APIFY_API_TOKEN) {
    console.error('[SCAN] Yelp: APIFY_API_TOKEN missing — skipping');
    return { found: false, rawScore: 0, maxScore: 10, excluded: true, findings: [], dataPoints: 0 };
  }

  try {
    console.log(`[SCAN] Yelp: calling Apify for ${yelpUrl}`);
    const data = await getYelpData(yelpUrl);
    console.log(`[SCAN] Yelp: Apify returned ok=${data.ok} name=${data.name || 'N/A'} rating=${data.rating || 0} reviews=${data.reviewCount || 0}`);

    if (!data.ok) {
      console.log(`[SCAN] Yelp: Apify failed — ${data.error || 'unknown'}`);
      return { found: false, rawScore: 0, maxScore: 10, excluded: false, findings: [F('Yelp', 'warning', 'Could not access Yelp listing', 'On your Yelp listing (shown above), we were unable to retrieve detailed data.', 'If your Yelp page is restricted or unclaimed, customers see incomplete information — which reduces trust.', 'Visit yelp.com/biz and search for your business. Claim the listing and make sure it is publicly visible.', 'Customers may be seeing an incomplete or outdated Yelp profile for your business', '', '', '', 'yelp')], dataPoints: 0 };
    }

    const rating = data.rating || 0;
    const reviewCount = data.reviewCount || 0;
    const photos = data.photos || 0;
    const recentReviews = data.recentReviews || [];

    // Scoring (10pts)
    let raw = 0;
    // Rating (4pts)
    if (rating >= 4.5) raw += 4;
    else if (rating >= 4.0) raw += 3;
    else if (rating >= 3.5) raw += 2;
    else if (rating > 0) raw += 1;
    // Review count (4pts)
    if (reviewCount >= 100) raw += 4;
    else if (reviewCount >= 50) raw += 3;
    else if (reviewCount >= 20) raw += 2;
    else if (reviewCount > 0) raw += 1;
    // Photos (2pts)
    if (photos >= 10) raw += 2;
    else if (photos > 0) raw += 1;
    raw = Math.min(raw, 10);

    // Findings
    const findings = [];

    // Rating
    if (rating === 0) {
      findings.push(F('Yelp', 'critical', 'No rating on your Yelp listing',
        'On your Yelp listing (shown above), there is no star rating visible.',
        'Yelp users heavily filter by rating. Without one, your listing is skipped entirely by customers who sort by "Highest Rated" or filter for 4+ stars.',
        'Ask satisfied customers to leave a Yelp review. Even 3-5 reviews will establish a rating and make your listing competitive.',
        'Customers browsing Yelp for your type of business cannot see any rating for you — they will choose a rated competitor instead',
        'Yelp is one of the first places customers check for service businesses. Every day without a rating is a day you are invisible on the platform.',
        'Competitors on Yelp with established ratings get priority in search results and customer trust.',
        'Visible in the Yelp screenshot above — no star rating displayed.', 'yelp'));
    } else if (rating < 3.5) {
      findings.push(F('Yelp', 'critical', `${rating}-star Yelp rating is hurting your business`,
        `On your Yelp listing (shown above), your ${rating}-star rating is below what most customers consider acceptable.`,
        'Yelp users are highly rating-sensitive. A rating below 3.5 causes most customers to skip your listing without reading a single review.',
        'Respond to every negative review professionally. Then focus on getting happy customers to leave reviews — even a small bump to 3.5+ makes a significant difference.',
        'Customers who find you on Yelp are likely choosing higher-rated competitors instead of contacting you',
        'The longer a low rating sits without improvement, the more it compounds — new customers see the low rating and don\'t give you a chance.',
        `Competitors with 4.0+ ratings on Yelp are getting the clicks and calls that your ${rating}-star rating is pushing away.`,
        `Visible in the Yelp screenshot above — ${rating}-star rating displayed.`, 'yelp'));
    } else if (rating < 4.0) {
      findings.push(F('Yelp', 'warning', `${rating}-star Yelp rating — below the trust threshold`,
        `On your Yelp listing (shown above), your ${rating}-star rating is decent but falls below the 4.0 mark that most customers use as a minimum.`,
        'Many Yelp users filter results to 4.0+ stars. Your listing may not appear in their filtered results at all.',
        'Focus on responding to reviews and encouraging satisfied customers to post. A push from 3.5 to 4.0+ significantly increases visibility.',
        'Some customers filtering Yelp by "4 stars and above" will never see your business',
        'You are close to the 4.0 threshold — a few positive reviews could push you over and unlock significantly more visibility.',
        'Competitors at 4.0+ appear in more filtered searches on Yelp than you do.',
        '', 'yelp'));
    } else {
      findings.push(F('Yelp', 'good', `Strong ${rating}-star Yelp rating`,
        `On your Yelp listing (shown above), your ${rating}-star rating is above the 4.0 trust threshold.`,
        'This rating puts you in the range where Yelp users trust your business and are willing to contact you.',
        '', '', '', '', '', 'yelp'));
    }

    // Review count
    if (reviewCount === 0) {
      findings.push(F('Yelp', 'critical', 'No Yelp reviews',
        'On your Yelp listing (shown above), there are zero reviews.',
        'A listing with no reviews looks abandoned. Yelp users trust businesses with established review histories and will choose a competitor with reviews over you.',
        'Ask 5 of your most loyal customers to leave an honest Yelp review. Even a small number of reviews makes your listing credible.',
        'Customers on Yelp are choosing reviewed competitors because your listing has no social proof',
        'Yelp is growing as a decision-making tool. The sooner you build reviews, the faster you compete.',
        'Competitors with 20-50+ Yelp reviews appear far more trustworthy and established than a listing with zero.',
        'Visible in the Yelp screenshot above — review count shows zero.', 'yelp'));
    } else if (reviewCount < 10) {
      findings.push(F('Yelp', 'warning', `Only ${reviewCount} Yelp reviews`,
        `On your Yelp listing (shown above), you have ${reviewCount} review${reviewCount === 1 ? '' : 's'}.`,
        'Listings with fewer than 10 reviews look new or unestablished on Yelp. Customers tend to choose businesses with more reviews as a safety signal.',
        'Build momentum — ask every happy customer to leave a Yelp review. Even adding 2-3 per month will make a noticeable difference within a quarter.',
        'A thin review profile makes customers hesitant — they may skip you for a competitor with more social proof',
        'Every week without new reviews is a week competitors are building their advantage on Yelp.',
        'Most established competitors in your area have 20+ Yelp reviews.', '', 'yelp'));
    } else if (reviewCount < 50) {
      findings.push(F('Yelp', 'good', `${reviewCount} Yelp reviews — building momentum`,
        `On your Yelp listing (shown above), you have ${reviewCount} reviews.`,
        'This is a reasonable base. Continuing to add reviews consistently will strengthen your position against competitors who may have more.',
        'Keep asking for reviews after every job. Aim for 50+ to match or beat most local competitors.',
        '', '', '', '', 'yelp'));
    } else {
      findings.push(F('Yelp', 'good', `${reviewCount} Yelp reviews — strong social proof`,
        `On your Yelp listing (shown above), ${reviewCount} reviews signal a well-established, trusted business.`,
        'This volume of reviews gives you a significant advantage on Yelp — customers see you as proven and reliable.',
        '', '', '', '', '', 'yelp'));
    }

    // Photos
    if (photos === 0) {
      findings.push(F('Yelp', 'warning', 'No photos on your Yelp listing',
        'On your Yelp listing (shown above), there are no photos.',
        'Yelp listings with photos receive significantly more views and engagement. Without them, your listing looks bare compared to competitors with images.',
        'Upload 5-10 photos showing your work, your space, your team, or your products. Real photos outperform stock images.',
        'A photo-less listing looks incomplete — customers are drawn to listings where they can see what to expect',
        'Competitors who upload photos stand out in Yelp search results with visual previews.',
        'Most competitors with active Yelp profiles have uploaded photos — yours has none.', '', 'yelp'));
    }

    console.log(`[SCAN] Yelp: score=${raw}/10 rating=${rating} reviews=${reviewCount} photos=${photos}`);

    return {
      found: true, name: data.name, rating, reviewCount, photos,
      recentReviews, categories: data.categories, phone: data.phone,
      rawScore: raw, maxScore: 10, score: Math.round((raw / 10) * 100),
      findings, dataPoints: 5 + recentReviews.length * 3,
    };
  } catch (e) {
    console.error('[SCAN] Yelp CRASH:', e.message);
    return { found: false, rawScore: 0, maxScore: 10, excluded: false, findings: [F('Yelp', 'warning', 'Yelp check failed', `An error occurred while checking your Yelp listing.`, 'We could not verify your Yelp presence during this scan.', 'Verify your Yelp URL is correct and try again.', '', '', '', '', 'yelp')], dataPoints: 0 };
  }
}

// ══════════════════════════════════════════════════
// SCORING ENGINE (100pts)
// ══════════════════════════════════════════════════
function calculateScore(platforms) {
  let earned = 0, possible = 0;
  for (const p of Object.values(platforms)) {
    if (p && !p.excluded && p.maxScore) {
      earned += (p.rawScore || 0);
      possible += p.maxScore;
    }
  }
  if (possible === 0) return 0;
  return Math.round((earned / possible) * 100);
}

function getScoreLabel(s) {
  if (s >= 90) return 'Exceptional';
  if (s >= 75) return 'Strong';
  if (s >= 60) return 'Needs Work';
  if (s >= 45) return 'Critical';
  return 'Emergency';
}

// ══════════════════════════════════════════════════
// COMPETITOR ENRICHMENT (fetch extra data per competitor)
// ══════════════════════════════════════════════════
async function enrichCompetitorData(competitors, city, state) {
  if (!competitors || competitors.length === 0) return [];
  const key = process.env.GOOGLE_PLACES_API_KEY;
  const top3 = competitors.slice(0, 3);

  const enriched = await Promise.all(top3.map(async (comp) => {
    let website = null, description = null, photoCount = 0;

    // Fetch Place Details if we have a placeId and API key
    if (comp.placeId && key) {
      try {
        const r = await ax.get('https://maps.googleapis.com/maps/api/place/details/json', {
          params: { place_id: comp.placeId, fields: 'website,editorial_summary,photos', key },
          timeout: 5000,
        });
        const d = r.data?.result || {};
        website = d.website || null;
        description = d.editorial_summary?.overview || null;
        photoCount = d.photos?.length || 0;
      } catch {}
    }

    // Try to fetch competitor website text
    let websiteText = '';
    if (website) {
      try {
        const r = await ax.get(website, { timeout: 5000 });
        websiteText = (r.data || '')
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 1500);
      } catch {}
    }

    return {
      name: comp.name,
      rating: comp.rating,
      reviewCount: comp.reviewCount,
      address: comp.address || '',
      categories: (comp.types || []).map(t => t.replace(/_/g, ' ')).join(', '),
      description,
      websiteText,
      hasWebsite: !!website,
      photoCount,
    };
  }));

  console.log(`[COMPETITORS] Enriched ${enriched.length} competitors. Websites found: ${enriched.filter(c => c.hasWebsite).length}`);
  return enriched;
}

// ══════════════════════════════════════════════════
// COMPETITOR ANALYSIS (Claude Haiku)
// ══════════════════════════════════════════════════
async function generateCompetitorAnalysis(businessName, city, state, platforms, compData, bizIntel) {
  if (!process.env.ANTHROPIC_API_KEY) return { comparisonSummary: '', keyGaps: [], whereCompetitive: [], opportunitiesToWin: [] };
  const comps = compData?.competitors || [];
  if (comps.length === 0) return { comparisonSummary: 'No competitor data available for this area.', keyGaps: [], whereCompetitive: [], opportunitiesToWin: [] };

  try {
    const enriched = await enrichCompetitorData(comps, city, state);

    const compDetails = enriched.map((c, i) => {
      let detail = `${i + 1}. ${c.name}
   - Rating: ${c.rating || 'unrated'} stars (${c.reviewCount} reviews)
   - Categories: ${c.categories || 'unknown'}
   - Has Website: ${c.hasWebsite ? 'Yes' : 'No'}
   - Photos on Google: ${c.photoCount}`;
      if (c.description) detail += `\n   - Google Description: ${c.description}`;
      if (c.websiteText) detail += `\n   - Website Content Snippet: ${c.websiteText.substring(0, 400)}`;
      return detail;
    }).join('\n\n');

    const bizContext = bizIntel ? `
PRIMARY SERVICE: ${bizIntel.primaryService}
OTHER SERVICES: ${bizIntel.secondaryServices?.join(', ') || 'none found'}
TARGET CUSTOMER: ${bizIntel.targetCustomer}
UNIQUE VALUE PROP: ${bizIntel.uniqueValueProp || 'not stated'}
CERTIFICATIONS: ${bizIntel.certifications?.join(', ') || 'none listed'}
EMERGENCY SERVICE: ${bizIntel.emergencyService ? 'Yes' : 'No'}` : '';

    const prompt = `You are a competitive intelligence analyst writing a section of a premium local business audit report.

SUBJECT BUSINESS: ${businessName}, ${city} ${state || ''}
THEIR GOOGLE: ${platforms.google?.rating || 'N/A'} stars, ${platforms.google?.reviewCount || 0} reviews
THEIR WEBSITE SPEED: ${platforms.website?.perfScore || 'N/A'}/100
${bizContext}

THEIR LOCAL COMPETITORS:
${compDetails}

Write a competitive analysis that:
1. Names specific competitors and what they do BETTER
2. Identifies where the subject business has an advantage
3. Gives concrete actions to close specific gaps
4. References actual numbers and competitor names throughout

Return ONLY valid JSON:
{
  "comparisonSummary": "2-3 paragraphs. Name competitors directly. Reference specific numbers. Explain what customers see when they compare options. Be honest about where this business is behind.",
  "keyGaps": ["Gap description that names the specific competitor doing it better and the real-world customer impact"],
  "whereCompetitive": ["Specific strength vs a named competitor with numbers"],
  "opportunitiesToWin": ["Specific action targeting a specific competitor weakness — concrete and actionable"]
}`;

    console.log('[COMPETITORS] Calling Claude for enriched competitor analysis...');
    const res = await axios.post('https://api.anthropic.com/v1/messages',
      { model: 'claude-haiku-4-5-20251001', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 20000 }
    );
    const text = res.data?.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log('[COMPETITORS] Enriched analysis OK');
      return {
        comparisonSummary: parsed.comparisonSummary || '',
        keyGaps: parsed.keyGaps || [],
        whereCompetitive: parsed.whereCompetitive || [],
        opportunitiesToWin: parsed.opportunitiesToWin || [],
      };
    }
    console.log('[COMPETITORS] No JSON in response');
    return { comparisonSummary: '', keyGaps: [], whereCompetitive: [], opportunitiesToWin: [] };
  } catch (e) {
    console.error('[COMPETITORS] Failed:', e.message);
    return { comparisonSummary: '', keyGaps: [], whereCompetitive: [], opportunitiesToWin: [] };
  }
}

// ══════════════════════════════════════════════════
// BUSINESS INTELLIGENCE (extracted from website HTML)
// ══════════════════════════════════════════════════
async function extractBusinessIntelligence(html, googleData, businessName, city, state) {
  if (!html || html.length < 500 || !process.env.ANTHROPIC_API_KEY) return null;

  try {
    const truncatedHtml = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                               .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                               .replace(/<[^>]+>/g, ' ')
                               .replace(/\s+/g, ' ')
                               .trim()
                               .substring(0, 4000);

    const prompt = `You are analyzing the website of a local business to extract structured intelligence for an audit report.

BUSINESS: ${businessName}, ${city} ${state || ''}
GOOGLE CATEGORIES: ${(googleData?.types || []).join(', ') || 'unknown'}
GOOGLE DESCRIPTION: ${googleData?.description || 'none'}

WEBSITE TEXT:
${truncatedHtml}

Extract and return ONLY a JSON object with these fields:
{
  "primaryService": "their #1 main service in plain English (e.g. HVAC installation and repair)",
  "secondaryServices": ["up to 4 other services they offer"],
  "serviceArea": "geographic area they serve based on website content",
  "targetCustomer": "who they primarily serve (residential, commercial, both)",
  "uniqueValueProp": "what makes them different or their main selling point if stated",
  "yearsInBusiness": "if mentioned, otherwise null",
  "certifications": ["any licenses, certifications, or awards mentioned"],
  "emergencyService": true or false,
  "brands": ["equipment brands or partners mentioned"],
  "missingFromWebsite": ["important things a business like this should have on their site but doesn't — be specific"]
}

Return ONLY the JSON object. No explanation. No markdown.`;

    console.log('[BIZ-INTEL] Extracting business intelligence from website HTML...');
    const res = await axios.post('https://api.anthropic.com/v1/messages',
      { model: 'claude-haiku-4-5-20251001', max_tokens: 600, messages: [{ role: 'user', content: prompt }] },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 15000 }
    );
    const text = res.data?.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log('[BIZ-INTEL] Extracted:', parsed.primaryService, '|', parsed.targetCustomer);
      return parsed;
    }
    console.log('[BIZ-INTEL] No JSON in response');
    return null;
  } catch (e) {
    console.error('[BIZ-INTEL] Failed:', e.message);
    return null;
  }
}

// ══════════════════════════════════════════════════
// AI INSIGHTS (Claude Haiku)
// ══════════════════════════════════════════════════
async function generateInsights(biz, city, state, platforms, score, extra) {
  console.log('[INSIGHTS] Called. Score:', score, 'Platforms:', Object.keys(platforms || {}).join(', '));
  if (!process.env.ANTHROPIC_API_KEY) { console.log('[INSIGHTS] No ANTHROPIC_API_KEY'); return { executiveSummary: '', topPriorities: [], quickWins: [], whatYoureDoingWell: [], competitorIntel: '', monthlyGoal: '', revenueImpact: '', businessIntelligence: null }; }

  const p = platforms;

  // Extract business intelligence from website HTML before building the prompt
  const bizIntel = await extractBusinessIntelligence(
    p.website?.html, p.google, biz, city, state
  );

  const bizIntelSection = bizIntel ? `
BUSINESS INTELLIGENCE (extracted from their actual website):
- Primary Service: ${bizIntel.primaryService}
- Other Services: ${bizIntel.secondaryServices?.join(', ') || 'none found'}
- Service Area: ${bizIntel.serviceArea}
- Serves: ${bizIntel.targetCustomer}
- Value Proposition: ${bizIntel.uniqueValueProp || 'not clearly stated on website'}
- Years in Business: ${bizIntel.yearsInBusiness || 'not stated'}
- Certifications/Licenses: ${bizIntel.certifications?.join(', ') || 'none mentioned'}
- Emergency Service: ${bizIntel.emergencyService ? 'Yes' : 'No/Not mentioned'}
- Missing from Website: ${bizIntel.missingFromWebsite?.join(', ') || 'none identified'}
` : '';

  const reviewThemes = p.reviews?.sentiment ? `
WHAT CUSTOMERS SAY:
- Praise: ${p.reviews.sentiment.praiseThemes?.join(', ') || 'none identified'}
- Complaints: ${p.reviews.sentiment.complaintThemes?.join(', ') || 'none identified'}
- Sentiment Score: ${p.reviews.sentiment.sentimentScore}/10
` : '';

  const prompt = `You are a local business digital marketing expert writing a premium audit report. You have deep knowledge of this specific business — use it. Do NOT give generic advice. Every recommendation must be specific to what this business actually does and who they serve.

BUSINESS: ${biz}, ${city} ${state || ''}
INDUSTRY: ${extra.industry || 'local business'}
BIGGEST CHALLENGE OWNER MENTIONED: ${extra.biggestChallenge || 'not provided'}
OVERALL SCORE: ${score}/100
${bizIntelSection}
${reviewThemes}
PLATFORM SCORES:
- Google Business Profile: ${p.google?.rawScore || 0}/35 — Rating: ${p.google?.rating || 'N/A'}, Reviews: ${p.google?.reviewCount || 0}, Has Description: ${p.google?.hasDescription || false}, Days Since Last Review: ${p.google?.daysSinceReview || 'unknown'}
- Website: ${p.website?.rawScore || 0}/25 — PageSpeed: ${p.website?.perfScore || 'N/A'}/100, SSL: ${p.website?.hasSSL ? 'Yes' : 'No'}
- NAP Consistency: ${p.nap?.rawScore || 0}/10${p.nap?.excluded ? ' (excluded)' : ''}
- Review Sentiment: ${p.reviews?.rawScore || 0}/10
- Facebook: ${p.facebook?.excluded ? 'Not scanned' : `${p.facebook?.rawScore || 0}/10 — Followers: ${p.facebook?.followers || 'N/A'}, Recent Posts: ${p.facebook?.postCount || 0}`}
- Yelp: ${p.yelp?.excluded ? 'Not scanned' : `${p.yelp?.rawScore || 0}/10 — Rating: ${p.yelp?.rating || 'N/A'}, Reviews: ${p.yelp?.reviewCount || 0}`}

COMPETITORS IN AREA:
${(extra.competitors?.competitors || []).slice(0, 3).map((c, i) => `${i + 1}. ${c.name} — ${c.rating || 'unrated'} stars, ${c.reviewCount || 0} reviews`).join('\n') || 'No competitor data available'}
${extra.competitors?.ranking ? `This business ranks #${extra.competitors.ranking} of ${extra.competitors.totalInArea} in the area.` : ''}

You MUST respond with ONLY a JSON object. No markdown. No backticks. No explanation. Just the raw JSON starting with {

{"summary":"2-3 sentences that reference their actual services, real numbers, and specific competitive position — not generic","revenueImpact":"Specific monthly revenue impact estimate based on their industry and score gaps","topPriorities":[{"priority":1,"title":"specific to their business","description":"what to do and why it matters for THIS business","timeToComplete":"X hours/days","estimatedROI":"specific dollar or % estimate","difficulty":"easy"},{"priority":2,"title":"second action","description":"what to do","timeToComplete":"X hours/days","estimatedROI":"specific estimate","difficulty":"medium"},{"priority":3,"title":"third action","description":"what to do","timeToComplete":"X hours/days","estimatedROI":"specific estimate","difficulty":"easy"}],"quickWins":["specific free action referencing their actual gaps","another","third"],"whatYoureDoingWell":["specific strength with actual numbers"],"competitorIntel":"what specific competitors are doing better and exactly what to do about it","monthlyGoal":"one specific measurable 30-day goal for THIS business"}`;

  console.log('[INSIGHTS] Calling Claude Haiku...');
  try {
    const res = await axios.post('https://api.anthropic.com/v1/messages', { model: 'claude-haiku-4-5-20251001', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 20000 });

    const text = res.data?.content?.[0]?.text || '';
    console.log('[INSIGHTS] Claude raw response (first 300 chars):', text.slice(0, 300));

    // Try to extract JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log('[INSIGHTS] Parsed OK. Keys:', Object.keys(parsed).join(', '));
        // Normalize field names — Claude may use "summary" or "executiveSummary"
        return {
          executiveSummary: parsed.summary || parsed.executiveSummary || '',
          revenueImpact: parsed.revenueImpact || '',
          topPriorities: parsed.topPriorities || [],
          quickWins: parsed.quickWins || [],
          whatYoureDoingWell: parsed.whatYoureDoingWell || parsed.doingWell || [],
          competitorIntel: parsed.competitorIntel || '',
          monthlyGoal: parsed.monthlyGoal || '',
          businessIntelligence: bizIntel || null,
        };
      } catch (parseErr) {
        console.log('[INSIGHTS] JSON parse FAILED:', parseErr.message, '| Raw:', jsonMatch[0].slice(0, 200));
        return { executiveSummary: text.slice(0, 300), topPriorities: [], quickWins: [], businessIntelligence: bizIntel || null };
      }
    }

    console.log('[INSIGHTS] No JSON found in response. Full text:', text.slice(0, 500));
    return { executiveSummary: text.slice(0, 300), topPriorities: [], quickWins: [] };
  } catch (e) {
    console.error('[INSIGHTS] API call FAILED:', e.message);
    if (e.response) console.error('[INSIGHTS] Status:', e.response.status, 'Body:', JSON.stringify(e.response.data).slice(0, 200));
    return { executiveSummary: '', topPriorities: [], quickWins: [] };
  }
}

// ══════════════════════════════════════════════════
// TIER LANGUAGE ENGINE
// ══════════════════════════════════════════════════
function applyTierLanguage(finding, plan) {
  // Basic: informational, helpful, not urgent
  if (plan === 'basic') {
    if (finding.severity === 'good') return finding;
    // Shorten descriptions — keep first sentence only
    if (finding.description) {
      const sentences = finding.description.split('. ');
      finding.description = sentences[0] + (sentences[0].endsWith('.') ? '' : '.');
    }
    // Soften impact
    if (finding.impact) {
      finding.impact = finding.impact
        .replace(/will not contact you/gi, 'may not contact you')
        .replace(/are choosing competitors/gi, 'may look at other options')
        .replace(/are likely choosing/gi, 'may consider')
        .replace(/never see your/gi, 'may not see your')
        .replace(/every day/gi, 'over time');
    }
    // Simplify fix to first sentence
    if (finding.fix) {
      const fixSentences = finding.fix.split('. ');
      finding.fix = fixSentences[0] + (fixSentences[0].endsWith('.') ? '' : '.');
    }
    // Strip urgency and competitive fields for basic
    finding.whyThisMattersNow = '';
    finding.competitorContrast = '';
    return finding;
  }

  // Advanced: insightful, slightly urgent, business-focused
  if (plan === 'advanced') {
    // Keep full description and impact as written
    // Keep whyThisMattersNow but soften slightly
    if (finding.whyThisMattersNow) {
      finding.whyThisMattersNow = finding.whyThisMattersNow
        .replace(/every day/gi, 'each week')
        .replace(/right now/gi, 'currently');
    }
    // Keep competitorContrast but make it observational
    if (finding.competitorContrast) {
      finding.competitorContrast = finding.competitorContrast
        .replace(/are getting the calls/gi, 'may be getting more calls')
        .replace(/are capturing/gi, 'may be capturing');
    }
    return finding;
  }

  // Competitive: direct, urgent, competitive pressure — return as-is (full strength)
  return finding;
}

function applyTierToPriorityFix(priorityFix, plan, businessName) {
  if (!priorityFix) return null;

  if (plan === 'basic') {
    return {
      title: priorityFix.title,
      reason: 'Addressing this would improve your online presence.',
      expectedImpact: `This could help ${businessName} attract more customers.`,
    };
  }
  if (plan === 'advanced') {
    return {
      title: priorityFix.title,
      reason: priorityFix.reason,
      expectedImpact: priorityFix.expectedImpact,
    };
  }
  // Competitive: add consequence of inaction
  return {
    title: priorityFix.title,
    reason: priorityFix.reason,
    consequence: `If this is not addressed, competitors will continue to capture the customers who should be finding ${businessName}.`,
    expectedImpact: priorityFix.expectedImpact,
  };
}

function applyTierToCompetitors(compData, competitorAnalysis, competitorSummary, plan) {
  const comps = compData?.competitors || [];
  const maxComps = plan === 'basic' ? 2 : 3;
  const limitedComps = comps.slice(0, maxComps);

  let comparison;
  if (plan === 'basic') {
    // Simple summary only
    comparison = competitorSummary ? { summary: competitorSummary } : null;
  } else if (plan === 'advanced') {
    // Include gaps and strengths
    comparison = competitorAnalysis ? {
      summary: competitorAnalysis.comparisonSummary || competitorSummary || '',
      keyGaps: competitorAnalysis.keyGaps || [],
      whereCompetitive: competitorAnalysis.whereCompetitive || [],
    } : (competitorSummary ? { summary: competitorSummary } : null);
  } else {
    // Competitive: full analysis with opportunities
    comparison = competitorAnalysis ? {
      summary: competitorAnalysis.comparisonSummary || competitorSummary || '',
      keyGaps: competitorAnalysis.keyGaps || [],
      whereCompetitive: competitorAnalysis.whereCompetitive || [],
      opportunitiesToWin: competitorAnalysis.opportunitiesToWin || [],
    } : (competitorSummary ? { summary: competitorSummary } : null);
  }

  return { competitors: limitedComps, comparison };
}

function applyTierToLossSummary(lossSummary, plan) {
  if (plan === 'basic') {
    // Softer, informational
    return lossSummary
      .replace(/losing \d+–\d+ potential customers/gi, 'missing some potential customers')
      .replace(/losing \d+–\d+ customers/gi, 'missing some opportunities')
      .replace(/costing you/gi, 'may be affecting');
  }
  if (plan === 'advanced') {
    // Keep as written — already business-focused
    return lossSummary;
  }
  // Competitive — already at full strength
  return lossSummary;
}

function applyTierToHeadline(headline, plan) {
  if (plan === 'basic') {
    return headline
      .replace(/Losing Leads to/gi, 'May Be Missing Opportunities From')
      .replace(/Are Choosing Competitors Over/gi, 'Have Other Options Besides')
      .replace(/Costing You Real Business/gi, 'Worth Looking Into');
  }
  // Advanced and Competitive use headline as-is
  return headline;
}

// ══════════════════════════════════════════════════
// FULL AUDIT
// ══════════════════════════════════════════════════
async function runFullScan({ businessName, city, state, website, facebookUrl, yelpUrl, industry, biggestChallenge, plan, selectedCompetitors }) {
  plan = ['basic', 'advanced', 'competitive'].includes(plan) ? plan : 'basic';
  console.log(`[SCAN] ═══ FULL AUDIT: ${businessName}, ${city} ═══`);
  console.log(`[SCAN] Inputs: website=${website || 'NONE'} facebookUrl=${facebookUrl || 'NONE'} yelpUrl=${yelpUrl || 'NONE'} industry=${industry || 'NONE'}`);
  console.log(`[SCAN] Selected competitors: ${selectedCompetitors ? selectedCompetitors.length : 'none (auto-discover)'}`);
  console.log(`[SCAN] API tokens: APIFY=${process.env.APIFY_API_TOKEN ? 'SET' : 'MISSING'} ANTHROPIC=${process.env.ANTHROPIC_API_KEY ? 'SET' : 'MISSING'}`);
  const t0 = Date.now();

  // Google first (required)
  let google;
  try { google = await checkGoogle(businessName, city, state); }
  catch (e) { console.error('[SCAN] Google CRASH:', e.message); return { error: 'Google check failed.', businessName, city, state, scannedAt: new Date().toISOString() }; }

  const siteUrl = website || google.website || null;
  const businessType = (google.types || [])[0]?.replace(/_/g, ' ') || industry || 'business';

  // Parallel checks
  const [webR, searchR, compR, fbR, yelpR] = await Promise.allSettled([
    checkWebsite(siteUrl),
    checkSearchVisibility(businessName, city, state, businessType),
    checkCompetitors(businessName, city, state, google),
    checkFacebook(facebookUrl),
    checkYelp(yelpUrl),
  ]);

  const v = r => r.status === 'fulfilled' ? r.value : {};
  const websiteData = v(webR), searchData = v(searchR), facebookData = v(fbR), yelpData = v(yelpR);

  // Use selected competitors if user picked them, otherwise use auto-discovered
  let compData = v(compR);
  if (selectedCompetitors && selectedCompetitors.length > 0) {
    console.log(`[SCAN] Using ${selectedCompetitors.length} user-selected competitors instead of auto-discovered`);
    const selComps = selectedCompetitors.map(c => ({
      name: c.name, rating: c.rating || null, reviewCount: c.reviewCount || 0,
      address: c.address || '', placeId: c.placeId || null, types: c.types || [], estimated: false,
    }));
    // Merge: keep auto-discovered ranking/findings but replace competitor list
    compData = {
      ...compData,
      competitors: selComps,
      totalInArea: (compData.totalInArea || 0) || selComps.length + 1,
      estimated: false,
      source: 'user_selected',
    };
    // Recalculate ranking against selected competitors
    if (google.rating) {
      const all = [{ name: businessName, rating: google.rating, reviewCount: google.reviewCount || 0 }, ...selComps.filter(c => c.rating)];
      all.sort((a, b) => (b.rating * 10 + Math.log((b.reviewCount || 0) + 1)) - (a.rating * 10 + Math.log((a.reviewCount || 0) + 1)));
      compData.ranking = all.findIndex(b => b.name === businessName) + 1;
      compData.totalInArea = all.length;
    }
  }

  // Sequential (need prior data)
  const napData = await checkNAP(google, websiteData).catch(() => ({ rawScore: 0, maxScore: 10, excluded: true, findings: [], dataPoints: 0 }));
  const reviewData = await checkReviews(google).catch(() => ({ rawScore: 0, maxScore: 10, excluded: true, findings: [], dataPoints: 0 }));

  const platforms = { google, website: websiteData, search: searchData, nap: napData, reviews: reviewData, facebook: facebookData, yelp: yelpData };
  const overallScore = calculateScore(platforms);
  const scoreLabel = getScoreLabel(overallScore);

  // Run insights first to extract businessIntelligence, then use it for competitor analysis
  const insights = await generateInsights(businessName, city, state, platforms, overallScore, { industry, biggestChallenge, competitors: compData });
  const competitorAnalysis = await generateCompetitorAnalysis(businessName, city, state, platforms, compData, insights.businessIntelligence);

  const sev = { critical: 0, warning: 1, good: 2 };
  // Only include findings from platforms that actually returned data (not excluded)
  const allFindings = [
    ...(google.excluded ? [] : (google.findings || [])),
    ...(websiteData.excluded ? [] : (websiteData.findings || [])),
    ...(searchData.excluded ? [] : (searchData.findings || [])),
    ...(napData.excluded ? [] : (napData.findings || [])),
    ...(reviewData.excluded ? [] : (reviewData.findings || [])),
    ...(facebookData.excluded ? [] : (facebookData.findings || [])),
    ...(yelpData.excluded ? [] : (yelpData.findings || [])),
    ...(compData.findings || []),
  ].sort((a, b) => (sev[a.severity] ?? 9) - (sev[b.severity] ?? 9));

  const totalDataPoints = (google.dataPoints || 0) + (websiteData.dataPoints || 0) + (searchData.dataPoints || 0) + (compData.dataPoints || 0) + (napData.dataPoints || 0) + (reviewData.dataPoints || 0) + (facebookData.dataPoints || 0) + (yelpData.dataPoints || 0);
  const platformsChecked = Object.values(platforms).filter(p => !p?.excluded).length;
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[SCAN] ═══ DONE in ${elapsed}s. Score: ${overallScore}/100. Findings: ${allFindings.length}. Data points: ${totalDataPoints} ═══`);

  // ── Sales power: estimatedLoss per finding ──
  const lossMap = {
    'Google:critical': 'Customers searching for your type of business are choosing competitors instead',
    'Google:warning': 'You are likely missing a few customer inquiries each week because of this',
    'Website:critical': 'Visitors who land on your site are leaving without contacting you',
    'Website:warning': 'Fewer people are clicking through to your site from search results',
    'Facebook:critical': 'Your page is invisible to local customers who check Facebook before calling',
    'Facebook:warning': 'Competitors with active pages are showing up in local feeds — you are not',
    'NAP:warning': 'Inconsistent info confuses Google and costs you ranking positions',
    'Search:critical': 'Customers searching right now are finding competitors instead of you',
    'Search:warning': 'You are showing up lower than competitors, which means fewer clicks and calls',
    'Reviews:warning': 'Customers comparing you to competitors are choosing the one with better reviews',
    'Reviews:critical': 'Your review profile is turning away customers before they ever contact you',
    'Yelp:critical': 'Customers who check Yelp before calling are choosing reviewed competitors over you',
    'Yelp:warning': 'Your Yelp presence is weaker than competitors — customers comparing options may pass on you',
    'Competitors:warning': 'Competitors with stronger profiles are getting the calls that should be going to you',
  };
  for (const f of allFindings) {
    if (f.severity === 'good') { f.estimatedLoss = ''; continue; }
    f.estimatedLoss = lossMap[`${f.platform}:${f.severity}`] || (f.severity === 'critical' ? 'This is likely costing you real customers every week' : 'This may be quietly reducing your inbound leads');
  }

  // ── Sales power: lossSummary ──
  const criticalCount = allFindings.filter(f => f.severity === 'critical').length;
  const warningCount = allFindings.filter(f => f.severity === 'warning').length;
  const topCompName = (compData?.competitors || [])[0]?.name || null;
  const compPhrase = topCompName ? `businesses like ${topCompName}` : `competitors in ${city || 'your area'}`;
  let lossSummary;
  if (criticalCount >= 3) lossSummary = `Right now, ${businessName} has ${criticalCount} critical gaps in its online presence. Every day these go unfixed, customers in ${city || 'your area'} are finding ${compPhrase} instead of you. Based on what we found, you are likely losing 20–40 potential customers per month to competitors with stronger reviews, better visibility, and more active profiles.`;
  else if (criticalCount >= 1) lossSummary = `${businessName} has real gaps that are sending customers to ${compPhrase}. With ${criticalCount} critical issue${criticalCount > 1 ? 's' : ''} and ${warningCount} area${warningCount !== 1 ? 's' : ''} that need attention, you are likely losing 10–25 customers per month who search for your type of business but end up choosing someone else.`;
  else if (warningCount >= 3) lossSummary = `${businessName}'s online presence is holding you back. While none of these issues are emergencies on their own, together they add up — ${compPhrase} with cleaner profiles, more reviews, and consistent activity are capturing the customers who should be calling you. You may be missing 5–15 leads per month.`;
  else lossSummary = `${businessName} is in a solid position, but competitors in ${city || 'your area'} are not standing still. A few targeted improvements could bring in 3–10 additional customer inquiries per month and widen your lead before competitors catch up.`;

  // ── Sales power: reportHeadline ──
  let reportHeadline;
  if (overallScore < 45) reportHeadline = `Customers in ${city || 'Your Area'} Are Choosing Competitors Over ${businessName} — Here's What's Holding You Back`;
  else if (overallScore < 60) reportHeadline = `${businessName} Is Losing Leads to ${compPhrase} — These Gaps Are Costing You Real Business`;
  else if (overallScore < 75) reportHeadline = `${businessName} Is Close to Winning — Fix These Issues Before Competitors Pull Ahead`;
  else reportHeadline = `${businessName} Has the Edge — Here's How to Dominate ${city || 'Your Market'} Before Competitors Catch Up`;

  // ── Sales power: quickWins (top 3 actionable fixes) ──
  const salesQuickWins = allFindings
    .filter(f => f.severity === 'critical' && f.fix)
    .slice(0, 3)
    .map(f => ({ title: f.title, action: f.fix, impact: f.estimatedLoss || f.impact }));
  // Fill from warnings if not enough criticals
  if (salesQuickWins.length < 3) {
    const fromWarnings = allFindings.filter(f => f.severity === 'warning' && f.fix).slice(0, 3 - salesQuickWins.length);
    for (const f of fromWarnings) salesQuickWins.push({ title: f.title, action: f.fix, impact: f.estimatedLoss || f.impact });
  }

  // ── Sales power: priorityFix (single highest-impact recommendation) ──
  const topFinding = allFindings.find(f => f.severity === 'critical' && f.fix) || allFindings.find(f => f.severity === 'warning' && f.fix);
  const priorityFix = topFinding ? {
    title: topFinding.title,
    reason: topFinding.estimatedLoss || topFinding.impact,
    expectedImpact: topFinding.platform === 'Google' ? `Fixing this could help ${businessName} rank higher and capture more inbound calls from customers in ${city || 'your area'}.`
      : topFinding.platform === 'Website' ? `Fixing this could turn more website visitors into actual customers who call or book with ${businessName}.`
      : topFinding.platform === 'Facebook' ? `Fixing this could make ${businessName} visible again to local customers who check Facebook before choosing a business.`
      : `Fixing this could directly increase the number of customers who find and contact ${businessName}.`,
  } : null;

  // ── Sales power: competitorSummary ──
  const comps = compData?.competitors || [];
  let competitorSummary = '';
  if (comps.length > 0) {
    const topComp = comps[0];
    const avgCompReviews = Math.round(comps.reduce((s, c) => s + c.reviewCount, 0) / comps.length);
    const avgCompRating = (comps.reduce((s, c) => s + c.rating, 0) / comps.length).toFixed(1);
    competitorSummary = `Top competitors in ${city || 'your area'} average ${avgCompRating} stars with ${avgCompReviews} reviews. ${topComp.name} leads with ${topComp.reviewCount} reviews at ${topComp.rating} stars.`;
    if (google.reviewCount < avgCompReviews) competitorSummary += ` With ${google.reviewCount || 0} reviews, you are behind the local average — customers comparing options are more likely to choose a competitor.`;
    else competitorSummary += ` Your review count is competitive, which is a strong advantage to build on.`;
  }

  // ── Apply tier language ──
  console.log(`[SCAN] Applying tier language: plan=${plan}`);
  for (const f of allFindings) { applyTierLanguage(f, plan); }
  const tieredHeadline = applyTierToHeadline(reportHeadline, plan);
  const tieredLoss = applyTierToLossSummary(lossSummary, plan);
  const tieredPriorityFix = applyTierToPriorityFix(priorityFix, plan, businessName);
  const tieredCompetitors = applyTierToCompetitors(compData, competitorAnalysis, competitorSummary, plan);

  return {
    businessName, city, state, scannedAt: new Date().toISOString(),
    plan,
    overallScore, scoreLabel, platforms,
    // Competitors (tier-filtered) — keeps {competitors, ranking, totalInArea, estimated} structure for frontend
    competitors: {
      competitors: tieredCompetitors.competitors,
      ranking: compData?.ranking || null,
      totalInArea: compData?.totalInArea || null,
      estimated: compData?.estimated || false,
      source: compData?.source || null,
    },
    competitorComparison: tieredCompetitors.comparison,
    allFindings,
    // AI insights
    summary: insights.executiveSummary || '', revenueImpact: insights.revenueImpact || '',
    topPriorities: insights.topPriorities || [],
    whatYoureDoingWell: insights.whatYoureDoingWell || [],
    competitorIntel: insights.competitorIntel || '', monthlyGoal: insights.monthlyGoal || '',
    businessIntelligence: insights.businessIntelligence || null,
    // Sales power fields (tier-adjusted)
    reportHeadline: tieredHeadline,
    lossSummary: tieredLoss,
    quickWins: salesQuickWins,
    priorityFix: tieredPriorityFix,
    competitorSummary: plan === 'basic' ? '' : competitorSummary,
    // Data quality
    confidence: platformsChecked >= 5 ? 'high' : platformsChecked >= 3 ? 'medium' : 'low',
    dataQuality: { platformsFound: platformsChecked, platformsChecked: 7, scanTime: elapsed, dataPoints: totalDataPoints, note: platformsChecked >= 5 ? 'Comprehensive' : platformsChecked >= 3 ? 'Good coverage' : 'Limited' },
  };
}

// ══════════════════════════════════════════════════
// LIGHT SCAN (for reps — fast, Google-only, under 5s)
// ══════════════════════════════════════════════════

function buildLightFindings(g) {
  const items = [];

  // Rating
  if (g.rating === 0) items.push({ icon: 'critical', text: 'No Google rating — customers skip businesses without stars' });
  else if (g.rating < 4.0) items.push({ icon: 'critical', text: `Your ${g.rating}-star rating is below the 4.0 threshold — up to 40% of customers filter you out` });
  else if (g.rating < 4.5) items.push({ icon: 'warning', text: `${g.rating} stars — good, but top competitors in your area sit above 4.5` });

  // Reviews
  if (g.reviewCount === 0) items.push({ icon: 'critical', text: 'No Google reviews — this is the #1 thing holding you back' });
  else if (g.reviewCount < 20) items.push({ icon: 'critical', text: `Only ${g.reviewCount} reviews — most customers trust businesses with 50+` });
  else if (g.reviewCount < 50) items.push({ icon: 'warning', text: `You have ${g.reviewCount} reviews — competitors likely have more` });

  // Response rate
  // Response rate check removed — data not reliable from Google Places API

  // Profile gaps
  if (!g.hasHours) items.push({ icon: 'warning', text: 'No business hours listed — customers assume you\'re closed' });
  if (!g.hasWebsite) items.push({ icon: 'critical', text: 'No website on your Google profile — customers can\'t learn about you' });
  if (!g.hasPhone) items.push({ icon: 'warning', text: 'No phone number on your profile — hard for customers to reach you' });
  if (g.photoCount < 5) items.push({ icon: 'warning', text: `Only ${g.photoCount} photos — businesses with 10+ get 42% more calls` });
  if (!g.hasDescription) items.push({ icon: 'warning', text: 'No business description — you\'re missing a chance to tell customers what you do' });

  // Recency
  if (g.daysSinceReview > 180) items.push({ icon: 'warning', text: 'No reviews in the last 6 months — your profile looks inactive' });

  // Status
  if (g.businessStatus && g.businessStatus !== 'OPERATIONAL') items.push({ icon: 'critical', text: 'Google shows your business as closed or inactive' });

  return items;
}

function buildLightExplanation(g, score, problemCount) {
  const name = g.name || 'Your business';
  if (!g.found) return `We couldn't find ${name} on Google. That means customers searching for businesses like yours aren't finding you at all. A full scan will show you exactly how to fix that.`;
  if (score >= 75) return `${name} has a solid Google presence. Your full scan will uncover opportunities across your website, Facebook, and Yelp to pull even further ahead of competitors.`;
  if (score >= 45) return `${name} is showing up on Google, but ${problemCount} issue${problemCount === 1 ? '' : 's'} may be costing you customers. Your full scan checks your website, Facebook, Yelp, and more to show you exactly where you're losing business.`;
  return `${name} has some serious gaps in its online presence. Right now, customers searching in your area are more likely to find your competitors first. A full scan will give you the complete picture and a step-by-step fix plan.`;
}

async function runLightScan({ businessName, city, state }) {
  console.log(`[SCAN] Light: ${businessName}, ${city}`);
  try {
    const g = await checkGoogle(businessName, city, state);

    // Simple scoring (100pts)
    let score = 0;
    if (g.rating >= 4.5) score += 25; else if (g.rating >= 4.0) score += 18; else if (g.rating >= 3.5) score += 10; else if (g.rating > 0) score += 5;
    if (g.reviewCount >= 200) score += 25; else if (g.reviewCount >= 100) score += 18; else if (g.reviewCount >= 50) score += 12; else if (g.reviewCount >= 20) score += 7; else if (g.reviewCount > 0) score += 3;
    if (g.hasHours) score += 5; if (g.hasWebsite) score += 5; if (g.hasPhone) score += 5; if (g.photoCount >= 10) score += 5; if (g.hasDescription) score += 5;
    if (g.daysSinceReview <= 90) score += 15; else score += 3;
    if (g.businessStatus === 'OPERATIONAL') score += 10;
    score = Math.min(score, 100);

    const findings = buildLightFindings(g);
    const topFindings = findings.slice(0, 3);
    const explanation = buildLightExplanation(g, score, findings.length);

    return {
      type: 'light',
      teaser: true,
      headline: `${g.name || businessName} — Online Presence Scan`,
      scoreDisplay: `${score}/100`,
      score,
      scoreLabel: getScoreLabel(score),
      businessName: g.name || businessName,
      city,
      state,
      scannedAt: new Date().toISOString(),

      // Google snapshot (rep talking points)
      rating: g.rating || null,
      reviewCount: g.reviewCount || 0,
      address: g.address || null,

      // Findings (max 3, plain English)
      findings: topFindings,
      moreIssuesCount: Math.max(findings.length - 3, 0),

      // Explanation
      explanation,

      // CTA
      cta: {
        text: 'Unlock Full Scan',
        subtext: 'Website, Facebook, Yelp, competitors, and a custom action plan',
      },
    };
  } catch (e) { console.error('[SCAN] Light CRASH:', e.message); return { error: 'Scan failed. Please try again.', businessName, city, state }; }
}

module.exports = { runFullScan, runLightScan };
