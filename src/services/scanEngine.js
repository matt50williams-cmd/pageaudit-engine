const axios = require('axios');
const cheerio = require('cheerio');

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

  // SCORING (35pts)
  let raw = 0;
  if (rating >= 4.8) raw += 14; else if (rating >= 4.5) raw += 12; else if (rating >= 4.0) raw += 9; else if (rating >= 3.5) raw += 5; else if (rating > 0) raw += 2;
  if (reviewCount >= 500) raw += 11; else if (reviewCount >= 200) raw += 9; else if (reviewCount >= 100) raw += 7; else if (reviewCount >= 50) raw += 5; else if (reviewCount >= 20) raw += 3; else if (reviewCount > 0) raw += 1;
  if (hasHours) raw += 1; if (hasWebsite) raw += 1; if (hasPhone) raw += 1; if (photoCount >= 10) raw += 1; if (hasDescription) raw += 1;
  if (daysSinceReview <= 30) raw += 3; else if (daysSinceReview <= 90) raw += 2; else if (daysSinceReview <= 180) raw += 1;
  if (reviewCount >= 1000 && rating >= 4.5) raw += 2; else if (reviewCount >= 500 && rating >= 4.5) raw += 1;
  raw = Math.min(raw, 35);

  // FINDINGS
  const findings = [];
  if (rating === 0) findings.push(F('Google', 'critical', 'No Google rating', 'On your Google Business Profile, there is no star rating visible to customers.', 'When someone searches for your type of business, Google shows rated competitors first — you are invisible in comparison.', 'Ask 10 of your best customers to leave a Google review this week.'));
  else if (rating < 4.0) findings.push(F('Google', 'critical', `${rating}-star rating is below the trust threshold`, `On your Google Business Profile, your ${rating}-star rating falls below the 4.0 mark.`, 'Up to 40% of customers automatically skip businesses rated below 4.0.', 'Respond professionally to every negative review. Ask your 5 happiest customers to leave a review today.'));
  else if (rating < 4.5) findings.push(F('Google', 'warning', `${rating}-star rating — close but not top-tier`, `On your Google Business Profile, your ${rating}-star rating sits below the 4.5+ that top competitors maintain.`, 'Customers comparing businesses will pick the one with higher stars.', 'Ask every satisfied customer for a review.'));
  else findings.push(F('Google', 'good', `Strong ${rating}-star rating`, `Your ${rating}-star rating is a strong trust signal.`, '', ''));

  if (reviewCount === 0) findings.push(F('Google', 'critical', 'No Google reviews', 'You have zero reviews on Google.', 'Customers trust reviews more than ads.', 'Send your 10 best customers a direct link to your Google review page.'));
  else if (reviewCount < 20) findings.push(F('Google', 'critical', `Only ${reviewCount} reviews`, `You have just ${reviewCount} reviews.`, 'Businesses with fewer than 20 reviews look unestablished.', 'Text or email every customer after service with your Google review link.'));
  else if (reviewCount < 50) findings.push(F('Google', 'warning', `${reviewCount} reviews — competitors likely have more`, `You have ${reviewCount} reviews.`, 'Competitors with 100+ reviews appear more trustworthy.', 'Send a follow-up text after every job asking for a review.'));
  else findings.push(F('Google', 'good', `${reviewCount} reviews — solid social proof`, `${reviewCount} reviews show customers your business is active and trusted.`, '', ''));

  if (!hasHours) findings.push(F('Google', 'warning', 'Business hours not listed', 'Your operating hours are missing from Google.', 'Customers assume you might be closed.', 'Add hours in Google Business Profile.'));
  if (photoCount < 5) findings.push(F('Google', 'warning', `Only ${photoCount} photo${photoCount === 1 ? '' : 's'}`, `You have only ${photoCount} photo${photoCount === 1 ? '' : 's'} on Google.`, 'Businesses with 10+ photos get 42% more requests for directions.', 'Upload photos of your storefront, team, and work.'));
  if (!hasWebsite) findings.push(F('Google', 'critical', 'No website linked on Google', 'No website link on your Google profile.', 'Customers can\'t learn more about your services.', 'Add your website URL in Google Business Profile.'));
  if (!hasDescription) findings.push(F('Google', 'warning', 'No business description', 'The business description field is empty.', 'Missed opportunity to tell customers what you do.', 'Write a 2-3 sentence description in Google Business Profile.'));
  if (daysSinceReview > 180) findings.push(F('Google', 'warning', 'No recent reviews', `Last review over ${Math.round(daysSinceReview / 30)} months ago.`, 'An inactive review profile signals the business may have slowed down.', 'Ask a recent customer for a review today.'));
  if (businessStatus !== 'OPERATIONAL') findings.push(F('Google', 'critical', `Google shows business as "${businessStatus.toLowerCase()}"`, `Business status is "${businessStatus}" instead of "Operational".`, 'Customers who see this will not contact you.', 'Update your status in Google Business Profile immediately.'));

  return { found: true, placeId: candidate.place_id, name: d.name || businessName, rating, reviewCount, address: d.formatted_address || '', phone: d.formatted_phone_number || '', website: d.website || '', hasHours, hoursComplete, photoCount, hasWebsite, hasPhone, hasDescription, businessStatus, types, daysSinceReview, reviews: reviews.slice(0, 5).map(r => ({ text: r.text?.slice(0, 200), rating: r.rating, time: r.time })), rawScore: raw, maxScore: 35, score: Math.round((raw / 35) * 100), findings, dataPoints: 15 + reviews.length * 5 };
}

