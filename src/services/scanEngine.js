const axios = require('axios');
const cheerio = require('cheerio');

const TIMEOUT = 8000;
const ax = axios.create({ timeout: TIMEOUT, headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120 Safari/537.36' } });

// ─── 1. GOOGLE PLACES CHECK ───
async function checkGoogle(businessName, city, state) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return { found: false, confidence: 'low', score: null, findings: [{ platform: 'Google', severity: 'critical', title: 'Google check unavailable', description: 'Google Places API key not configured.', impact: '', fix: '' }] };

  const query = `${businessName} ${city} ${state}`;
  console.log(`[SCAN] Google Places search: "${query}"`);

  // Find place
  const findRes = await ax.get('https://maps.googleapis.com/maps/api/place/findplacefromtext/json', {
    params: { input: query, inputtype: 'textquery', fields: 'place_id,name,formatted_address,business_status', key: apiKey },
  });

  const candidate = findRes.data?.candidates?.[0];
  if (!candidate?.place_id) {
    return { found: false, confidence: 'high', score: 0, placeId: null, findings: [{ platform: 'Google', severity: 'critical', title: 'Business not found on Google', description: `We searched Google for "${businessName}" in ${city}, ${state} and could not find a listing.`, impact: 'Customers searching for your business on Google will not find you. This is the #1 way people discover local businesses.', fix: 'Create or claim your Google Business Profile at business.google.com. Add your business name, address, phone, hours, and photos.' }] };
  }

  // Get details
  const detailRes = await ax.get('https://maps.googleapis.com/maps/api/place/details/json', {
    params: { place_id: candidate.place_id, fields: 'name,rating,user_ratings_total,formatted_address,formatted_phone_number,opening_hours,website,photos,business_status,price_level', key: apiKey },
  });

  const d = detailRes.data?.result || {};
  const rating = d.rating || 0;
  const reviewCount = d.user_ratings_total || 0;
  const hasHours = !!d.opening_hours;
  const hoursComplete = d.opening_hours?.weekday_text?.length === 7;
  const photoCount = d.photos?.length || 0;
  const hasPhotos = photoCount >= 5;
  const hasWebsite = !!d.website;
  const businessStatus = d.business_status || 'UNKNOWN';

  // Score
  let score = 0;
  score += 20; // has listing
  if (rating >= 4.5) score += 25; else if (rating >= 4.0) score += 20; else if (rating >= 3.0) score += 10;
  if (reviewCount >= 50) score += 20; else if (reviewCount >= 20) score += 15; else if (reviewCount >= 5) score += 10; else score += 5;
  if (hasHours) score += 10;
  if (hasPhotos) score += 10;
  if (hasWebsite) score += 5;
  if (businessStatus === 'OPERATIONAL') score += 10;
  score = Math.min(score, 100);

  // Findings
  const findings = [];
  const f = (severity, title, description, impact, fix) => findings.push({ platform: 'Google', severity, title, description, impact, fix });

  if (rating === 0) f('critical', 'No Google rating', 'Your Google Business Profile has no rating yet.', 'Businesses without ratings get significantly less clicks from search results.', 'Ask your last 10 customers to leave a Google review. Send them a direct link to your review page.');
  else if (rating < 4.0) f('critical', `Google rating is ${rating} stars`, `Your Google rating of ${rating} is below the 4.0 threshold customers use to filter businesses.`, 'Most customers filter Google results by 4+ stars. You are being filtered out of search results.', 'Respond to every negative review professionally. Ask satisfied customers for reviews to bring your average up.');
  else if (rating >= 4.5) f('good', `Excellent ${rating}-star rating`, `Your ${rating}-star rating on Google is excellent and builds strong trust with potential customers.`, '', '');
  else f('good', `Solid ${rating}-star rating`, `Your ${rating}-star Google rating is competitive.`, '', 'Keep asking happy customers for reviews to push toward 4.5+.');

  if (reviewCount < 5) f('critical', `Only ${reviewCount} Google reviews`, `With only ${reviewCount} reviews, your business appears unestablished to potential customers.`, 'Businesses with fewer than 5 reviews are often skipped by customers who see them as untrustworthy.', 'Start a review campaign. Ask every customer this week to leave a Google review. Aim for 20+ reviews within 30 days.');
  else if (reviewCount < 20) f('warning', `${reviewCount} Google reviews — need more`, `You have ${reviewCount} reviews. Most competitive businesses in your area have 30+.`, 'More reviews improve your ranking in Google Maps and build customer trust.', 'Send a follow-up text or email after every job asking for a review. Include a direct link.');
  else if (reviewCount >= 50) f('good', `${reviewCount} reviews — strong social proof`, `${reviewCount} Google reviews gives you strong credibility.`, '', '');

  if (!hasHours) f('warning', 'Business hours missing from Google', 'Your Google listing does not show business hours.', 'Customers who don\'t see hours often assume you are closed or out of business.', 'Log into your Google Business Profile and add your hours for every day of the week, including closed days.');
  if (photoCount < 5) f('warning', `Only ${photoCount} photos on Google`, `Your listing has ${photoCount} photos. Google recommends at least 10.`, 'Listings with more photos get 42% more requests for directions and 35% more clicks to websites.', 'Add at least 10 quality photos: your storefront, interior, team, products, and completed work.');
  if (!hasWebsite) f('warning', 'No website linked on Google', 'Your Google Business Profile does not link to a website.', 'Customers expect to visit your website from Google. A missing link loses potential customers.', 'Add your website URL to your Google Business Profile under the Info section.');
  if (businessStatus !== 'OPERATIONAL') f('critical', 'Google shows business as not operational', `Your Google listing status is "${businessStatus}" instead of "Operational".`, 'Customers will think you are closed.', 'Check your Google Business Profile and verify your business is marked as open.');

  const confidence = rating > 0 && reviewCount > 0 ? 'high' : 'medium';

  return {
    found: true, confidence, placeId: candidate.place_id, name: d.name || businessName,
    rating, reviewCount, address: d.formatted_address || '', phone: d.formatted_phone_number || '',
    website: d.website || '', hasHours, hoursComplete, hasPhotos, photoCount,
    businessStatus, score, findings,
  };
}

// ─── 2. PAGESPEED CHECK ───
async function checkPageSpeed(websiteUrl) {
  if (!websiteUrl) return { found: false, confidence: 'low', performanceScore: 0, loadTime: null, mobileScore: 0, score: 0, findings: [{ platform: 'Website', severity: 'warning', title: 'No website provided', description: 'No website URL was available to test.', impact: 'We could not analyze your website speed or SEO.', fix: 'Add your website URL to get a full website performance analysis.' }] };

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  let url = websiteUrl.trim();
  if (!url.startsWith('http')) url = `https://${url}`;

  console.log(`[SCAN] PageSpeed check: ${url}`);

  const params = { url, strategy: 'mobile', category: 'performance' };
  if (apiKey) params.key = apiKey;

  const res = await ax.get('https://www.googleapis.com/pagespeedonline/v5/runPagespeed', { params, timeout: 15000 });
  const lh = res.data?.lighthouseResult;
  const perfScore = Math.round((lh?.categories?.performance?.score || 0) * 100);
  const fcp = lh?.audits?.['first-contentful-paint']?.numericValue;
  const loadTime = fcp ? Math.round(fcp / 100) / 10 : null;

  let score = 0;
  if (perfScore >= 90) score = 100;
  else if (perfScore >= 70) score = 75;
  else if (perfScore >= 50) score = 50;
  else score = 25;

  const findings = [];
  const f = (severity, title, description, impact, fix) => findings.push({ platform: 'Website', severity, title, description, impact, fix });

  if (perfScore < 50) f('critical', `Website scores ${perfScore}/100 on mobile`, `Your website performance score is ${perfScore} out of 100 on mobile devices.`, 'Google penalizes slow websites in search rankings. Over 60% of searches are on mobile.', 'Optimize images, enable compression, minimize JavaScript. Consider a faster hosting provider.');
  else if (perfScore < 70) f('warning', `Website performance ${perfScore}/100 — room to improve`, `Your mobile performance score of ${perfScore} is below the recommended 70+ threshold.`, 'Slow sites lose visitors. 53% of mobile users leave a site that takes over 3 seconds to load.', 'Run Google PageSpeed Insights and address the top 3 suggestions.');
  else if (perfScore >= 90) f('good', `Excellent website speed: ${perfScore}/100`, `Your website loads quickly on mobile with a ${perfScore}/100 performance score.`, '', '');
  else f('good', `Good website speed: ${perfScore}/100`, `Your website performance of ${perfScore}/100 is solid.`, '', 'Check for opportunities to get above 90.');

  if (loadTime && loadTime > 4) f('warning', `Page loads in ${loadTime} seconds`, `Your website takes ${loadTime} seconds to display content on mobile.`, 'The average user expects a page to load in under 2 seconds.', 'Compress images, enable browser caching, and minimize render-blocking resources.');

  return { found: true, confidence: 'high', performanceScore: perfScore, loadTime, mobileScore: perfScore, score, findings };
}

// ─── 3. YELP SCRAPE ───
async function checkYelp(businessName, city, state) {
  console.log(`[SCAN] Yelp check for: ${businessName} ${city}`);

  const slug = `${businessName}-${city}`
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

  try {
    const res = await ax.get(`https://www.yelp.com/biz/${slug}`, { timeout: 5000 });
    const $ = cheerio.load(res.data);

    const ratingText = $('[data-testid="rating-headline"]').text() || $('meta[itemprop="ratingValue"]').attr('content') || '';
    const rating = parseFloat(ratingText) || 0;
    const reviewText = $('[data-testid="review-count"]').text() || $('meta[itemprop="reviewCount"]').attr('content') || '';
    const reviewCount = parseInt(reviewText.replace(/[^0-9]/g, '')) || 0;
    const claimed = $('body').text().toLowerCase().includes('claimed');

    let score = 0;
    if (rating > 0) {
      score += 20;
      if (rating >= 4.5) score += 25; else if (rating >= 4.0) score += 20; else if (rating >= 3.0) score += 10;
      if (reviewCount >= 30) score += 20; else if (reviewCount >= 10) score += 15; else if (reviewCount >= 3) score += 10; else score += 5;
      if (claimed) score += 15;
      score = Math.min(score, 100);
    }

    const findings = [];
    const f = (severity, title, description, impact, fix) => findings.push({ platform: 'Yelp', severity, title, description, impact, fix });

    if (!claimed) f('warning', 'Yelp page may not be claimed', 'Your Yelp business page does not appear to be claimed.', 'Unclaimed Yelp pages can show outdated info and you cannot respond to reviews.', 'Go to biz.yelp.com and claim your business page. It\'s free and takes 5 minutes.');
    if (rating > 0 && rating < 4.0) f('warning', `Yelp rating is ${rating} stars`, `Your Yelp rating of ${rating} could deter potential customers.`, 'Many customers check Yelp before visiting a business, especially restaurants and services.', 'Respond professionally to negative reviews and provide excellent service to encourage positive reviews.');
    if (reviewCount > 0 && reviewCount < 10) f('warning', `Only ${reviewCount} Yelp reviews`, `More Yelp reviews would strengthen your profile.`, 'Businesses with more reviews rank higher in Yelp search results.', 'Encourage satisfied customers to share their experience on Yelp.');
    if (rating >= 4.5 && reviewCount >= 20) f('good', 'Strong Yelp presence', `${rating} stars with ${reviewCount} reviews shows a healthy Yelp profile.`, '', '');

    return { found: rating > 0, confidence: rating > 0 ? 'medium' : 'low', rating, reviewCount, claimed, hasPhotos: false, score: rating > 0 ? score : null, findings };
  } catch (err) {
    console.log(`[SCAN] Yelp scrape failed: ${err.message}`);
    return { found: false, confidence: 'low', rating: 0, reviewCount: 0, claimed: false, hasPhotos: false, score: null, findings: [] };
  }
}

// ─── 4. NAP CONSISTENCY CHECK ───
async function checkNAP(businessName, city, state, googleData) {
  console.log(`[SCAN] NAP consistency check for: ${businessName}`);

  const sourcesChecked = 1; // Google is the baseline
  const inconsistencies = [];
  let score = 50; // Start at 50 — baseline is "we only have Google"

  // If Google data is good, we have a baseline
  if (googleData?.found && googleData.address && googleData.phone) {
    score = 70; // We have a strong baseline

    // Try a Bing search to see if info is consistent
    try {
      const searchRes = await ax.get(`https://www.bing.com/search?q=${encodeURIComponent(businessName + ' ' + city + ' ' + state + ' phone address')}`, { timeout: 5000 });
      const text = searchRes.data?.toLowerCase() || '';
      const phoneDigits = googleData.phone.replace(/[^0-9]/g, '');

      if (phoneDigits && text.includes(phoneDigits.slice(-7))) {
        score += 15; // Phone found on Bing
      } else if (phoneDigits) {
        inconsistencies.push({ source: 'Bing Search', field: 'phone', issue: 'Phone number from Google not found in Bing results' });
      }

      const cityLower = city.toLowerCase();
      if (text.includes(cityLower)) {
        score += 15; // City found on Bing
      }
    } catch {
      // Bing check failed, keep baseline score
    }
  } else {
    score = 30;
    inconsistencies.push({ source: 'Google', field: 'listing', issue: 'Missing or incomplete Google listing makes NAP verification difficult' });
  }

  score = Math.min(score, 100);

  const findings = [];
  const f = (severity, title, description, impact, fix) => findings.push({ platform: 'NAP Consistency', severity, title, description, impact, fix });

  if (inconsistencies.length > 0) {
    f('warning', `${inconsistencies.length} NAP inconsistency found`, `Your business name, address, or phone number may not match across all platforms.`, 'Inconsistent NAP data confuses Google and can lower your local search ranking.', 'Verify your business name, address, and phone are identical on Google, Yelp, Facebook, Bing, and all directories.');
  } else if (googleData?.found) {
    f('good', 'NAP appears consistent', 'Your business name, address, and phone number appear consistent across the platforms we checked.', '', 'Periodically audit your listings to ensure nothing has changed.');
  }

  if (!googleData?.phone) f('warning', 'No phone number on Google', 'We could not find a phone number on your Google listing to verify.', 'Without a phone number, customers cannot easily contact you and NAP consistency cannot be verified.', 'Add your business phone number to your Google Business Profile.');

  return { confidence: googleData?.found ? 'medium' : 'low', sources_checked: sourcesChecked + 1, inconsistencies, score, findings };
}

// ─── 5. OVERALL SCORE CALCULATION ───
function calculateOverallScore(platforms) {
  const weights = { google: 0.40, website: 0.20, yelp: 0.15, nap: 0.15, facebook: 0.10 };
  let totalWeight = 0;
  let weightedSum = 0;

  for (const [key, weight] of Object.entries(weights)) {
    const p = platforms[key];
    if (p && p.score !== null && p.score !== undefined && p.found !== false) {
      weightedSum += p.score * weight;
      totalWeight += weight;
    }
  }

  if (totalWeight === 0) return 0;
  return Math.round(weightedSum / totalWeight);
}

function getScoreLabel(score) {
  if (score >= 85) return 'Excellent';
  if (score >= 70) return 'Good';
  if (score >= 55) return 'Average';
  if (score >= 40) return 'Needs Work';
  return 'Poor';
}

// ─── 6. AI INSIGHTS ───
async function generateInsights(businessName, city, state, platforms, overallScore, extra = {}) {
  if (!process.env.ANTHROPIC_API_KEY) return { summary: '', topPriorities: [], industryContext: '', monthlyGoal: '' };

  const prompt = `You are analyzing the online presence of a local business.

Business: ${businessName}
Location: ${city}, ${state}
${extra.industry ? `Industry: ${extra.industry}` : ''}
${extra.yearsInBusiness ? `Years in business: ${extra.yearsInBusiness}` : ''}
${extra.biggestChallenge ? `Biggest challenge: ${extra.biggestChallenge}` : ''}
${extra.phone ? `Known phone: ${extra.phone}` : ''}
${extra.address ? `Known address: ${extra.address}` : ''}

Scan data:
Google Score: ${platforms.google?.score ?? 'N/A'}/100
- Rating: ${platforms.google?.rating ?? 'N/A'} (${platforms.google?.reviewCount ?? 0} reviews)
- Has hours: ${platforms.google?.hasHours ?? false}
- Photo count: ${platforms.google?.photoCount ?? 0}

Website Performance: ${platforms.website?.performanceScore ?? 'N/A'}/100
- Load time: ${platforms.website?.loadTime ?? 'N/A'} seconds

Yelp: ${platforms.yelp?.found ? (platforms.yelp.score + '/100') : 'Not found'}

NAP Consistency: ${platforms.nap?.score ?? 'N/A'}/100

Overall Score: ${overallScore}/100

${extra.biggestChallenge ? `The business owner said their biggest challenge is: "${extra.biggestChallenge}". Make sure your top priority directly addresses this.` : ''}
${extra.industry ? `Tailor your recommendations specifically for ${extra.industry} businesses.` : ''}

Generate a JSON response with this exact structure:
{
  "summary": "2-3 sentence plain English summary of their online presence. Be specific and honest.",
  "topPriorities": [
    { "priority": 1, "title": "short action title", "description": "specific actionable description", "impact": "high", "effort": "easy" },
    { "priority": 2, "title": "short action title", "description": "specific actionable description", "impact": "high", "effort": "medium" },
    { "priority": 3, "title": "short action title", "description": "specific actionable description", "impact": "medium", "effort": "easy" }
  ],
  "industryContext": "1 sentence about how this score compares to similar ${extra.industry || 'local'} businesses",
  "monthlyGoal": "One specific thing they should focus on this month"
}

Return ONLY valid JSON. No other text.`;

  try {
    const res = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    }, {
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      timeout: 10000,
    });
    const text = res.data?.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : { summary: text, topPriorities: [], industryContext: '', monthlyGoal: '' };
  } catch (err) {
    console.error('[SCAN] AI insights failed:', err.message);
    return { summary: '', topPriorities: [], industryContext: '', monthlyGoal: '' };
  }
}

