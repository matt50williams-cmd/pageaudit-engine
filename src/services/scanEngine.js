const axios = require('axios');
const cheerio = require('cheerio');

const ax = axios.create({ timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36' } });
function cleanUrl(u) { if (!u) return null; let url = u.trim(); if (!url.startsWith('http')) url = 'https://' + url; try { const p = new URL(url); p.search = ''; return p.toString().replace(/\/$/, ''); } catch { return url; } }

// ══════════════════════════════════════════════════
// CHECK 1: GOOGLE BUSINESS PROFILE (35pts max)
// ══════════════════════════════════════════════════
async function checkGoogle(businessName, city, state) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return { found: false, rawScore: 0, maxScore: 35, findings: [] };

  console.log(`[SCAN] Google: "${businessName} ${city} ${state}"`);
  const findRes = await ax.get('https://maps.googleapis.com/maps/api/place/findplacefromtext/json', { params: { input: `${businessName} ${city} ${state}`, inputtype: 'textquery', fields: 'place_id,name,formatted_address,business_status', key } });
  const candidate = findRes.data?.candidates?.[0];
  if (!candidate?.place_id) return { found: false, rawScore: 0, maxScore: 35, findings: [{ platform: 'Google', severity: 'critical', title: 'Not found on Google', description: `No listing found for "${businessName}" in ${city}.`, impact: 'The #1 way customers find local businesses.', fix: 'Create your Google Business Profile at business.google.com.' }] };

  const d = (await ax.get('https://maps.googleapis.com/maps/api/place/details/json', { params: { place_id: candidate.place_id, fields: 'name,rating,user_ratings_total,formatted_address,formatted_phone_number,opening_hours,website,photos,business_status,reviews,types,editorial_summary', key } })).data?.result || {};

  const rating = d.rating || 0, reviewCount = d.user_ratings_total || 0;
  const hasHours = !!d.opening_hours, photoCount = d.photos?.length || 0;
  const hasWebsite = !!d.website, hasPhone = !!d.formatted_phone_number;
  const hasDescription = !!d.editorial_summary?.overview;
  const businessStatus = d.business_status || 'UNKNOWN', types = d.types || [];
  const reviews = d.reviews || [];
  const daysSinceReview = reviews[0]?.time ? Math.round((Date.now() / 1000 - reviews[0].time) / 86400) : 999;

  let raw = 0;
  if (rating >= 4.8) raw += 14; else if (rating >= 4.5) raw += 12; else if (rating >= 4.0) raw += 9; else if (rating >= 3.5) raw += 5; else if (rating > 0) raw += 2;
  if (reviewCount >= 500) raw += 11; else if (reviewCount >= 200) raw += 9; else if (reviewCount >= 100) raw += 7; else if (reviewCount >= 50) raw += 5; else if (reviewCount >= 20) raw += 3; else if (reviewCount > 0) raw += 1;
  if (hasHours) raw += 1; if (hasWebsite) raw += 1; if (hasPhone) raw += 1; if (photoCount >= 10) raw += 1; if (hasDescription) raw += 1;
  if (daysSinceReview <= 30) raw += 3; else if (daysSinceReview <= 90) raw += 2; else if (daysSinceReview <= 180) raw += 1;
  if (reviewCount >= 1000 && rating >= 4.5) raw += 2; else if (reviewCount >= 500 && rating >= 4.5) raw += 1;
  raw = Math.min(raw, 35);

  const findings = [];
  if (rating === 0) findings.push({ platform: 'Google', severity: 'critical', title: 'No Google rating', description: 'No star rating visible to customers.', impact: 'Google shows rated competitors first.', fix: 'Ask 10 customers for reviews this week.' });
  else if (rating < 4.0) findings.push({ platform: 'Google', severity: 'critical', title: `${rating}-star rating below trust threshold`, description: `${rating} stars falls below the 4.0 mark.`, impact: '40% of customers skip below 4.0.', fix: 'Respond to negatives. Ask happy customers for reviews.' });
  else if (rating < 4.5) findings.push({ platform: 'Google', severity: 'warning', title: `${rating} stars — close but not top-tier`, description: `Below the 4.5+ top competitors maintain.`, impact: 'Customers pick higher stars.', fix: 'Ask every satisfied customer for a review.' });
  else findings.push({ platform: 'Google', severity: 'good', title: `Strong ${rating}-star rating`, description: 'Strong trust signal.', impact: '', fix: '' });

  if (reviewCount < 20) findings.push({ platform: 'Google', severity: 'critical', title: `Only ${reviewCount} reviews`, description: `Just ${reviewCount} reviews.`, impact: 'Looks unestablished.', fix: 'Launch a review campaign. Target 50+.' });
  else if (reviewCount < 50) findings.push({ platform: 'Google', severity: 'warning', title: `${reviewCount} reviews — competitors likely have more`, description: '', impact: 'Competitors with 100+ appear more trustworthy.', fix: 'Follow-up text after every job.' });
  else findings.push({ platform: 'Google', severity: 'good', title: `${reviewCount} reviews — solid`, description: '', impact: '', fix: '' });

  if (!hasHours) findings.push({ platform: 'Google', severity: 'warning', title: 'No business hours', description: 'Hours missing.', impact: 'Customers assume closed.', fix: 'Add hours in Google Business Profile.' });
  if (photoCount < 5) findings.push({ platform: 'Google', severity: 'warning', title: `Only ${photoCount} photos`, description: '', impact: '10+ photos get 42% more clicks.', fix: 'Upload storefront, team, work photos.' });
  if (!hasWebsite) findings.push({ platform: 'Google', severity: 'critical', title: 'No website on Google', description: '', impact: 'Customers can\'t learn more.', fix: 'Add website URL.' });
  if (!hasDescription) findings.push({ platform: 'Google', severity: 'warning', title: 'No business description', description: '', impact: 'Missed opportunity.', fix: 'Write 2-3 sentence description.' });
  if (daysSinceReview > 180) findings.push({ platform: 'Google', severity: 'warning', title: 'No recent reviews', description: `Last review ${Math.round(daysSinceReview / 30)}+ months ago.`, impact: 'Looks inactive.', fix: 'Ask a customer for a review today.' });

  return { found: true, placeId: candidate.place_id, name: d.name || businessName, rating, reviewCount, address: d.formatted_address || '', phone: d.formatted_phone_number || '', website: d.website || '', hasHours, photoCount, hasWebsite, hasPhone, hasDescription, businessStatus, types, daysSinceReview, reviews: reviews.slice(0, 5).map(r => ({ text: r.text?.slice(0, 200), rating: r.rating, time: r.time })), rawScore: raw, maxScore: 35, findings };
}

// ══════════════════════════════════════════════════
// CHECK 2: WEBSITE + SOCIAL LINKS (25pts max)
// ══════════════════════════════════════════════════
async function checkWebsite(websiteUrl) {
  if (!websiteUrl) return { found: false, rawScore: 0, maxScore: 25, findings: [], socialLinks: {} };
  const url = cleanUrl(websiteUrl);
  console.log(`[SCAN] Website: ${url}`);
  let raw = 0;
  const findings = [];
  const socialLinks = {};

  let hasSSL = false, hasPhone = false, hasAddress = false, hasCTA = false, html = '';
  try {
    const r = await ax.get(url, { timeout: 8000, maxRedirects: 5 });
    hasSSL = (r.request?.res?.responseUrl || r.config?.url || '').startsWith('https://');
    html = r.data || '';
    if (hasSSL) { raw += 5; } else { findings.push({ platform: 'Website', severity: 'critical', title: 'No SSL — "Not Secure" warning', description: 'Visitors see a security warning.', impact: 'Most leave immediately.', fix: 'Enable SSL through your hosting provider.' }); }
  } catch { return { found: false, rawScore: 0, maxScore: 25, findings: [{ platform: 'Website', severity: 'warning', title: 'Website unreachable', description: 'Could not load.', impact: 'Customers see an error page.', fix: 'Check your site is online.' }], socialLinks: {} }; }

  if (html) {
    const $ = cheerio.load(html);
    // Social link extraction
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (href.includes('facebook.com') && !href.includes('/sharer') && !socialLinks.facebook) socialLinks.facebook = href;
      if (href.includes('yelp.com/biz') && !socialLinks.yelp) socialLinks.yelp = href;
      if (href.includes('bbb.org') && !socialLinks.bbb) socialLinks.bbb = href;
      if (href.includes('instagram.com') && !socialLinks.instagram) socialLinks.instagram = href;
      if (href.includes('google.com/maps') || href.includes('g.page')) socialLinks.googleMaps = href;
      if (href.includes('twitter.com') || href.includes('x.com')) socialLinks.twitter = href;
      if (href.includes('linkedin.com')) socialLinks.linkedin = href;
      if (href.includes('youtube.com')) socialLinks.youtube = href;
      if (href.includes('nextdoor.com')) socialLinks.nextdoor = href;
      if (href.includes('angi.com') || href.includes('angieslist.com')) socialLinks.angi = href;
      if (href.includes('homeadvisor.com')) socialLinks.homeadvisor = href;
      if (href.includes('thumbtack.com')) socialLinks.thumbtack = href;
    });
    console.log(`[SCAN] Social links: ${Object.keys(socialLinks).join(', ') || 'none'}`);

    // Basic meta checks
    const title = $('title').text().trim();
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    const h1 = $('h1').first().text().trim();
    hasPhone = /(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})|tel:/i.test(html);
    hasAddress = /\b\d{2,5}\s+[A-Z][a-z]+\s+(St|Ave|Blvd|Dr|Rd|Ln|Way|Ct)/i.test(html);
    hasCTA = /book\s*(now|online|appointment)|call\s*(us|now|today)|contact\s*us|schedule|get\s*quote/i.test(html);

    if (title) raw += 2; else findings.push({ platform: 'Website', severity: 'warning', title: 'Missing page title', description: 'No title tag.', impact: 'Google guesses what to show.', fix: 'Add a title with business name and service.' });
    if (metaDesc) raw += 2; else findings.push({ platform: 'Website', severity: 'warning', title: 'No Google preview description', description: 'No meta description.', impact: 'Google auto-generates poorly.', fix: 'Add meta description under 160 chars.' });
    if (h1) raw += 1;
    if (hasPhone) raw += 3; else findings.push({ platform: 'Website', severity: 'critical', title: 'No phone number visible', description: 'No phone found on site.', impact: 'Customers can\'t call you.', fix: 'Add phone to header of every page.' });
    if (hasCTA) raw += 2; else findings.push({ platform: 'Website', severity: 'warning', title: 'No call-to-action', description: 'No book/call button.', impact: 'Visitors don\'t know what to do.', fix: 'Add a "Call Now" or "Book Online" button.' });
    if (hasAddress) raw += 1;

    // PageSpeed
    try {
      const params = { url, strategy: 'mobile', category: 'performance' };
      if (process.env.GOOGLE_PLACES_API_KEY) params.key = process.env.GOOGLE_PLACES_API_KEY;
      const ps = await ax.get('https://www.googleapis.com/pagespeedonline/v5/runPagespeed', { params, timeout: 30000 });
      const perfScore = Math.round((ps.data?.lighthouseResult?.categories?.performance?.score || 0) * 100);
      if (perfScore >= 90) raw += 10;
      else if (perfScore >= 70) raw += 7;
      else if (perfScore >= 50) { raw += 4; findings.push({ platform: 'Website', severity: 'warning', title: `Speed ${perfScore}/100 — slow`, description: 'Below 70 threshold.', impact: '53% of users leave slow sites.', fix: 'Optimize images. Test at gtmetrix.com' }); }
      else if (perfScore > 0) { raw += 1; findings.push({ platform: 'Website', severity: 'critical', title: `Speed ${perfScore}/100 — very slow`, description: 'Losing mobile visitors.', impact: 'Google penalizes slow sites.', fix: 'Major speed overhaul needed.' }); }
    } catch {}
  }

  return { found: true, url, hasSSL, hasPhone, hasAddress, hasCTA, rawScore: Math.min(raw, 25), maxScore: 25, findings, socialLinks, html };
}