// ══════════════════════════════════════════════════
// CHECK 2: WEBSITE + SOCIAL LINK EXTRACTION (25pts max)
// ══════════════════════════════════════════════════
async function checkWebsite(websiteUrl) {
  if (!websiteUrl) return { found: false, rawScore: 0, maxScore: 25, excluded: true, findings: [], socialLinks: {} };
  const url = cleanUrl(websiteUrl);
  console.log(`[SCAN] Website: ${url}`);
  let raw = 0, dataPoints = 0;
  const findings = [];
  const socialLinks = {};

  // SSL + fetch (5pts)
  let hasSSL = false, html = '';
  try {
    const r = await ax.get(url, { timeout: 8000, maxRedirects: 5 });
    hasSSL = (r.request?.res?.responseUrl || r.config?.url || '').startsWith('https://');
    html = r.data || '';
    dataPoints += 1;
    if (hasSSL) { raw += 5; findings.push(F('Website', 'good', 'SSL security is active', 'Security padlock is visible in the browser.', '', '')); }
    else findings.push(F('Website', 'critical', 'No SSL security — browser shows "Not Secure"', 'Visitors see a "Not Secure" warning.', 'Most customers leave immediately.', 'Enable SSL through your hosting provider.'));
  } catch { findings.push(F('Website', 'warning', 'Website is unreachable', 'Your website could not be loaded.', 'Customers see an error page.', 'Check that your site is online.')); return { found: false, rawScore: 0, maxScore: 25, excluded: true, hasSSL, findings, dataPoints, socialLinks }; }

  // Extract social/directory links from website HTML
  if (html) {
    const $ = cheerio.load(html);
    const links = $('a[href]').map((i, el) => $(el).attr('href')).get();
    for (const link of links) {
      if (!link) continue;
      if (link.includes('facebook.com') && !link.includes('/sharer') && !link.includes('/share') && !socialLinks.facebook) socialLinks.facebook = link;
      if (link.includes('yelp.com/biz') && !socialLinks.yelp) socialLinks.yelp = link;
      if (link.includes('bbb.org') && !socialLinks.bbb) socialLinks.bbb = link;
      if (link.includes('instagram.com') && !socialLinks.instagram) socialLinks.instagram = link;
      if ((link.includes('google.com/maps') || link.includes('g.page')) && !socialLinks.googleMaps) socialLinks.googleMaps = link;
      if (link.includes('twitter.com') || link.includes('x.com')) socialLinks.twitter = link;
      if (link.includes('linkedin.com')) socialLinks.linkedin = link;
      if (link.includes('youtube.com')) socialLinks.youtube = link;
      if (link.includes('tiktok.com')) socialLinks.tiktok = link;
      if (link.includes('nextdoor.com')) socialLinks.nextdoor = link;
      if (link.includes('angieslist.com') || link.includes('angi.com')) socialLinks.angi = link;
      if (link.includes('homeadvisor.com')) socialLinks.homeadvisor = link;
      if (link.includes('thumbtack.com')) socialLinks.thumbtack = link;
    }
    console.log(`[SCAN] Social links found: ${Object.keys(socialLinks).join(', ') || 'none'}`);

    // Meta/SEO checks (10pts)
    const title = $('title').text().trim();
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    const h1 = $('h1').first().text().trim();
    const hasSchema = html.includes('application/ld+json');
    const hasPhoneOnSite = /(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})|tel:/i.test(html);
    const hasAddr = /\b\d{2,5}\s+[A-Z][a-z]+\s+(St|Ave|Blvd|Dr|Rd|Ln|Way|Ct)/i.test(html);
    const hasCTA = /book\s*(now|online|appointment)|call\s*(us|now|today)|contact\s*us|schedule|get\s*quote/i.test(html);

    if (title && title.length <= 60) { raw += 2; dataPoints++; }
    else if (title) { raw += 1; dataPoints++; findings.push(F('Website', 'warning', 'Page title is too long', `Title is ${title.length} characters — Google will cut it off.`, 'Truncated title looks unprofessional in search results.', 'Shorten title to under 60 characters.')); }
    else findings.push(F('Website', 'warning', 'Missing page title', 'No title tag on your website.', 'Google guesses what to show — usually poorly.', 'Add a title tag with your business name and main service.'));

    if (metaDesc) { raw += 2; dataPoints++; }
    else findings.push(F('Website', 'warning', 'No Google preview description', 'No meta description on your website.', 'Google auto-generates from random page text.', 'Add a meta description under 160 characters.'));

    if (h1) { raw += 1; dataPoints++; } else findings.push(F('Website', 'warning', 'No main headline on homepage', 'No H1 heading visible.', 'Visitors don\'t immediately know what you do.', 'Add a clear headline at the top of your homepage.'));
    if (hasSchema) { raw += 1; dataPoints++; } else findings.push(F('Website', 'warning', 'No structured data for Google', 'No schema markup found.', 'Google can\'t show rich details in search results.', 'Add LocalBusiness JSON-LD markup.'));
    if (hasPhoneOnSite) { raw += 2; dataPoints++; } else findings.push(F('Website', 'critical', 'No phone number visible', 'No phone number found on your website.', 'Customers who want to call you right now cannot.', 'Add your phone number to the header of every page.'));
    if (hasCTA) { raw += 1; dataPoints++; } else findings.push(F('Website', 'warning', 'No clear call-to-action', 'No book/call/contact button found.', 'Visitors don\'t know what to do next.', 'Add a "Call Now" or "Book Online" button.'));
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
    else if (perfScore >= 50) { raw += 4; findings.push(F('Website', 'warning', `Speed ${perfScore}/100 — slow`, 'Below 70 threshold.', '53% of users leave slow sites.', 'Optimize images and test at gtmetrix.com')); }
    else if (perfScore > 0) { raw += 1; findings.push(F('Website', 'critical', `Speed ${perfScore}/100 — very slow`, 'Losing 53% of mobile visitors.', 'Google penalizes slow sites.', 'Major speed overhaul needed.')); }
  } catch (e) { console.log(`[SCAN] PageSpeed: ${e.message}`); }

  raw = Math.min(raw, 25);
  return { found: true, hasSSL, perfScore, loadTime, html, rawScore: raw, maxScore: 25, score: Math.round((raw / 25) * 100), findings, dataPoints, socialLinks };
}

// ══════════════════════════════════════════════════
// CHECK 3: SIMPLE FACEBOOK PAGE CHECK (10pts max)
// ══════════════════════════════════════════════════
async function checkFacebookPage(facebookUrl) {
  if (!facebookUrl) return { excluded: true, rawScore: 0, maxScore: 10, findings: [], found: false };
  console.log(`[SCAN] Facebook: ${facebookUrl}`);
  try {
    const res = await ax.get(facebookUrl, { timeout: 8000 });
    const html = res.data || '';
    const $ = cheerio.load(html);
    const hasPage = res.status === 200 && html.length > 1000;
    const title = $('title').text();
    const hasLikes = /likes|followers|people follow/i.test(html);
    const findings = [];
    if (!hasPage) findings.push(F('Facebook', 'warning', 'Facebook page may not be active', 'Your Facebook page was found but may have limited visibility.', 'Customers checking social proof cannot find your activity.', 'Post regularly and ensure your page is set to public.'));
    console.log(`[SCAN] Facebook: found=${hasPage} title="${title?.slice(0, 50)}"`);
    return { excluded: false, rawScore: hasPage ? (hasLikes ? 8 : 5) : 0, maxScore: 10, found: hasPage, title, url: facebookUrl, findings, dataPoints: 2 };
  } catch (e) {
    console.log(`[SCAN] Facebook fetch failed: ${e.message}`);
    return { excluded: true, rawScore: 0, maxScore: 10, findings: [], found: false };
  }
}

// ══════════════════════════════════════════════════
// CHECK 4: SIMPLE YELP PAGE CHECK (10pts max)
// ══════════════════════════════════════════════════
async function checkYelpPage(yelpUrl) {
  if (!yelpUrl) return { excluded: true, rawScore: 0, maxScore: 10, findings: [], found: false };
  console.log(`[SCAN] Yelp: ${yelpUrl}`);
  try {
    const res = await ax.get(yelpUrl, { timeout: 8000 });
    const $ = cheerio.load(res.data || '');
    const found = res.status === 200;
    const ratingText = $('[class*="rating"]').first().text();
    const rating = parseFloat(ratingText) || null;
    console.log(`[SCAN] Yelp: found=${found} rating=${rating}`);
    return { excluded: false, rawScore: found ? 6 : 0, maxScore: 10, found, rating, url: yelpUrl, findings: [], dataPoints: 2 };
  } catch (e) {
    console.log(`[SCAN] Yelp fetch failed: ${e.message}`);
    return { excluded: true, rawScore: 0, maxScore: 10, findings: [], found: false };
  }
}

