const axios = require('axios');
const cheerio = require('cheerio');

const ax = axios.create({ timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36' } });
const F = (platform, severity, title, description, impact, fix) => ({ platform, severity, title, description, impact: impact || '', fix: fix || '' });
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
  const repliedCount = reviews.filter(r => r.author_url && r.text).length; // rough — Places API doesn't expose owner_reply directly
  const responseRate = reviews.length > 0 ? Math.round((repliedCount / reviews.length) * 100) : 0;

  // SCORING (35pts)
  let raw = 0;
  // Rating (12pts)
  if (rating >= 4.8) raw += 12; else if (rating >= 4.5) raw += 10; else if (rating >= 4.0) raw += 7; else if (rating >= 3.5) raw += 4; else if (rating > 0) raw += 1;
  // Review count (10pts)
  if (reviewCount >= 500) raw += 10; else if (reviewCount >= 200) raw += 8; else if (reviewCount >= 100) raw += 6; else if (reviewCount >= 50) raw += 4; else if (reviewCount >= 20) raw += 2; else if (reviewCount > 0) raw += 1;
  // Response rate (5pts) — estimated from review data
  if (responseRate >= 50) raw += 5; else if (responseRate >= 25) raw += 3; else if (responseRate > 0) raw += 1;
  // Profile (5pts)
  if (hasHours) raw += 1; if (hasWebsite) raw += 1; if (hasPhone) raw += 1; if (photoCount >= 10) raw += 1; if (hasDescription) raw += 1;
  // Recent (3pts)
  if (daysSinceReview <= 30) raw += 3; else if (daysSinceReview <= 90) raw += 2; else if (daysSinceReview <= 180) raw += 1;
  // Authority bonus
  if (reviewCount >= 1000 && rating >= 4.5) raw += 5;
  else if (reviewCount >= 500 && rating >= 4.5) raw += 3;
  raw = Math.min(raw, 35);

  // FINDINGS
  const findings = [];
  if (rating === 0) findings.push(F('Google', 'critical', 'No Google rating', 'Profile has no rating.', 'Businesses without ratings get far fewer clicks.', 'Ask 10 customers for reviews this week.'));
  else if (rating < 4.0) findings.push(F('Google', 'critical', `${rating}-star rating is hurting you`, 'Below the 4.0 customer filter threshold.', 'Up to 40% of customers filter you out.', 'Respond to negatives professionally. Ask happy customers for reviews.'));
  else if (rating < 4.5) findings.push(F('Google', 'warning', `${rating}-star rating — room to improve`, 'Below 4.5 that top businesses maintain.', '', 'Ask every happy customer for a review.'));
  else findings.push(F('Google', 'good', `Strong ${rating}-star rating`, 'Excellent trust signal.', '', ''));

  if (reviewCount < 20) findings.push(F('Google', 'critical', `Only ${reviewCount} reviews`, 'Looks unestablished.', '', 'Start a review campaign. Aim for 50+.'));
  else if (reviewCount < 50) findings.push(F('Google', 'warning', `${reviewCount} reviews — competitors may have more`, '', '', 'Send follow-up texts after every job.'));
  else findings.push(F('Google', 'good', `${reviewCount} reviews`, 'Solid social proof.', '', ''));

  if (responseRate < 10 && reviewCount >= 5) findings.push(F('Google', 'critical', 'Not responding to reviews', `Response rate ~${responseRate}%.`, 'Every unanswered review hurts ranking.', 'Respond to your 5 most recent reviews today — takes 10 minutes. Go to business.google.com/reviews'));
  if (!hasHours) findings.push(F('Google', 'warning', 'Hours missing', 'Customers assume you\'re closed.', '', 'Add hours in Google Business Profile.'));
  if (photoCount < 5) findings.push(F('Google', 'warning', `Only ${photoCount} photos`, 'Listings with 10+ photos get 42% more requests.', '', 'Add photos of storefront, team, and work.'));
  if (!hasWebsite) findings.push(F('Google', 'critical', 'No website linked', 'Customers can\'t learn more.', '', 'Add your website to Google Business Profile.'));
  if (!hasDescription) findings.push(F('Google', 'warning', 'No business description', 'Missing opportunity to tell customers what you do.', '', 'Add a description in Google Business Profile.'));
  if (daysSinceReview > 180) findings.push(F('Google', 'warning', 'No recent reviews', `Last review ${daysSinceReview}+ days ago.`, 'Looks inactive.', 'Ask a customer for a review today.'));
  if (businessStatus !== 'OPERATIONAL') findings.push(F('Google', 'critical', `Status: ${businessStatus}`, 'Customers think you\'re closed.', '', 'Mark business as open in Google Business Profile.'));

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
    if (hasSSL) { raw += 5; findings.push(F('Website', 'good', 'SSL active', '', '', '')); }
    else findings.push(F('Website', 'critical', 'No SSL certificate', 'Browsers show "Not Secure".', 'Customers leave immediately.', 'Install SSL — most hosts offer free via Let\'s Encrypt.'));
  } catch { findings.push(F('Website', 'warning', 'Website unreachable', '', '', 'Check if site is online.')); return { found: false, rawScore: 0, maxScore: 25, excluded: true, hasSSL, findings, dataPoints }; }

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

    if (title && title.length <= 60) { raw += 2; dataPoints++; } else if (title) { raw += 1; dataPoints++; findings.push(F('Website', 'warning', 'Title tag too long', `${title.length} chars.`, '', 'Keep under 60 characters.')); }
    else findings.push(F('Website', 'warning', 'Missing title tag', '', 'Google can\'t index properly.', 'Add a title tag. Guide: https://developers.google.com/search/docs/appearance/title-link'));

    if (metaDesc) { raw += 2; dataPoints++; } else findings.push(F('Website', 'warning', 'No meta description', 'Google writes its own — usually poorly.', '', 'Add meta description under 160 chars.'));
    if (h1) { raw += 1; dataPoints++; } else findings.push(F('Website', 'warning', 'No H1 heading', '', '', 'Add an H1 heading.'));
    if (hasSchema) { raw += 1; dataPoints++; findings.push(F('Website', 'good', 'Schema markup found', '', '', '')); }
    else findings.push(F('Website', 'warning', 'No schema markup', '', 'Google can\'t show rich results.', 'Add LocalBusiness JSON-LD. Generator: https://technicalseo.com/tools/schema-markup-generator/'));
    if (hasPhoneOnSite) { raw += 2; dataPoints++; } else findings.push(F('Website', 'critical', 'No phone number on website', '', 'Customers can\'t call you.', 'Add phone number prominently on every page.'));
    if (hasCTA) { raw += 1; dataPoints++; } else findings.push(F('Website', 'warning', 'No CTA button', 'No book/call/contact button found.', '', 'Add a prominent call-to-action button.'));
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
  if (!key || !googleData?.placeId) return { competitors: [], ranking: null, dataPoints: 0 };
  try {
    const type = googleData.types?.[0] || 'establishment';
    const geo = await ax.get('https://maps.googleapis.com/maps/api/geocode/json', { params: { address: googleData.address || `${city}, ${state}`, key } });
    const loc = geo.data?.results?.[0]?.geometry?.location;
    if (!loc) return { competitors: [], ranking: null, dataPoints: 0 };

    // Try type first, then keyword
    let results = [];
    for (const params of [
      { location: `${loc.lat},${loc.lng}`, radius: 10000, type, key },
      { location: `${loc.lat},${loc.lng}`, radius: 15000, keyword: type.replace(/_/g, ' '), key },
    ]) {
      const r = await ax.get('https://maps.googleapis.com/maps/api/place/nearbysearch/json', { params });
      results = (r.data?.results || []).filter(p => p.place_id !== googleData.placeId && p.rating > 0);
      if (results.length >= 3) break;
    }

    const competitors = results.slice(0, 5).map(p => ({ name: p.name, rating: p.rating || 0, reviewCount: p.user_ratings_total || 0, address: p.vicinity || '' }));
    const all = [{ name: businessName, rating: googleData.rating, reviewCount: googleData.reviewCount }, ...competitors];
    all.sort((a, b) => (b.rating * 10 + Math.log(b.reviewCount + 1)) - (a.rating * 10 + Math.log(a.reviewCount + 1)));
    const ranking = all.findIndex(b => b.name === businessName) + 1;
    const leader = competitors[0];
    const reviewGap = leader ? leader.reviewCount - googleData.reviewCount : 0;

    const findings = [];
    if (ranking > 3) findings.push(F('Competitors', 'warning', `You rank #${ranking} of ${all.length} locally`, '', '', 'Improve reviews and profile to climb rankings.'));
    else if (ranking > 0) findings.push(F('Competitors', 'good', `You rank #${ranking} of ${all.length} locally`, '', '', ''));
    if (reviewGap > 50) findings.push(F('Competitors', 'warning', `Leader has ${reviewGap} more reviews`, `${leader.name} has ${leader.reviewCount} reviews.`, '', 'Close the review gap with a review campaign.'));

    return { competitors, ranking, totalInArea: all.length, reviewGap, findings, dataPoints: competitors.length * 8 };
  } catch (e) { console.log(`[SCAN] Competitors: ${e.message}`); return { competitors: [], ranking: null, dataPoints: 0 }; }
}