// ══════════════════════════════════════════════════
// COMPETITORS (Google Text Search fallback)
// ══════════════════════════════════════════════════
async function checkCompetitors(businessName, city, state, googleData) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return { competitors: [], ranking: null };

  try {
    const HVAC = ['hvac_contractor', 'heating_contractor', 'air_conditioning_contractor'];
    const SKIP = ['establishment', 'point_of_interest', 'local_business', 'store', 'premise', 'electrician', 'general_contractor'];
    const compTypes = googleData?.types || [];
    let pt = compTypes.find(t => HVAC.includes(t));
    if (!pt) { const nl = businessName.toLowerCase(); if (nl.includes('heating') || nl.includes('cooling') || nl.includes('hvac')) pt = 'hvac_contractor'; else if (nl.includes('plumb')) pt = 'plumber'; else if (nl.includes('roof')) pt = 'roofing_contractor'; }
    if (!pt) pt = compTypes.find(t => !SKIP.includes(t));
    const MAP = { 'hvac_contractor': 'heating cooling HVAC', 'plumber': 'plumber plumbing', 'roofing_contractor': 'roofing contractor', 'electrician': 'electrician', 'dentist': 'dentist', 'lawyer': 'lawyer attorney', 'restaurant': 'restaurant' };
    const kw = MAP[pt] || (pt ? pt.replace(/_/g, ' ') : 'contractor');

    let results = [];
    for (const q of [`${kw} ${city} ${state}`, `${kw} near ${city}`]) {
      try { const r = await ax.get('https://maps.googleapis.com/maps/api/place/textsearch/json', { params: { query: q, key }, timeout: 8000 }); const f = (r.data?.results || []).filter(p => p.place_id !== googleData?.placeId); if (f.length > results.length) results = f; if (results.length >= 8) break; } catch {}
    }

    return { competitors: results.slice(0, 5).map(p => ({ name: p.name, rating: p.rating || null, reviewCount: p.user_ratings_total || 0, address: p.formatted_address || '' })), ranking: null, source: 'google_text_search' };
  } catch { return { competitors: [], ranking: null }; }
}