// ══════════════════════════════════════════════════
// CHECK 5: NAP CONSISTENCY (10pts max)
// ══════════════════════════════════════════════════
async function checkNAP(googleData, websiteData) {
  console.log('[SCAN] NAP consistency');
  let raw = 0, dataPoints = 0;
  const findings = [];
  if (!googleData?.found) return { rawScore: 0, maxScore: 10, excluded: true, findings: [], dataPoints: 0 };

  const gPhone = (googleData.phone || '').replace(/[^0-9]/g, '');
  const gAddr = (googleData.address || '').toLowerCase();
  const html = (websiteData?.html || '').toLowerCase();

  if (gPhone && html.includes(gPhone.slice(-7))) { raw += 3; dataPoints += 2; findings.push(F('NAP', 'good', 'Phone number is consistent', 'Website phone matches Google.', '', '')); }
  else if (gPhone) { findings.push(F('NAP', 'warning', 'Phone number may not match', 'Google phone not found on your website.', 'Inconsistent info hurts Google ranking.', 'Make sure the same phone number appears everywhere.')); dataPoints += 2; }

  const addrParts = gAddr.split(',')[0]?.trim();
  if (addrParts && html.includes(addrParts)) { raw += 3; dataPoints += 2; findings.push(F('NAP', 'good', 'Address is consistent', 'Website address matches Google.', '', '')); }
  else if (addrParts) { findings.push(F('NAP', 'warning', 'Address may not match', 'Google address not found on website.', 'Address mismatches hurt local search ranking.', 'Verify address is identical on website and Google.')); dataPoints += 2; }

  const nameLower = (googleData.name || '').toLowerCase();
  if (nameLower && html.includes(nameLower.split(' ')[0])) { raw += 2; dataPoints += 2; }

  // Multiple domain check
  if (html) {
    const domainMatches = html.match(/https?:\/\/([a-z0-9][-a-z0-9]*\.)+[a-z]{2,}/gi) || [];
    const uniqueDomains = new Set();
    for (const u of domainMatches) {
      try {
        const host = new URL(u).hostname.replace(/^www\./, '');
        if (host && host.length > 5 && !/(google|facebook|yelp|instagram|twitter|linkedin|youtube|gstatic|googleapis)/.test(host)) uniqueDomains.add(host);
      } catch {}
    }
    const googleDomain = googleData.website ? new URL(googleData.website).hostname.replace(/^www\./, '') : null;
    if (uniqueDomains.size > 1 && googleDomain) {
      const others = [...uniqueDomains].filter(d => d !== googleDomain);
      if (others.length > 0) findings.push(F('NAP', 'warning', 'Multiple website domains detected', `Your website references ${uniqueDomains.size} different domains.`, 'Multiple domains can confuse Google about your primary site.', 'Make sure all pages point to one primary domain.'));
    }
  }

  // Bing check (2pts)
  try {
    const r = await ax.get(`https://www.bing.com/search?q=${encodeURIComponent(googleData.name + ' ' + (googleData.address?.split(',')[1]?.trim() || ''))}`, { timeout: 5000 });
    const text = (r.data || '').toLowerCase();
    dataPoints += 2;
    if (gPhone && text.includes(gPhone.slice(-7))) { raw += 2; findings.push(F('NAP', 'good', 'Found on Bing', 'Business info appears on Bing.', '', '')); }
    else findings.push(F('NAP', 'warning', 'Info inconsistent on Bing', 'Business info on Bing doesn\'t match Google.', 'Bing powers Alexa, Siri, and many directories.', 'Claim your listing at bingplaces.com'));
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

  const ss = sentiment?.sentimentScore || 0;
  if (ss >= 8) raw += 10; else if (ss >= 6) raw += 7; else if (ss >= 4) raw += 4; else if (ss > 0) raw += 1;
  if (googleData.daysSinceReview <= 30) raw += 2;
  if (googleData.daysSinceReview <= 90) raw += 1;
  raw = Math.min(raw, 10);

  if (sentiment?.complaintThemes?.length) findings.push(F('Reviews', 'warning', `Customers mention: ${sentiment.complaintThemes.slice(0, 2).join(', ')}`, 'Recurring complaint themes in recent reviews.', '', 'Address these themes to improve satisfaction.'));
  if (sentiment?.praiseThemes?.length) findings.push(F('Reviews', 'good', `Praised for: ${sentiment.praiseThemes.slice(0, 2).join(', ')}`, '', '', ''));

  return { rawScore: raw, maxScore: 10, score: Math.round((raw / 10) * 100), sentiment, findings, dataPoints };
}

// ══════════════════════════════════════════════════
// CHECK 7: COMPETITORS (Google Text Search)
// ══════════════════════════════════════════════════
async function checkCompetitors(businessName, city, state, googleData) {
  console.log(`[SCAN] Competitors: ${businessName}`);
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return { competitors: [], ranking: null, dataPoints: 0, estimated: true, source: 'no_api_key' };

  try {
    const GENERIC = ['establishment', 'point_of_interest', 'local_business', 'store', 'premise'];
    const primaryType = (googleData?.types || []).find(t => !GENERIC.includes(t));
    const TYPE_TO_QUERY = {
      'hvac_contractor': 'heating cooling HVAC', 'heating_contractor': 'heating cooling HVAC',
      'air_conditioning_contractor': 'heating cooling HVAC', 'electrician': 'electrician electrical contractor',
      'plumber': 'plumber plumbing', 'roofing_contractor': 'roofing contractor',
      'general_contractor': 'general contractor', 'painter': 'painting contractor',
      'locksmith': 'locksmith', 'moving_company': 'moving company',
      'car_repair': 'auto repair mechanic', 'car_dealer': 'car dealership',
      'dentist': 'dentist dental', 'doctor': 'doctor medical',
      'lawyer': 'lawyer attorney', 'real_estate_agency': 'real estate agent',
      'restaurant': 'restaurant', 'hair_care': 'hair salon barber',
      'beauty_salon': 'beauty salon spa', 'gym': 'gym fitness',
      'veterinary_care': 'veterinarian vet', 'accounting': 'accountant CPA',
    };
    const keyword = TYPE_TO_QUERY[primaryType] || (primaryType ? primaryType.replace(/_/g, ' ') : 'contractor');
    const bizPlaceId = googleData?.placeId || null;
    console.log(`[SCAN] Competitor search keyword: "${keyword}" (from type: ${primaryType || 'none'})`);

    let results = [];
    for (const query of [`${keyword} ${city} ${state}`, `${keyword} near ${city}`]) {
      try {
        const r = await ax.get('https://maps.googleapis.com/maps/api/place/textsearch/json', { params: { query, key }, timeout: 8000 });
        const filtered = (r.data?.results || []).filter(p => p.place_id !== bizPlaceId);
        if (filtered.length > results.length) results = filtered;
        if (results.length >= 8) break;
      } catch {}
    }

    const competitors = results.slice(0, 5).map(p => ({
      name: p.name, rating: p.rating || null, reviewCount: p.user_ratings_total || 0,
      address: p.formatted_address || p.vicinity || '', placeId: p.place_id || null,
      types: p.types || [], estimated: !p.rating,
    }));

    let ranking = null, totalInArea = competitors.length + 1;
    if (googleData?.rating && competitors.length > 0) {
      const all = [{ name: businessName, rating: googleData.rating, reviewCount: googleData.reviewCount || 0 }, ...competitors.filter(c => c.rating)];
      all.sort((a, b) => (b.rating * 10 + Math.log((b.reviewCount || 0) + 1)) - (a.rating * 10 + Math.log((a.reviewCount || 0) + 1)));
      ranking = all.findIndex(b => b.name === businessName) + 1;
      totalInArea = all.length;
    }

    const findings = [];
    if (ranking && ranking > 3) findings.push(F('Competitors', 'warning', `You rank #${ranking} out of ${totalInArea} nearby`, `${totalInArea} competitors appear when customers search — you are #${ranking}.`, 'Customers rarely look past the top 3.', 'Get more reviews and complete your Google profile.'));
    else if (ranking) findings.push(F('Competitors', 'good', `You rank #${ranking} out of ${totalInArea} nearby`, '', '', ''));

    return { competitors, ranking, totalInArea, findings, dataPoints: competitors.length * 8, estimated: competitors.length === 0, source: 'google_text_search' };
  } catch (e) { console.error(`[SCAN] Competitors error: ${e.message}`); return { competitors: [], ranking: null, dataPoints: 0, estimated: true, source: 'error' }; }
}

// ══════════════════════════════════════════════════
// WEB RESEARCH (Claude with web_search tool)
// ══════════════════════════════════════════════════
async function researchBusinessOnWeb(businessName, city, state, website, socialLinks, googleData) {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const PRIORITY_TYPES = ['hvac_contractor', 'heating_contractor', 'air_conditioning_contractor'];
  const GENERIC = ['establishment', 'point_of_interest', 'local_business', 'electrician', 'general_contractor'];
  const types = googleData?.types || [];
  let primaryType = types.find(t => PRIORITY_TYPES.includes(t)) || types.find(t => !GENERIC.includes(t)) || types.find(t => !['establishment', 'point_of_interest', 'local_business'].includes(t));
  const businessType = primaryType ? primaryType.replace(/_/g, ' ') : 'local business';

  try {
    console.log(`[WEB RESEARCH] Using model: claude-sonnet-4-5, API key: ${process.env.ANTHROPIC_API_KEY ? 'SET (' + process.env.ANTHROPIC_API_KEY.slice(0, 8) + '...)' : 'MISSING'}`);
    console.log(`[WEB RESEARCH] Deep research starting for ${businessName} (${businessType})...`);
    const res = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `You are a senior business intelligence analyst. Research "${businessName}" in ${city}, ${state} thoroughly. This is a ${businessType} business with a website at ${website || 'unknown'}.

You must search for ALL of the following. Do not skip any:

1. Search "${businessName} ${city} reviews" — find their overall reputation
2. Search "${businessName} BBB" — find their BBB rating, accreditation status, number of complaints, and what complaints are about
3. Search "${businessName} Yelp" — find their Yelp rating, review count, and what customers say
4. Search "${businessName} complaints" — find any negative press, complaints, or issues
5. Search "${businessName} Facebook" — find their Facebook page, how active it is, follower count
6. Search "${businessType} ${city} ${state} best" — find who their real competitors are and what makes them stand out
7. Search their top competitor name + "reviews" — understand what that competitor does better
8. Search "${businessName}" alone — find any news, press, awards, or mentions
9. Search "${businessType} ${city} customer complaints" — understand what customers in this market complain about industry-wide
10. Search "${businessName} owner" OR "${businessName} about" — find their story, how long in business, values

After ALL searches are complete, return ONLY a JSON object with this exact structure:

{
  "companyOverview": {
    "founded": "year or null",
    "owners": "owner names if found",
    "locations": ["list of locations"],
    "serviceArea": "area they serve",
    "specialties": ["main services"],
    "certifications": ["any certifications or partnerships found"],
    "awardsOrRecognition": ["any awards or press mentions"],
    "uniqueStrengths": ["what makes them genuinely stand out"]
  },
  "bbb": { "found": true, "rating": "A+", "accredited": true, "complaintCount": 0, "complaintPatterns": ["what complaints are about if found"], "url": "url or null" },
  "yelp": { "found": true, "rating": 0.0, "reviewCount": 0, "topPraise": ["what customers praise"], "topComplaints": ["what customers complain about"], "url": "url or null" },
  "facebook": { "found": true, "url": "url or null", "followerCount": "approximate if found", "postingFrequency": "daily/weekly/monthly/inactive/unknown", "lastPostApprox": "rough timeframe or unknown" },
  "reviewPatterns": {
    "overallSentiment": "positive/mixed/negative",
    "topPraiseThemes": ["specific things customers love"],
    "topComplaintThemes": ["specific recurring complaints"],
    "operationalInsights": ["patterns suggesting operational issues"],
    "staffMentions": ["specific staff mentioned positively or negatively"],
    "competitiveInsights": ["things reviewers say comparing to competitors"]
  },
  "realCompetitors": [
    { "name": "competitor", "type": "same type", "rating": 0.0, "reviewCount": 0, "whatTheyDoBetter": "specific advantage", "whatTheyDoWorse": "specific weakness", "keyDifferentiator": "why customers choose them" }
  ],
  "marketIntelligence": {
    "industryComplaints": ["what customers complain about industry-wide"],
    "winningFactors": ["what separates top businesses"],
    "opportunities": ["specific market gaps"]
  },
  "onlinePresenceGaps": ["specific things missing from their online presence"],
  "redFlags": ["any serious concerns found"],
  "positives": ["notable achievements or strengths"],
  "confidenceLevel": "high/medium/low"
}`
      }]
    }, { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 120000 });

    const textBlock = res.data?.content?.find(b => b.type === 'text');
    if (!textBlock) { console.log('[WEB RESEARCH] No text block'); return null; }
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log(`[WEB RESEARCH] Complete. BBB=${parsed.bbb?.found} Yelp=${parsed.yelp?.found} Competitors=${parsed.realCompetitors?.length} Confidence=${parsed.confidenceLevel}`);
      return parsed;
    }
    return null;
  } catch (e) {
    console.error(`[WEB RESEARCH] FAILED: ${e.message}`);
    console.error(`[WEB RESEARCH] Status: ${e.response?.status}`);
    console.error(`[WEB RESEARCH] Response: ${JSON.stringify(e.response?.data)?.slice(0, 500)}`);
    return null;
  }
}