// ══════════════════════════════════════════════════
// CHECK 5: NAP CONSISTENCY (10pts max)
// ══════════════════════════════════════════════════
async function checkNAP(googleData, websiteData) {
  console.log('[SCAN] NAP consistency');
  let raw = 0, dataPoints = 0;
  const findings = [];

  if (!googleData?.found) return { rawScore: 0, maxScore: 10, excluded: true, findings: [F('NAP', 'warning', 'Cannot verify — no Google listing', '', '', '')], dataPoints: 0 };

  const gPhone = (googleData.phone || '').replace(/[^0-9]/g, '');
  const gAddr = (googleData.address || '').toLowerCase();
  const html = (websiteData?.html || '').toLowerCase();

  // Phone match (3pts)
  if (gPhone && html.includes(gPhone.slice(-7))) { raw += 3; dataPoints += 2; findings.push(F('NAP', 'good', 'Phone consistent', 'Website phone matches Google.', '', '')); }
  else if (gPhone) { findings.push(F('NAP', 'warning', 'Phone may not match website', 'Google phone not found on your website.', 'Inconsistent info hurts rankings.', 'Make sure your phone number matches everywhere.')); dataPoints += 2; }

  // Address match (3pts)
  const addrParts = gAddr.split(',')[0]?.trim();
  if (addrParts && html.includes(addrParts)) { raw += 3; dataPoints += 2; findings.push(F('NAP', 'good', 'Address consistent', 'Website address matches Google.', '', '')); }
  else if (addrParts) { findings.push(F('NAP', 'warning', 'Address may not match website', '', '', 'Verify address is identical on your website and Google.')); dataPoints += 2; }

  // Business name (2pts)
  const nameLower = (googleData.name || '').toLowerCase();
  if (nameLower && html.includes(nameLower.split(' ')[0])) { raw += 2; dataPoints += 2; }

  // Bing check (2pts)
  try {
    const r = await ax.get(`https://www.bing.com/search?q=${encodeURIComponent(googleData.name + ' ' + googleData.address?.split(',')[1]?.trim())}`, { timeout: 5000 });
    const text = (r.data || '').toLowerCase();
    dataPoints += 2;
    if (gPhone && text.includes(gPhone.slice(-7))) { raw += 2; findings.push(F('NAP', 'good', 'Found on Bing', '', '', '')); }
    else { findings.push(F('NAP', 'warning', 'Info inconsistent on Bing', '', '', 'Claim your listing at bingplaces.com')); }
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
  // Bonus: recent + responsive
  if (googleData.daysSinceReview <= 30) raw += 2;
  if (googleData.responseRate >= 25) raw += 2;
  raw = Math.min(raw, 10);

  if (sentiment?.complaintThemes?.length) findings.push(F('Reviews', 'warning', `Customers mention: ${sentiment.complaintThemes.slice(0, 2).join(', ')}`, 'Recurring complaint themes in recent reviews.', '', 'Address these themes to improve satisfaction.'));
  if (sentiment?.praiseThemes?.length) findings.push(F('Reviews', 'good', `Praised for: ${sentiment.praiseThemes.slice(0, 2).join(', ')}`, '', '', ''));
  if (googleData.responseRate < 10 && googleData.reviewCount >= 5) findings.push(F('Reviews', 'critical', 'Not responding to reviews', `~${googleData.responseRate}% response rate.`, 'Hurts ranking and trust.', 'Respond to 5 reviews today at business.google.com/reviews'));

  return { rawScore: raw, maxScore: 10, score: Math.round((raw / 10) * 100), sentiment, findings, dataPoints };
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
// AI INSIGHTS (Claude Haiku)
// ══════════════════════════════════════════════════
async function generateInsights(biz, city, state, platforms, score, extra) {
  if (!process.env.ANTHROPIC_API_KEY) return { executiveSummary: '', topPriorities: [], quickWins: [], whatYoureDoingWell: [], competitorIntel: '', monthlyGoal: '', revenueImpact: '' };
  const p = platforms, comp = extra.competitors;
  const prompt = `You are a senior digital marketing consultant writing a premium $149 audit. Be specific, data-driven, no fluff. Reference actual numbers.

BUSINESS: ${biz}, ${city}${state ? ', ' + state : ''}${extra.industry ? ' (' + extra.industry + ')' : ''}
SCORE: ${score}/100 — ${getScoreLabel(score)}

Google: ${p.google?.rawScore||0}/35 — ${p.google?.rating||'?'}★ (${p.google?.reviewCount||0} reviews), response ~${p.google?.responseRate||0}%
Website: ${p.website?.rawScore||0}/25 — SSL:${p.website?.hasSSL?'Y':'N'} Speed:${p.website?.perfScore||'?'}/100
Search: ${p.search?.rawScore||0}/20${p.search?.excluded?' (excluded)':''}
NAP: ${p.nap?.rawScore||0}/10${p.nap?.excluded?' (excluded)':''}
Reviews: ${p.reviews?.rawScore||0}/10 sentiment:${p.reviews?.sentiment?.sentimentScore||'?'}/10
${comp?.competitors?.length ? `Competitors: ${comp.competitors.map((c,i)=>`${i+1}. ${c.name} ${c.rating}★ ${c.reviewCount}r`).join(', ')} | Rank #${comp.ranking||'?'}/${comp.totalInArea||'?'}` : ''}
${extra.biggestChallenge ? `Owner: "${extra.biggestChallenge}"` : ''}

Return ONLY JSON:
{"executiveSummary":"2-3 sentences with actual numbers","revenueImpact":"$ estimate with math shown","topPriorities":[{"priority":1,"title":"action","whyItMatters":"impact","howToFixIt":"exact steps","timeToComplete":"X min","difficulty":"easy","estimatedROI":"$/mo","selfServeLink":"URL"},{"priority":2,"title":"...","whyItMatters":"...","howToFixIt":"...","timeToComplete":"...","difficulty":"...","estimatedROI":"...","selfServeLink":"..."},{"priority":3,"title":"...","whyItMatters":"...","howToFixIt":"...","timeToComplete":"...","difficulty":"...","estimatedROI":"...","selfServeLink":"..."}],"quickWins":[{"title":"...","steps":["step1","step2"],"link":"URL","timeNeeded":"10 min"},{"title":"...","steps":["..."],"link":"...","timeNeeded":"..."},{"title":"...","steps":["..."],"link":"...","timeNeeded":"..."}],"whatYoureDoingWell":["specific positive 1","specific positive 2"],"competitorIntel":"specific comparison","monthlyGoal":"measurable goal with target number"}`;

  try {
    const res = await axios.post('https://api.anthropic.com/v1/messages', { model: 'claude-haiku-4-5-20251001', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 20000 });
    const text = res.data?.content?.[0]?.text || '';
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : { executiveSummary: text };
  } catch (e) { console.error('[SCAN] AI:', e.message); return { executiveSummary: '' }; }
}

// ══════════════════════════════════════════════════
// FULL AUDIT
// ══════════════════════════════════════════════════
async function runFullScan({ businessName, city, state, website, industry, biggestChallenge }) {
  console.log(`[SCAN] ═══ FULL AUDIT: ${businessName}, ${city} ═══`);
  const t0 = Date.now();

  // Google first (required)
  let google;
  try { google = await checkGoogle(businessName, city, state); }
  catch (e) { console.error('[SCAN] Google CRASH:', e.message); return { error: 'Google check failed.', businessName, city, state, scannedAt: new Date().toISOString() }; }

  const siteUrl = website || google.website || null;
  const businessType = (google.types || [])[0]?.replace(/_/g, ' ') || industry || 'business';

  // Parallel checks
  const [webR, searchR, compR] = await Promise.allSettled([
    checkWebsite(siteUrl),
    checkSearchVisibility(businessName, city, state, businessType),
    checkCompetitors(businessName, city, state, google),
  ]);

  const v = r => r.status === 'fulfilled' ? r.value : {};
  const websiteData = v(webR), searchData = v(searchR), compData = v(compR);

  // Sequential (need prior data)
  const napData = await checkNAP(google, websiteData).catch(() => ({ rawScore: 0, maxScore: 10, excluded: true, findings: [], dataPoints: 0 }));
  const reviewData = await checkReviews(google).catch(() => ({ rawScore: 0, maxScore: 10, excluded: true, findings: [], dataPoints: 0 }));

  const platforms = { google, website: websiteData, search: searchData, nap: napData, reviews: reviewData };
  const overallScore = calculateScore(platforms);
  const scoreLabel = getScoreLabel(overallScore);

  const insights = await generateInsights(businessName, city, state, platforms, overallScore, { industry, biggestChallenge, competitors: compData });

  const sev = { critical: 0, warning: 1, good: 2 };
  const allFindings = [
    ...(google.findings || []), ...(websiteData.findings || []),
    ...(searchData.findings || []), ...(napData.findings || []),
    ...(reviewData.findings || []), ...(compData.findings || []),
  ].sort((a, b) => (sev[a.severity] ?? 9) - (sev[b.severity] ?? 9));

  const totalDataPoints = (google.dataPoints || 0) + (websiteData.dataPoints || 0) + (searchData.dataPoints || 0) + (compData.dataPoints || 0) + (napData.dataPoints || 0) + (reviewData.dataPoints || 0);
  const platformsChecked = Object.values(platforms).filter(p => !p?.excluded).length;
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[SCAN] ═══ DONE in ${elapsed}s. Score: ${overallScore}/100. Findings: ${allFindings.length}. Data points: ${totalDataPoints} ═══`);

  return {
    businessName, city, state, scannedAt: new Date().toISOString(),
    overallScore, scoreLabel, platforms, competitors: compData,
    allFindings,
    summary: insights.executiveSummary || '', revenueImpact: insights.revenueImpact || '',
    topPriorities: insights.topPriorities || [], quickWins: insights.quickWins || [],
    whatYoureDoingWell: insights.whatYoureDoingWell || [],
    competitorIntel: insights.competitorIntel || '', monthlyGoal: insights.monthlyGoal || '',
    confidence: platformsChecked >= 4 ? 'high' : platformsChecked >= 3 ? 'medium' : 'low',
    dataQuality: { platformsFound: platformsChecked, platformsChecked: 5, scanTime: elapsed, dataPoints: totalDataPoints, note: platformsChecked >= 4 ? 'Comprehensive' : platformsChecked >= 3 ? 'Good coverage' : 'Limited' },
  };
}

// ══════════════════════════════════════════════════
// LIGHT SCAN (for reps — under $0.015, under 5s)
// ══════════════════════════════════════════════════
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

    // Top 3 problems only
    const problems = (g.findings || []).filter(f => f.severity !== 'good').slice(0, 3).map(f => ({
      severity: f.severity, title: f.title, preview: f.description?.slice(0, 80) || f.impact?.slice(0, 80) || ''
    }));
    const totalFindings = (g.findings || []).filter(f => f.severity !== 'good').length;

    return {
      type: 'light', teaser: true, businessName: g.name || businessName, city, state,
      scannedAt: new Date().toISOString(), score, scoreLabel: getScoreLabel(score),
      rating: g.rating, reviewCount: g.reviewCount, address: g.address, phone: g.phone,
      website: g.website, hasHours: g.hasHours, hasWebsite: g.hasWebsite, hasPhone: g.hasPhone,
      photoCount: g.photoCount, recentReview: g.daysSinceReview <= 90,
      topProblems: problems, hiddenFindings: Math.max(totalFindings - 3, 15),
      message: problems.length > 0
        ? `${totalFindings} issues found affecting your Google ranking and customer acquisition. Full audit reveals the complete picture.`
        : 'Your Google profile looks solid. Full audit checks website, search rankings, NAP consistency, and reviews in depth.',
      ctaText: 'See Full Audit — $149',
    };
  } catch (e) { console.error('[SCAN] Light CRASH:', e.message); return { error: 'Scan failed.', businessName, city, state }; }
}

module.exports = { runFullScan, runLightScan };