// ══════════════════════════════════════════════════
// WEB RESEARCH (Claude Sonnet with web_search)
// ══════════════════════════════════════════════════
async function researchBusinessOnWeb(businessName, city, state, website, socialLinks, googleData) {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const HVAC = ['hvac_contractor', 'heating_contractor', 'air_conditioning_contractor'];
  const SKIP = ['establishment', 'point_of_interest', 'local_business', 'electrician', 'general_contractor', 'store'];
  const types = googleData?.types || [];
  let pt = types.find(t => HVAC.includes(t));
  if (!pt) { const nl = businessName.toLowerCase(); if (nl.includes('heating') || nl.includes('cooling') || nl.includes('hvac')) pt = 'hvac_contractor'; else if (nl.includes('plumb')) pt = 'plumber'; else if (nl.includes('roof')) pt = 'roofing_contractor'; }
  if (!pt) pt = types.find(t => !SKIP.includes(t));
  const businessType = pt ? pt.replace(/_/g, ' ') : 'local business';

  try {
    console.log(`[WEB RESEARCH] Model: claude-sonnet-4-5 | Key: ${process.env.ANTHROPIC_API_KEY ? 'SET' : 'MISSING'} | Type: ${businessType}`);
    const res = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: `You are a senior business intelligence analyst. Research "${businessName}" in ${city}, ${state} thoroughly. This is a ${businessType} business${website ? ` with website ${website}` : ''}.

Search for ALL of the following:
1. "${businessName} ${city} reviews"
2. "${businessName} BBB"
3. "${businessName} Yelp"
4. "${businessName} complaints"
5. "${businessName} Facebook"
6. "${businessType} ${city} ${state} best"
7. Top competitor + "reviews"
8. "${businessName}" alone for news/awards
9. "${businessType} ${city} customer complaints"
10. "${businessName} owner" or "${businessName} about"

Return ONLY JSON:
{"companyOverview":{"founded":"year or null","owners":"names or null","locations":["locations"],"serviceArea":"area","specialties":["services"],"certifications":["certs"],"awardsOrRecognition":["awards"],"uniqueStrengths":["strengths"]},"bbb":{"found":true,"rating":"A+","accredited":true,"complaintCount":0,"complaintPatterns":["patterns"],"url":null},"yelp":{"found":true,"rating":0.0,"reviewCount":0,"topPraise":["praise"],"topComplaints":["complaints"],"url":null},"facebook":{"found":true,"url":null,"followerCount":"count","postingFrequency":"frequency","lastPostApprox":"timeframe"},"reviewPatterns":{"overallSentiment":"positive/mixed/negative","topPraiseThemes":["themes"],"topComplaintThemes":["themes"],"operationalInsights":["insights"],"staffMentions":["mentions"],"competitiveInsights":["insights"]},"realCompetitors":[{"name":"name","type":"type","rating":0.0,"reviewCount":0,"whatTheyDoBetter":"advantage","whatTheyDoWorse":"weakness","keyDifferentiator":"why chosen"}],"marketIntelligence":{"industryComplaints":["complaints"],"winningFactors":["factors"],"opportunities":["opportunities"]},"onlinePresenceGaps":["gaps"],"redFlags":["flags"],"positives":["positives"],"confidenceLevel":"high/medium/low"}` }]
    }, { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 120000 });

    const tb = res.data?.content?.find(b => b.type === 'text');
    if (!tb) { console.log('[WEB RESEARCH] No text block'); return null; }
    const m = tb.text.match(/\{[\s\S]*\}/);
    if (m) { const p = JSON.parse(m[0]); console.log(`[WEB RESEARCH] Done. BBB=${p.bbb?.found} Yelp=${p.yelp?.found} Comps=${p.realCompetitors?.length} Confidence=${p.confidenceLevel}`); return p; }
    return null;
  } catch (e) {
    console.error(`[WEB RESEARCH] FAILED: ${e.message}`);
    console.error(`[WEB RESEARCH] Status: ${e.response?.status} Body: ${JSON.stringify(e.response?.data)?.slice(0, 300)}`);
    return null;
  }
}