// ══════════════════════════════════════════════════
// BUSINESS INTELLIGENCE (from website HTML)
// ══════════════════════════════════════════════════
async function extractBusinessIntelligence(html, googleData, businessName, city, state) {
  if (!html || html.length < 500 || !process.env.ANTHROPIC_API_KEY) return null;
  try {
    const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 4000);
    const prompt = `Extract business information from this website.\n\nBUSINESS: ${businessName}, ${city} ${state || ''}\nGOOGLE CATEGORIES: ${(googleData?.types || []).join(', ')}\n\nWEBSITE TEXT:\n${text}\n\nReturn ONLY JSON:\n{"primaryService":"main service","secondaryServices":["other services"],"serviceArea":"area served","targetCustomer":"residential/commercial/both","uniqueValueProp":"differentiator or null","yearsInBusiness":"if mentioned or null","certifications":["any listed"],"emergencyService":true/false,"brands":["brands mentioned"],"missingFromWebsite":["important missing items"]}`;

    console.log('[BIZ-INTEL] Extracting...');
    const res = await axios.post('https://api.anthropic.com/v1/messages',
      { model: 'claude-haiku-4-5-20251001', max_tokens: 600, messages: [{ role: 'user', content: prompt }] },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 15000 });
    const t = res.data?.content?.[0]?.text || '';
    const m = t.match(/\{[\s\S]*\}/);
    if (m) { const p = JSON.parse(m[0]); console.log(`[BIZ-INTEL] OK: ${p.primaryService}`); return p; }
    return null;
  } catch (e) { console.error(`[BIZ-INTEL] Failed: ${e.message}`); return null; }
}

// ══════════════════════════════════════════════════
// COMPETITOR ENRICHMENT + ANALYSIS (Claude Haiku)
// ══════════════════════════════════════════════════
async function enrichCompetitorData(competitors) {
  if (!competitors || competitors.length === 0) return [];
  const key = process.env.GOOGLE_PLACES_API_KEY;
  const top3 = competitors.slice(0, 3);
  return Promise.all(top3.map(async (comp) => {
    let website = null, description = null, photoCount = 0, websiteText = '';
    if (comp.placeId && key) {
      try {
        const r = await ax.get('https://maps.googleapis.com/maps/api/place/details/json', { params: { place_id: comp.placeId, fields: 'website,editorial_summary,photos', key }, timeout: 5000 });
        const d = r.data?.result || {};
        website = d.website || null; description = d.editorial_summary?.overview || null; photoCount = d.photos?.length || 0;
      } catch {}
    }
    if (website) { try { const r = await ax.get(website, { timeout: 5000 }); websiteText = (r.data || '').replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 1500); } catch {} }
    return { name: comp.name, rating: comp.rating, reviewCount: comp.reviewCount, address: comp.address || '', categories: (comp.types || []).map(t => t.replace(/_/g, ' ')).join(', '), description, websiteText, hasWebsite: !!website, photoCount };
  }));
}