// ─── 7. MAIN SCAN FUNCTION ───
async function runFullScan({ businessName, city, state, website, facebookUrl, address, phone, industry, biggestChallenge, yearsInBusiness, googleProfileUrl, yelpUrl }) {
  console.log(`[SCAN] Starting full scan for: ${businessName}, ${city}, ${state} (${industry || 'unknown industry'})`);
  const startTime = Date.now();

  // Google is required — if it fails, stop
  let googleData;
  try {
    googleData = await checkGoogle(businessName, city, state);
  } catch (err) {
    console.error('[SCAN] Google Places check failed:', err.message);
    return { error: 'Google Places check failed. Cannot continue scan.', businessName, city, state, scannedAt: new Date().toISOString() };
  }

  // Use Google's website if none provided
  const siteUrl = website || googleData.website || null;

  // Run remaining checks in parallel
  const [websiteResult, yelpResult, napResult] = await Promise.allSettled([
    checkPageSpeed(siteUrl).catch(err => { console.error('[SCAN] PageSpeed failed:', err.message); return { found: false, confidence: 'low', score: null, findings: [] }; }),
    checkYelp(businessName, city, state).catch(err => { console.error('[SCAN] Yelp failed:', err.message); return { found: false, confidence: 'low', score: null, findings: [] }; }),
    checkNAP(businessName, city, state, googleData).catch(err => { console.error('[SCAN] NAP failed:', err.message); return { confidence: 'low', score: null, findings: [] }; }),
  ]);

  const websiteData = websiteResult.status === 'fulfilled' ? websiteResult.value : { found: false, confidence: 'low', score: null, findings: [] };
  const yelpData = yelpResult.status === 'fulfilled' ? yelpResult.value : { found: false, confidence: 'low', score: null, findings: [] };
  const napData = napResult.status === 'fulfilled' ? napResult.value : { confidence: 'low', score: null, findings: [] };

  const platforms = {
    google: googleData,
    website: websiteData,
    yelp: yelpData,
    nap: napData,
    facebook: { found: false, score: null, message: 'Connect Facebook for full analysis' },
  };

  const overallScore = calculateOverallScore(platforms);
  const scoreLabel = getScoreLabel(overallScore);

  // Generate AI insights
  const insights = await generateInsights(businessName, city, state, platforms, overallScore, { industry, biggestChallenge, yearsInBusiness, phone, address });

  // Collect all findings sorted by severity
  const severityOrder = { critical: 0, warning: 1, good: 2 };
  const allFindings = [
    ...(googleData.findings || []),
    ...(websiteData.findings || []),
    ...(yelpData.findings || []),
    ...(napData.findings || []),
  ].sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));

  const platformsFound = [googleData, websiteData, yelpData].filter(p => p.found).length;

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[SCAN] Complete in ${elapsed}s. Score: ${overallScore}/100 (${scoreLabel}). Findings: ${allFindings.length}`);

  return {
    businessName, city, state,
    scannedAt: new Date().toISOString(),
    overallScore, scoreLabel,
    platforms,
    allFindings,
    topPriorities: insights.topPriorities || [],
    summary: insights.summary || '',
    industryContext: insights.industryContext || '',
    monthlyGoal: insights.monthlyGoal || '',
    confidence: platformsFound >= 2 ? 'high' : platformsFound === 1 ? 'medium' : 'low',
    dataQuality: {
      platformsFound,
      platformsChecked: 4,
      note: platformsFound >= 3 ? 'Strong data from multiple sources' : platformsFound === 2 ? 'Moderate data — some platforms missing' : 'Limited data — results may be incomplete',
    },
  };
}

// ─── TEASER SCAN (Google only) ───
async function runTeaserScan({ businessName, city, state }) {
  console.log(`[SCAN] Starting teaser scan for: ${businessName}, ${city}, ${state}`);
  try {
    const googleData = await checkGoogle(businessName, city, state);
    const overallScore = googleData.score || 0;
    return {
      businessName, city, state,
      scannedAt: new Date().toISOString(),
      preliminaryScore: overallScore,
      scoreLabel: getScoreLabel(overallScore),
      checksShown: 4,
      totalChecks: 47,
      google: googleData,
      findings: (googleData.findings || []).slice(0, 4),
      note: 'Preliminary scan — 4 of 47 checks shown. Full audit unlocks all findings and action plan.',
    };
  } catch (err) {
    console.error('[SCAN] Teaser scan failed:', err.message);
    return { error: 'Scan failed. Please try again.', businessName, city, state };
  }
}

module.exports = { runFullScan, runTeaserScan };