// ══════════════════════════════════════════════════
// REPORT GENERATION (single Claude Sonnet call)
// ══════════════════════════════════════════════════
function buildResearchSection(wr) {
  const parts = [];
  if (wr.companyOverview?.founded) parts.push(`COMPANY: Founded ${wr.companyOverview.founded}. Owners: ${wr.companyOverview.owners || 'unknown'}. ${wr.companyOverview.serviceArea || ''}`);
  if (wr.bbb?.found) parts.push(`BBB: Rating ${wr.bbb.rating}. Accredited: ${wr.bbb.accredited}. Complaints: ${wr.bbb.complaintCount}. Patterns: ${wr.bbb.complaintPatterns?.join(', ') || 'none'}`);
  if (wr.yelp?.found) parts.push(`YELP: ${wr.yelp.rating} stars, ${wr.yelp.reviewCount} reviews. Praised for: ${wr.yelp.topPraise?.join(', ')}. Complaints: ${wr.yelp.topComplaints?.join(', ')}`);
  if (wr.facebook?.found) parts.push(`FACEBOOK: Followers: ${wr.facebook.followerCount}. Posting: ${wr.facebook.postingFrequency}`);
  if (wr.reviewPatterns?.topPraiseThemes?.length) parts.push(`REVIEW PRAISE: ${wr.reviewPatterns.topPraiseThemes.join(' | ')}`);
  if (wr.reviewPatterns?.topComplaintThemes?.length) parts.push(`REVIEW COMPLAINTS: ${wr.reviewPatterns.topComplaintThemes.join(' | ')}`);
  if (wr.reviewPatterns?.operationalInsights?.length) parts.push(`OPERATIONAL ISSUES: ${wr.reviewPatterns.operationalInsights.join(' | ')}`);
  if (wr.marketIntelligence?.opportunities?.length) parts.push(`MARKET OPPORTUNITIES: ${wr.marketIntelligence.opportunities.join(' | ')}`);
  if (wr.redFlags?.length) parts.push(`RED FLAGS: ${wr.redFlags.join(' | ')}`);
  if (wr.positives?.length) parts.push(`POSITIVES: ${wr.positives.join(' | ')}`);
  return parts.length > 0 ? `\nWEB RESEARCH:\n${parts.join('\n')}` : 'Limited web research data';
}