async function generateCompetitorAnalysis(businessName, city, state, platforms, compData, bizIntel, extra) {
  if (!process.env.ANTHROPIC_API_KEY) return { comparisonSummary: '', keyGaps: [], whereCompetitive: [], opportunitiesToWin: [] };

  // Use real competitors from web research if available, fall back to Google data
  const wr = extra?.webResearch;
  const researchedComps = wr?.realCompetitors || [];
  const googleComps = compData?.competitors || [];
  const hasDeepData = researchedComps.length > 0;

  if (googleComps.length === 0 && researchedComps.length === 0) return { comparisonSummary: 'No competitor data available.', keyGaps: [], whereCompetitive: [], opportunitiesToWin: [] };

  try {
    let compDetails;
    if (hasDeepData) {
      compDetails = researchedComps.map((c, i) => `${i + 1}. ${c.name} (${c.type || 'same industry'})
   Rating: ${c.rating || 'unknown'} stars, ${c.reviewCount || 'unknown'} reviews
   What they do BETTER: ${c.whatTheyDoBetter}
   Their weakness: ${c.whatTheyDoWorse}
   Why customers choose them: ${c.keyDifferentiator}`).join('\n\n');
    } else {
      const enriched = await enrichCompetitorData(googleComps);
      compDetails = enriched.map((c, i) => { let d = `${i + 1}. ${c.name} — ${c.rating || 'unrated'} stars, ${c.reviewCount} reviews, ${c.hasWebsite ? 'has website' : 'no website'}, ${c.photoCount} photos`; if (c.description) d += `\n   Description: ${c.description}`; if (c.websiteText) d += `\n   Website snippet: ${c.websiteText.substring(0, 300)}`; return d; }).join('\n\n');
    }

    const bizContext = bizIntel ? `\nSUBJECT SERVICES: ${bizIntel.primaryService}\nTARGET: ${bizIntel.targetCustomer}\nCERTIFICATIONS: ${bizIntel.certifications?.join(', ') || 'none'}` : '';
    const reviewContext = wr?.reviewPatterns ? `\nSUBJECT REVIEW PATTERNS:\n- Customers love: ${wr.reviewPatterns.topPraiseThemes?.join(', ')}\n- Customers complain about: ${wr.reviewPatterns.topComplaintThemes?.join(', ')}` : '';

    const prompt = `You are a competitive intelligence analyst writing a premium business audit section. You have deep research data on both the subject business and their competitors.

SUBJECT: ${businessName}, ${city} ${state || ''}
GOOGLE: ${platforms.google?.rating || 'N/A'} stars, ${platforms.google?.reviewCount || 0} reviews${bizContext}${reviewContext}

COMPETITORS (${hasDeepData ? 'from deep web research' : 'from Google data'}):
${compDetails}

For each competitor analyze:
- What services they emphasize that overlap with the subject business
- Whether they serve the same geographic area
- One specific thing they do better online (more reviews, better description, more photos, etc.)
- One specific vulnerability the subject business could exploit
- What customer reviews say about choosing between them

Do NOT just compare star ratings. Give intelligence a CEO would pay for.

Return ONLY JSON:
{"comparisonSummary":"2-3 paragraphs naming competitors directly with specific numbers and customer behavior insights","keyGaps":["specific gap naming the competitor and real customer impact"],"whereCompetitive":["specific strength vs a named competitor with data"],"opportunitiesToWin":["specific actionable move targeting a named competitor weakness"]}`;

    console.log(`[COMPETITORS] Generating analysis (Sonnet, ${hasDeepData ? 'deep data' : 'Google data'})...`);
    const res = await axios.post('https://api.anthropic.com/v1/messages',
      { model: 'claude-sonnet-4-5', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 60000 });
    const text = res.data?.content?.[0]?.text || '';
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { const p = JSON.parse(m[0]); console.log('[COMPETITORS] Analysis complete.'); return { comparisonSummary: p.comparisonSummary || '', keyGaps: p.keyGaps || [], whereCompetitive: p.whereCompetitive || [], opportunitiesToWin: p.opportunitiesToWin || [] }; }
    return { comparisonSummary: '', keyGaps: [], whereCompetitive: [], opportunitiesToWin: [] };
  } catch (e) { console.error(`[COMPETITORS] Failed: ${e.message}`); return { comparisonSummary: '', keyGaps: [], whereCompetitive: [], opportunitiesToWin: [] }; }
}

// ══════════════════════════════════════════════════
// AI INSIGHTS (Claude Haiku)
// ══════════════════════════════════════════════════
async function generateInsights(biz, city, state, platforms, score, extra) {
  if (!process.env.ANTHROPIC_API_KEY) return { executiveSummary: '', topPriorities: [], quickWins: [], whatYoureDoingWell: [], competitorIntel: '', monthlyGoal: '', revenueImpact: '', businessIntelligence: null, operationalInsights: [], marketOpportunities: [] };

  const p = platforms;
  const bizIntel = await extractBusinessIntelligence(p.website?.html, p.google, biz, city, state);
  const wr = extra.webResearch;
  const comp = extra.competitors;

  const companyContext = `
COMPANY OVERVIEW (from web research):
${wr?.companyOverview ? `- Founded: ${wr.companyOverview.founded || 'unknown'}
- Owners: ${wr.companyOverview.owners || 'unknown'}
- Locations: ${wr.companyOverview.locations?.join(', ') || 'unknown'}
- Service Area: ${wr.companyOverview.serviceArea || 'unknown'}
- Specialties: ${wr.companyOverview.specialties?.join(', ') || 'unknown'}
- Certifications: ${wr.companyOverview.certifications?.join(', ') || 'none found'}
- Awards: ${wr.companyOverview.awardsOrRecognition?.join(', ') || 'none found'}
- Unique Strengths: ${wr.companyOverview.uniqueStrengths?.join(', ') || 'none found'}` : 'Limited company data'}

WEBSITE INTELLIGENCE:
${bizIntel ? `- Primary Service: ${bizIntel.primaryService}
- Other Services: ${bizIntel.secondaryServices?.join(', ') || 'none'}
- Target Customer: ${bizIntel.targetCustomer}
- Value Prop: ${bizIntel.uniqueValueProp || 'not stated'}
- Emergency Service: ${bizIntel.emergencyService ? 'Yes' : 'No'}
- Missing from Website: ${bizIntel.missingFromWebsite?.join(', ') || 'none'}` : 'Website intelligence unavailable'}

REPUTATION ACROSS PLATFORMS:
- Google: ${p.google?.rating} stars, ${p.google?.reviewCount} reviews
- BBB: ${wr?.bbb?.found ? `Rating: ${wr.bbb.rating}, Accredited: ${wr.bbb.accredited}, Complaints: ${wr.bbb.complaintCount}${wr.bbb.complaintPatterns?.length ? ' (' + wr.bbb.complaintPatterns.join(', ') + ')' : ''}` : 'Not found'}
- Yelp: ${wr?.yelp?.found ? `${wr.yelp.rating} stars, ${wr.yelp.reviewCount} reviews` : 'Not found'}
- Facebook: ${wr?.facebook?.found ? `Page found, ${wr.facebook.followerCount || 'unknown'} followers, posting ${wr.facebook.postingFrequency}` : 'Not found'}

REVIEW PATTERNS (what customers actually say):
${wr?.reviewPatterns ? `- Sentiment: ${wr.reviewPatterns.overallSentiment}
- What customers LOVE: ${wr.reviewPatterns.topPraiseThemes?.join(' | ') || 'unknown'}
- What customers COMPLAIN about: ${wr.reviewPatterns.topComplaintThemes?.join(' | ') || 'unknown'}
- Operational Issues: ${wr.reviewPatterns.operationalInsights?.join(' | ') || 'none'}
- Staff Mentions: ${wr.reviewPatterns.staffMentions?.join(' | ') || 'none'}` : 'Review pattern data unavailable'}

COMPETITOR INTELLIGENCE:
${wr?.realCompetitors?.length > 0 ? wr.realCompetitors.map((c, i) => `${i + 1}. ${c.name} — ${c.rating} stars, ${c.reviewCount} reviews
   Better at: ${c.whatTheyDoBetter}
   Weakness: ${c.whatTheyDoWorse}
   Why chosen: ${c.keyDifferentiator}`).join('\n') : (comp?.competitors || []).map(c => `${c.name} (${c.rating} stars, ${c.reviewCount} reviews)`).join(', ') || 'None'}

MARKET INTELLIGENCE:
${wr?.marketIntelligence ? `- Industry complaints: ${wr.marketIntelligence.industryComplaints?.join(' | ') || 'unknown'}
- Winning factors: ${wr.marketIntelligence.winningFactors?.join(' | ') || 'unknown'}
- Opportunities: ${wr.marketIntelligence.opportunities?.join(' | ') || 'unknown'}` : 'Market data unavailable'}

RED FLAGS: ${wr?.redFlags?.join(' | ') || 'none'}
POSITIVES: ${wr?.positives?.join(' | ') || 'none'}

PLATFORM SCORES:
- Google: ${p.google?.rawScore || 0}/35
- Website: ${p.website?.rawScore || 0}/25 (Speed: ${p.website?.perfScore || 'N/A'}/100)
- NAP: ${p.nap?.rawScore || 0}/10
- Reviews: ${p.reviews?.rawScore || 0}/10
- Facebook: ${p.facebook?.excluded ? 'Not scanned' : `${p.facebook?.rawScore || 0}/10`}
- Yelp: ${p.yelp?.excluded ? 'Not scanned' : `${p.yelp?.rawScore || 0}/10`}
- OVERALL: ${score}/100

OWNER'S CHALLENGE: ${extra.biggestChallenge || 'not provided'}`;

  const prompt = `You are the Chief Marketing Officer writing a premium audit for a local business. You have done deep research. This report must be so specific the owner says "how did they know that?" and shares it with their team.

BUSINESS: ${biz}, ${city} ${state || ''}
${companyContext}

CRITICAL RULES:
1. NEVER give generic advice. Every recommendation must reference specific data you found about THIS business.
2. If review patterns exist, reference them specifically ("Your reviews mention scheduling issues 8 times").
3. Name specific competitors and what they do better.
4. Revenue impact must be realistic for this business size.
5. Top priorities ordered by actual business impact, not generic SEO advice.
6. If operational issues found in reviews, flag them as business improvements not just marketing.
7. Be honest about weaknesses — business owners need truth, not flattery.

Return ONLY a JSON object:
{
  "summary": "3-4 sentences PROVING you know this business. Reference actual rating, review themes, competitors by name, market position.",
  "revenueImpact": "Realistic monthly estimate for this business size and market.",
  "topPriorities": [{"priority":1,"title":"specific to THIS business","description":"why this matters based on real data found","timeToComplete":"realistic","estimatedROI":"appropriate for business size","difficulty":"easy|medium|hard","dataSource":"where this insight came from"}],
  "quickWins": ["specific free action referencing actual gaps found"],
  "whatYoureDoingWell": ["specific strength with real numbers from research"],
  "competitorIntel": "2-3 sentences naming competitors, what they do better, what to do about it. Real data.",
  "monthlyGoal": "One specific measurable 30-day goal appropriate for this business",
  "operationalInsights": ["patterns from reviews suggesting operational improvements — staffing, training, process issues"],
  "marketOpportunities": ["specific market gaps this business could fill based on research"]
}`;

  try {
    console.log('[INSIGHTS] Generating with full research context (Sonnet)...');
    const res = await axios.post('https://api.anthropic.com/v1/messages',
      { model: 'claude-sonnet-4-5', max_tokens: 3000, messages: [{ role: 'user', content: prompt }] },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 90000 });
    const text = res.data?.content?.[0]?.text || '';
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      console.log('[INSIGHTS] Complete.');
      return {
        executiveSummary: parsed.summary || parsed.executiveSummary || '', revenueImpact: parsed.revenueImpact || '',
        topPriorities: parsed.topPriorities || [], quickWins: parsed.quickWins || [],
        whatYoureDoingWell: parsed.whatYoureDoingWell || [], competitorIntel: parsed.competitorIntel || '',
        monthlyGoal: parsed.monthlyGoal || '', businessIntelligence: bizIntel || null,
        operationalInsights: parsed.operationalInsights || [], marketOpportunities: parsed.marketOpportunities || [],
      };
    }
    return { executiveSummary: text.slice(0, 300), topPriorities: [], quickWins: [], businessIntelligence: bizIntel || null, operationalInsights: [], marketOpportunities: [] };
  } catch (e) { console.error(`[INSIGHTS] Failed: ${e.message}`); return { executiveSummary: '', topPriorities: [], quickWins: [], businessIntelligence: null, operationalInsights: [], marketOpportunities: [] }; }
}

// ══════════════════════════════════════════════════
// SCORING ENGINE (100pts)
// ══════════════════════════════════════════════════
function calculateScore(platforms) {
  let earned = 0, possible = 0;
  for (const p of Object.values(platforms)) {
    if (p && !p.excluded && p.maxScore) { earned += (p.rawScore || 0); possible += p.maxScore; }
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
// TIER LANGUAGE ENGINE
// ══════════════════════════════════════════════════
function applyTierLanguage(finding, plan) {
  if (plan === 'basic') {
    if (finding.severity === 'good') return finding;
    if (finding.description) { const s = finding.description.split('. '); finding.description = s[0] + (s[0].endsWith('.') ? '' : '.'); }
    if (finding.impact) { finding.impact = finding.impact.replace(/will not contact you/gi, 'may not contact you').replace(/are choosing competitors/gi, 'may look at other options').replace(/never see your/gi, 'may not see your').replace(/every day/gi, 'over time'); }
    if (finding.fix) { const s = finding.fix.split('. '); finding.fix = s[0] + (s[0].endsWith('.') ? '' : '.'); }
    finding.whyThisMattersNow = ''; finding.competitorContrast = '';
    return finding;
  }
  if (plan === 'advanced') {
    if (finding.whyThisMattersNow) finding.whyThisMattersNow = finding.whyThisMattersNow.replace(/every day/gi, 'each week').replace(/right now/gi, 'currently');
    if (finding.competitorContrast) finding.competitorContrast = finding.competitorContrast.replace(/are getting the calls/gi, 'may be getting more calls').replace(/are capturing/gi, 'may be capturing');
    return finding;
  }
  return finding;
}

function applyTierToPriorityFix(pf, plan, biz) {
  if (!pf) return null;
  if (plan === 'basic') return { title: pf.title, reason: 'Addressing this would improve your online presence.', expectedImpact: `This could help ${biz} attract more customers.` };
  if (plan === 'advanced') return { title: pf.title, reason: pf.reason, expectedImpact: pf.expectedImpact };
  return { title: pf.title, reason: pf.reason, consequence: `If not addressed, competitors will continue capturing customers who should find ${biz}.`, expectedImpact: pf.expectedImpact };
}

function applyTierToCompetitors(compData, competitorAnalysis, competitorSummary, plan) {
  const comps = compData?.competitors || [];
  const max = plan === 'basic' ? 2 : 3;
  let comparison;
  if (plan === 'basic') comparison = competitorSummary ? { summary: competitorSummary } : null;
  else if (plan === 'advanced') comparison = competitorAnalysis ? { summary: competitorAnalysis.comparisonSummary || competitorSummary || '', keyGaps: competitorAnalysis.keyGaps || [], whereCompetitive: competitorAnalysis.whereCompetitive || [] } : (competitorSummary ? { summary: competitorSummary } : null);
  else comparison = competitorAnalysis ? { summary: competitorAnalysis.comparisonSummary || competitorSummary || '', keyGaps: competitorAnalysis.keyGaps || [], whereCompetitive: competitorAnalysis.whereCompetitive || [], opportunitiesToWin: competitorAnalysis.opportunitiesToWin || [] } : (competitorSummary ? { summary: competitorSummary } : null);
  return { competitors: comps.slice(0, max), comparison };
}

function applyTierToLossSummary(ls, plan) {
  if (plan === 'basic') return ls.replace(/losing \d+–\d+ potential customers/gi, 'missing some potential customers').replace(/losing \d+–\d+ customers/gi, 'missing some opportunities').replace(/costing you/gi, 'may be affecting');
  return ls;
}

function applyTierToHeadline(hl, plan) {
  if (plan === 'basic') return hl.replace(/Losing Leads to/gi, 'May Be Missing Opportunities From').replace(/Are Choosing Competitors Over/gi, 'Have Other Options Besides').replace(/Costing You Real Business/gi, 'Worth Looking Into');
  return hl;
}

// ══════════════════════════════════════════════════
// FULL AUDIT
// ══════════════════════════════════════════════════
async function runFullScan({ businessName, city, state, website, facebookUrl, yelpUrl, industry, biggestChallenge, plan, selectedCompetitors }) {
  plan = ['basic', 'advanced', 'competitive'].includes(plan) ? plan : 'basic';
  console.log(`[SCAN] ═══ FULL AUDIT: ${businessName}, ${city} ═══`);
  console.log(`[SCAN] Plan: ${plan} | Selected competitors: ${selectedCompetitors ? selectedCompetitors.length : 'auto'}`);
  const t0 = Date.now();

  // Step 1: Google (blocking)
  let google;
  try { google = await checkGoogle(businessName, city, state); }
  catch (e) { console.error('[SCAN] Google CRASH:', e.message); return { error: 'Google check failed.', businessName, city, state, scannedAt: new Date().toISOString() }; }

  // Authority location from Google
  const authorityCity = google.address?.split(',').slice(-3, -2)[0]?.trim() || city;
  const authorityState = google.address?.match(/\b([A-Z]{2})\s*\d{5}/)?.[1] || state;

  // Step 2: Website (get HTML + social links)
  const siteUrl = website || google.website || null;
  const websiteData = siteUrl ? await checkWebsite(siteUrl).catch(() => ({ excluded: true, rawScore: 0, maxScore: 25, findings: [], socialLinks: {} })) : { excluded: true, rawScore: 0, maxScore: 25, findings: [], socialLinks: {} };

  // Step 3: Extract social links from website
  const socialLinks = websiteData.socialLinks || {};
  const fbUrl = facebookUrl || socialLinks.facebook || null;
  const ylpUrl = yelpUrl || socialLinks.yelp || null;

  // Step 4: Parallel — web research + platform checks + competitors
  const [webResearchR, facebookR, yelpR, compR, napR, reviewsR] = await Promise.allSettled([
    researchBusinessOnWeb(businessName, authorityCity, authorityState, siteUrl, socialLinks, google),
    checkFacebookPage(fbUrl),
    checkYelpPage(ylpUrl),
    checkCompetitors(businessName, authorityCity, authorityState, google),
    checkNAP(google, websiteData),
    checkReviews(google),
  ]);

  const v = r => r.status === 'fulfilled' ? r.value : null;
  const webResearch = v(webResearchR);
  const facebookData = v(facebookR) || { excluded: true, rawScore: 0, maxScore: 10, findings: [] };
  const yelpData = v(yelpR) || { excluded: true, rawScore: 0, maxScore: 10, findings: [] };
  let compData = v(compR) || { competitors: [], ranking: null, dataPoints: 0 };
  const napData = v(napR) || { rawScore: 0, maxScore: 10, excluded: true, findings: [], dataPoints: 0 };
  const reviewData = v(reviewsR) || { rawScore: 0, maxScore: 10, excluded: true, findings: [], dataPoints: 0 };

  // Use selected competitors if user picked them
  if (selectedCompetitors && selectedCompetitors.length > 0) {
    console.log(`[SCAN] Using ${selectedCompetitors.length} user-selected competitors`);
    const selComps = selectedCompetitors.map(c => ({ name: c.name, rating: c.rating || null, reviewCount: c.reviewCount || 0, address: c.address || '', placeId: c.placeId || null, types: c.types || [], estimated: false }));
    compData = { ...compData, competitors: selComps, estimated: false, source: 'user_selected' };
    if (google.rating) {
      const all = [{ name: businessName, rating: google.rating, reviewCount: google.reviewCount || 0 }, ...selComps.filter(c => c.rating)];
      all.sort((a, b) => (b.rating * 10 + Math.log((b.reviewCount || 0) + 1)) - (a.rating * 10 + Math.log((a.reviewCount || 0) + 1)));
      compData.ranking = all.findIndex(b => b.name === businessName) + 1;
      compData.totalInArea = all.length;
    }
  }

  const platforms = { google, website: websiteData, nap: napData, reviews: reviewData, facebook: facebookData, yelp: yelpData };
  const overallScore = calculateScore(platforms);
  const scoreLabel = getScoreLabel(overallScore);

  // Step 5: AI insights (sequential — needs bizIntel for competitor analysis)
  const insights = await generateInsights(businessName, authorityCity, authorityState, platforms, overallScore, { industry, biggestChallenge, competitors: compData, webResearch });
  const competitorAnalysis = await generateCompetitorAnalysis(businessName, authorityCity, authorityState, platforms, compData, insights.businessIntelligence, { webResearch });

  // Assemble findings (only from non-excluded platforms)
  const sev = { critical: 0, warning: 1, good: 2 };
  const allFindings = [
    ...(google.excluded ? [] : (google.findings || [])),
    ...(websiteData.excluded ? [] : (websiteData.findings || [])),
    ...(napData.excluded ? [] : (napData.findings || [])),
    ...(reviewData.excluded ? [] : (reviewData.findings || [])),
    ...(facebookData.excluded ? [] : (facebookData.findings || [])),
    ...(yelpData.excluded ? [] : (yelpData.findings || [])),
    ...(compData.findings || []),
  ].sort((a, b) => (sev[a.severity] ?? 9) - (sev[b.severity] ?? 9));

  // BBB findings from web research
  if (webResearch?.bbb) {
    if (!webResearch.bbb.found) allFindings.push(F('Reputation', 'warning', 'Not listed on BBB', 'Your business was not found on the Better Business Bureau.', 'Many customers check BBB before hiring.', 'Create a free BBB listing at bbb.org.', 'Losing 10-15% of customers who check BBB'));
    else if (webResearch.bbb.complaintCount > 3) allFindings.push(F('Reputation', 'warning', `${webResearch.bbb.complaintCount} complaints on BBB`, `Your BBB profile shows ${webResearch.bbb.complaintCount} complaints.`, 'Customers will see these complaints.', 'Respond to each complaint professionally on BBB.'));
  }
  if (webResearch?.redFlags?.length > 0) {
    for (const flag of webResearch.redFlags.slice(0, 2)) allFindings.push(F('Reputation', 'warning', 'Online concern found', flag, 'This may affect customer trust.', 'Address this issue publicly if possible.'));
  }

  // Estimated loss per finding
  const lossMap = { 'Google:critical': 'Customers are choosing competitors instead', 'Google:warning': 'Missing customer inquiries each week', 'Website:critical': 'Visitors leaving without contacting you', 'Website:warning': 'Fewer clicks from search results', 'Facebook:critical': 'Invisible to local Facebook users', 'Facebook:warning': 'Competitors with active pages get seen first', 'NAP:warning': 'Inconsistent info costs ranking positions', 'Reviews:warning': 'Customers choosing better-reviewed competitors', 'Yelp:critical': 'Yelp customers choosing reviewed competitors', 'Yelp:warning': 'Weaker Yelp presence than competitors', 'Competitors:warning': 'Competitors getting your calls', 'Reputation:warning': 'Losing trust with researching customers' };
  for (const f of allFindings) { if (f.severity === 'good') { f.estimatedLoss = ''; continue; } f.estimatedLoss = lossMap[`${f.platform}:${f.severity}`] || (f.severity === 'critical' ? 'Costing you real customers' : 'Quietly reducing your leads'); }

  const totalDataPoints = Object.values(platforms).reduce((s, p) => s + (p?.dataPoints || 0), 0);
  const platformsChecked = Object.values(platforms).filter(p => !p?.excluded).length;
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[SCAN] ═══ DONE in ${elapsed}s. Score: ${overallScore}/100. Findings: ${allFindings.length}. Data points: ${totalDataPoints} ═══`);

  // Sales power fields
  const criticalCount = allFindings.filter(f => f.severity === 'critical').length;
  const warningCount = allFindings.filter(f => f.severity === 'warning').length;
  const topCompName = (compData?.competitors || [])[0]?.name || null;
  const compPhrase = topCompName ? `businesses like ${topCompName}` : `competitors in ${authorityCity || 'your area'}`;

  let lossSummary;
  if (criticalCount >= 3) lossSummary = `Right now, ${businessName} has ${criticalCount} critical gaps. Customers in ${authorityCity || 'your area'} are finding ${compPhrase} instead of you.`;
  else if (criticalCount >= 1) lossSummary = `${businessName} has gaps sending customers to ${compPhrase}. With ${criticalCount} critical issue${criticalCount > 1 ? 's' : ''} and ${warningCount} area${warningCount !== 1 ? 's' : ''} needing attention, you are likely missing customers.`;
  else if (warningCount >= 3) lossSummary = `${businessName}'s online presence needs attention. Together these issues add up — ${compPhrase} with better profiles are capturing customers who should be calling you.`;
  else lossSummary = `${businessName} is in a solid position. A few improvements could bring in additional customers and widen your lead.`;

  let reportHeadline;
  if (overallScore < 45) reportHeadline = `Customers in ${authorityCity || 'Your Area'} Are Choosing Competitors Over ${businessName}`;
  else if (overallScore < 60) reportHeadline = `${businessName} Is Losing Leads to ${compPhrase}`;
  else if (overallScore < 75) reportHeadline = `${businessName} Is Close — Fix These Issues Before Competitors Pull Ahead`;
  else reportHeadline = `${businessName} Has the Edge — Here's How to Dominate ${authorityCity || 'Your Market'}`;

  const salesQuickWins = allFindings.filter(f => f.severity === 'critical' && f.fix).slice(0, 3).map(f => ({ title: f.title, action: f.fix, impact: f.estimatedLoss || f.impact }));
  if (salesQuickWins.length < 3) { for (const f of allFindings.filter(f => f.severity === 'warning' && f.fix).slice(0, 3 - salesQuickWins.length)) salesQuickWins.push({ title: f.title, action: f.fix, impact: f.estimatedLoss || f.impact }); }

  const topFinding = allFindings.find(f => f.severity === 'critical' && f.fix) || allFindings.find(f => f.severity === 'warning' && f.fix);
  const priorityFix = topFinding ? { title: topFinding.title, reason: topFinding.estimatedLoss || topFinding.impact, expectedImpact: `Fixing this could directly increase customers contacting ${businessName}.` } : null;

  const comps = compData?.competitors || [];
  let competitorSummary = '';
  if (comps.length > 0) {
    const topComp = comps[0];
    const avgRating = (comps.reduce((s, c) => s + (c.rating || 0), 0) / comps.length).toFixed(1);
    competitorSummary = `Top competitors average ${avgRating} stars. ${topComp.name} leads with ${topComp.reviewCount} reviews at ${topComp.rating} stars.`;
    if ((google.reviewCount || 0) < (comps.reduce((s, c) => s + c.reviewCount, 0) / comps.length)) competitorSummary += ` You are behind the local average.`;
  }

  // Apply tier language
  for (const f of allFindings) applyTierLanguage(f, plan);
  const tieredHeadline = applyTierToHeadline(reportHeadline, plan);
  const tieredLoss = applyTierToLossSummary(lossSummary, plan);
  const tieredPriorityFix = applyTierToPriorityFix(priorityFix, plan, businessName);
  const tieredCompetitors = applyTierToCompetitors(compData, competitorAnalysis, competitorSummary, plan);

  return {
    businessName, city: authorityCity, state: authorityState, scannedAt: new Date().toISOString(), plan, overallScore, scoreLabel, platforms,
    competitors: { competitors: tieredCompetitors.competitors, ranking: compData?.ranking || null, totalInArea: compData?.totalInArea || null, estimated: compData?.estimated || false, source: compData?.source || null },
    competitorComparison: tieredCompetitors.comparison,
    allFindings,
    summary: insights.executiveSummary || '', revenueImpact: insights.revenueImpact || '',
    topPriorities: insights.topPriorities || [], whatYoureDoingWell: insights.whatYoureDoingWell || [],
    competitorIntel: insights.competitorIntel || '', monthlyGoal: insights.monthlyGoal || '',
    businessIntelligence: insights.businessIntelligence || null,
    operationalInsights: insights.operationalInsights || [],
    marketOpportunities: insights.marketOpportunities || [],
    reportHeadline: tieredHeadline, lossSummary: tieredLoss,
    quickWins: salesQuickWins, priorityFix: tieredPriorityFix,
    competitorSummary: plan === 'basic' ? '' : competitorSummary,
    webResearch: webResearch || null, bbbData: webResearch?.bbb || null,
    socialLinks: socialLinks || {},
    confidence: platformsChecked >= 4 ? 'high' : platformsChecked >= 3 ? 'medium' : 'low',
    dataQuality: { platformsFound: platformsChecked, platformsChecked: 6, scanTime: elapsed, dataPoints: totalDataPoints, note: platformsChecked >= 4 ? 'Comprehensive' : platformsChecked >= 3 ? 'Good' : 'Limited' },
  };
}

// ══════════════════════════════════════════════════
// LIGHT SCAN (for reps — fast, Google-only, under 5s)
// ══════════════════════════════════════════════════

function buildLightFindings(g) {
  const items = [];
  if (g.rating === 0) items.push({ icon: 'critical', text: 'No Google rating — customers skip businesses without stars' });
  else if (g.rating < 4.0) items.push({ icon: 'critical', text: `Your ${g.rating}-star rating is below the 4.0 threshold — up to 40% of customers filter you out` });
  else if (g.rating < 4.5) items.push({ icon: 'warning', text: `${g.rating} stars — good, but top competitors in your area sit above 4.5` });
  if (g.reviewCount === 0) items.push({ icon: 'critical', text: 'No Google reviews — this is the #1 thing holding you back' });
  else if (g.reviewCount < 20) items.push({ icon: 'critical', text: `Only ${g.reviewCount} reviews — most customers trust businesses with 50+` });
  else if (g.reviewCount < 50) items.push({ icon: 'warning', text: `You have ${g.reviewCount} reviews — competitors likely have more` });
  if (!g.hasHours) items.push({ icon: 'warning', text: 'No business hours listed — customers assume you\'re closed' });
  if (!g.hasWebsite) items.push({ icon: 'critical', text: 'No website on your Google profile — customers can\'t learn about you' });
  if (!g.hasPhone) items.push({ icon: 'warning', text: 'No phone number on your profile — hard for customers to reach you' });
  if (g.photoCount < 5) items.push({ icon: 'warning', text: `Only ${g.photoCount} photos — businesses with 10+ get 42% more calls` });
  if (!g.hasDescription) items.push({ icon: 'warning', text: 'No business description — you\'re missing a chance to tell customers what you do' });
  if (g.daysSinceReview > 180) items.push({ icon: 'warning', text: 'No reviews in the last 6 months — your profile looks inactive' });
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
      type: 'light', teaser: true,
      headline: `${g.name || businessName} — Online Presence Scan`,
      scoreDisplay: `${score}/100`, score, scoreLabel: getScoreLabel(score),
      businessName: g.name || businessName, city, state, scannedAt: new Date().toISOString(),
      rating: g.rating || null, reviewCount: g.reviewCount || 0, address: g.address || null,
      findings: topFindings, moreIssuesCount: Math.max(findings.length - 3, 0),
      explanation,
      cta: { text: 'Unlock Full Scan', subtext: 'Website, Facebook, Yelp, competitors, and a custom action plan' },
    };
  } catch (e) { console.error('[SCAN] Light CRASH:', e.message); return { error: 'Scan failed. Please try again.', businessName, city, state }; }
}

module.exports = { runFullScan, runLightScan };