async function generateReport(businessName, city, state, google, website, webResearch, competitors, plan) {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const googleSection = google?.found ? `\nGOOGLE: ${google.rating} stars (${google.reviewCount} reviews). Address: ${google.address}. Phone: ${google.phone || 'N/A'}. Hours: ${google.hasHours ? 'Yes' : 'No'}. Photos: ${google.photoCount}. Website linked: ${google.hasWebsite ? 'Yes' : 'No'}. Description: ${google.hasDescription ? 'Yes' : 'No'}. Days since last review: ${google.daysSinceReview}.\nRecent reviews: ${google.reviews?.slice(0, 3).map(r => `"${r.text?.slice(0, 100)}" (${r.rating}★)`).join(' | ') || 'none'}` : 'Google profile not found';

  const websiteSection = website?.found ? `\nWEBSITE (${website.url}): SSL: ${website.hasSSL ? 'Yes' : 'No'}. Phone visible: ${website.hasPhone ? 'Yes' : 'No'}. Address visible: ${website.hasAddress ? 'Yes' : 'No'}. CTA button: ${website.hasCTA ? 'Yes' : 'No'}. Social links: ${Object.keys(website.socialLinks || {}).join(', ') || 'none'}` : 'No website data';

  const researchSection = webResearch ? buildResearchSection(webResearch) : 'Web research unavailable';

  const compSection = competitors?.length > 0 ? `\nCOMPETITORS:\n${competitors.slice(0, 3).map((c, i) => `${i + 1}. ${c.name} — ${c.rating || '?'} stars, ${c.reviewCount || 0} reviews${c.whatTheyDoBetter ? '. Better at: ' + c.whatTheyDoBetter : ''}`).join('\n')}` : 'No competitor data';

  const prompt = `You are writing a premium local business audit report. Be a trusted advisor — honest, specific, actionable.

RULES:
1. ONLY mention things you have data for. If BBB data is missing, don't mention BBB.
2. Every finding must reference actual data — real numbers, real names.
3. Name competitors directly when you have data.
4. Do NOT pad with generic advice.
5. Be honest about weaknesses.

BUSINESS: ${businessName}, ${city} ${state}
PLAN: ${plan}
${googleSection}
${websiteSection}
${researchSection}
${compSection}

Return ONLY JSON:
{"summary":"3-4 sentences proving you know THIS business. Real rating, review patterns, competitor names. No generic statements.","scoreBreakdown":{"google":{"score":0,"reason":"specific"},"website":{"score":0,"reason":"specific"},"reputation":{"score":0,"reason":"based on what was found"},"competitive":{"score":0,"reason":"based on competitor data"}},"findings":[{"platform":"Google|Website|Reputation|Competitors","severity":"critical|warning|good","title":"specific with real data","description":"what was found","impact":"real impact","fix":"specific fix","estimatedLoss":"realistic estimate"}],"topPriorities":[{"priority":1,"title":"specific","description":"why for THIS business","timeToComplete":"estimate","estimatedROI":"realistic","difficulty":"easy|medium|hard"}],"whatYoureDoingWell":["specific strength with numbers"],"competitorIntel":"specific intel naming competitors with data, or empty if no data","operationalInsights":["review patterns suggesting operational improvements — only if found"],"marketOpportunities":["specific opportunities found — only if found"],"monthlyGoal":"one specific 30-day goal","revenueImpact":"realistic monthly estimate"}`;

  try {
    console.log('[REPORT] Generating with Sonnet...');
    const res = await axios.post('https://api.anthropic.com/v1/messages',
      { model: 'claude-sonnet-4-5', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 90000 });
    const text = res.data?.content?.[0]?.text || '';
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { const p = JSON.parse(m[0]); console.log('[REPORT] Complete.'); return p; }
    return null;
  } catch (e) { console.error(`[REPORT] Failed: ${e.message}`); return null; }
}

// ══════════════════════════════════════════════════
// SCORING
// ══════════════════════════════════════════════════
function getScoreLabel(s) { if (s >= 90) return 'Exceptional'; if (s >= 75) return 'Strong'; if (s >= 60) return 'Needs Work'; if (s >= 45) return 'Critical'; return 'Emergency'; }

function calculateReputationScore(wr, google) {
  let s = 0;
  if (wr?.bbb?.found) s += 5;
  if (wr?.yelp?.found && wr.yelp.rating >= 4.0) s += 5;
  if (wr?.facebook?.found) s += 3;
  if (wr?.otherDirectories?.length > 2) s += 4;
  if ((wr?.redFlags?.length || 0) === 0) s += 3;
  return Math.min(s, 20);
}

// ══════════════════════════════════════════════════
// FULL AUDIT
// ══════════════════════════════════════════════════
async function runFullScan({ businessName, city, state, website, facebookUrl, yelpUrl, industry, biggestChallenge, plan, selectedCompetitors }) {
  plan = ['basic', 'advanced', 'competitive'].includes(plan) ? plan : 'basic';
  console.log(`[SCAN] ═══ FULL AUDIT: ${businessName}, ${city} ═══`);
  const t0 = Date.now();

  // Step 1: Google
  const google = await checkGoogle(businessName, city, state).catch(e => { console.error('[SCAN] Google failed:', e.message); return { found: false, rawScore: 0, maxScore: 35, findings: [] }; });
  const authorityCity = google.address?.split(',').slice(-3, -2)[0]?.trim() || city;
  const authorityState = google.address?.match(/\b([A-Z]{2})\s*\d{5}/)?.[1] || state;
  const siteUrl = website || google.website || null;

  // Step 2: Website
  const websiteData = siteUrl ? await checkWebsite(siteUrl).catch(() => ({ found: false, rawScore: 0, maxScore: 25, findings: [], socialLinks: {} })) : { found: false, rawScore: 0, maxScore: 25, findings: [], socialLinks: {} };

  // Step 3: Web research (Claude does BBB, Yelp, Facebook, competitors, reviews)
  const webResearch = await researchBusinessOnWeb(businessName, authorityCity, authorityState, siteUrl, websiteData.socialLinks || {}, google);

  // Step 4: Competitors
  let compData;
  if (selectedCompetitors?.length > 0) {
    compData = { competitors: selectedCompetitors, source: 'user_selected' };
  } else if (webResearch?.realCompetitors?.length > 0) {
    compData = { competitors: webResearch.realCompetitors.map(c => ({ name: c.name, rating: c.rating, reviewCount: c.reviewCount, whatTheyDoBetter: c.whatTheyDoBetter })), source: 'web_research' };
  } else {
    compData = await checkCompetitors(businessName, authorityCity, authorityState, google).catch(() => ({ competitors: [] }));
  }

  // Step 5: Generate report
  const report = await generateReport(businessName, authorityCity, authorityState, google, websiteData, webResearch, compData.competitors, plan);

  // Step 6: Score
  const overallScore = Math.min(100, (google.rawScore || 0) + (websiteData.rawScore || 0) + calculateReputationScore(webResearch, google) + (compData.competitors?.length > 0 ? 10 : 0));

  // Merge findings: Google + Website + Claude report
  const allFindings = [...(google.findings || []), ...(websiteData.findings || []), ...(report?.findings || [])];
  // Deduplicate by title
  const seen = new Set();
  const dedupedFindings = allFindings.filter(f => { if (seen.has(f.title)) return false; seen.add(f.title); return true; });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[SCAN] ═══ DONE in ${elapsed}s. Score: ${overallScore}/100. Findings: ${dedupedFindings.length} ═══`);

  // Headlines
  const topComp = compData.competitors?.[0]?.name;
  const compPhrase = topComp || `competitors in ${authorityCity}`;
  const reportHeadline = overallScore >= 75 ? `${businessName} Has the Edge — Here's How to Dominate ${authorityCity}` : overallScore >= 60 ? `${businessName} Is Close — Fix These Before ${compPhrase} Pulls Ahead` : overallScore >= 45 ? `${businessName} Is Losing Leads to ${compPhrase}` : `Customers in ${authorityCity} Are Choosing ${compPhrase} Over ${businessName}`;

  const critical = dedupedFindings.filter(f => f.severity === 'critical').length;
  const warning = dedupedFindings.filter(f => f.severity === 'warning').length;
  const lossSummary = critical >= 3 ? `${businessName} has ${critical} critical gaps. Customers are finding ${compPhrase} instead.` : critical >= 1 ? `${businessName} has ${critical} critical issue${critical > 1 ? 's' : ''} and ${warning} warnings. Some customers are going to ${compPhrase}.` : warning >= 3 ? `${businessName} is solid but ${warning} issues are quietly costing customers.` : `${businessName} is in good shape. A few improvements could widen the lead.`;

  return {
    businessName, city: authorityCity, state: authorityState, scannedAt: new Date().toISOString(), plan,
    overallScore, scoreLabel: getScoreLabel(overallScore),
    google: google.found ? google : null,
    website: websiteData.found ? websiteData : null,
    webResearch: webResearch || null, bbbData: webResearch?.bbb || null,
    competitors: { competitors: compData.competitors || [], ranking: null, source: compData.source || null },
    allFindings: dedupedFindings,
    summary: report?.summary || '', revenueImpact: report?.revenueImpact || '',
    topPriorities: report?.topPriorities || [],
    whatYoureDoingWell: report?.whatYoureDoingWell || [],
    competitorIntel: report?.competitorIntel || '',
    operationalInsights: report?.operationalInsights || [],
    marketOpportunities: report?.marketOpportunities || [],
    monthlyGoal: report?.monthlyGoal || '',
    reportHeadline, lossSummary,
    priorityFix: dedupedFindings.find(f => f.severity === 'critical') || null,
    quickWins: dedupedFindings.filter(f => f.severity === 'critical' && f.fix).slice(0, 3).map(f => ({ title: f.title, action: f.fix, impact: f.estimatedLoss || f.impact })),
    socialLinks: websiteData.socialLinks || {},
    dataQuality: { scanTime: elapsed, hasWebResearch: !!webResearch, hasCompetitors: (compData.competitors?.length || 0) > 0, confidence: webResearch?.confidenceLevel || 'low' },
  };
}

// ══════════════════════════════════════════════════
// LIGHT SCAN (untouched)
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
    return {
      type: 'light', teaser: true,
      headline: `${g.name || businessName} — Online Presence Scan`,
      scoreDisplay: `${score}/100`, score, scoreLabel: getScoreLabel(score),
      businessName: g.name || businessName, city, state, scannedAt: new Date().toISOString(),
      rating: g.rating || null, reviewCount: g.reviewCount || 0, address: g.address || null,
      findings: findings.slice(0, 3), moreIssuesCount: Math.max(findings.length - 3, 0),
      explanation: buildLightExplanation(g, score, findings.length),
      cta: { text: 'Unlock Full Scan', subtext: 'Website, Facebook, Yelp, competitors, and a custom action plan' },
    };
  } catch (e) { console.error('[SCAN] Light CRASH:', e.message); return { error: 'Scan failed.', businessName, city, state }; }
}

module.exports = { runFullScan, runLightScan };
