const { runScraper } = require('./scraper');

function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const cleaned = String(value).replace(/[^0-9.-]/g, '');
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function extractInsights(scrapedData) {
  let posts = [];
  if (!scrapedData) return null;
  if (Array.isArray(scrapedData)) posts = scrapedData;
  else if (Array.isArray(scrapedData.data)) posts = scrapedData.data;
  else if (Array.isArray(scrapedData.results)) posts = scrapedData.results;
  posts = posts.slice(0, 10);
  if (!posts.length) return null;

  const first = posts[0] || {};
  const totalLikes = posts.reduce((sum, p) => sum + (numberOrNull(p.likes) || 0), 0);
  const totalComments = posts.reduce((sum, p) => sum + (numberOrNull(p.num_comments || p.comments) || 0), 0);
  const totalShares = posts.reduce((sum, p) => sum + (numberOrNull(p.num_shares || p.shares) || 0), 0);

  const avgLikes = posts.length ? Math.round(totalLikes / posts.length) : null;
  const avgComments = posts.length ? Math.round(totalComments / posts.length) : null;
  const avgShares = posts.length ? Math.round(totalShares / posts.length) : null;

  let engagementLevel = null;
  if (avgLikes !== null || avgComments !== null) {
    const score = (avgLikes || 0) + (avgComments || 0) * 3 + (avgShares || 0) * 4;
    if (score >= 300) engagementLevel = 'high';
    else if (score >= 75) engagementLevel = 'medium';
    else engagementLevel = 'low';
  }

  return {
    pageName: pickFirst(first.page_name, first.user_name, first.author_name),
    followers: numberOrNull(pickFirst(first.page_followers, first.followers, first.followers_count)),
    category: pickFirst(first.page_category, first.category),
    postCountAnalyzed: posts.length,
    avgLikes, avgComments, avgShares, engagementLevel,
    samplePostText: posts.map(p => pickFirst(p.content, p.text, p.post_text, p.caption)).filter(Boolean).slice(0, 3),
  };
}

function cleanHtml(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<nav[\s\S]*?<\/nav>/gi, '').replace(/<footer[\s\S]*?<\/footer>/gi, '').replace(/<header[\s\S]*?<\/header>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120 Safari/537.36' },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html;
  } catch {
    return null;
  }
}

async function scrapeWebsiteDeep(websiteUrl) {
  if (!websiteUrl) return null;

  let baseUrl = websiteUrl.trim();
  if (!baseUrl.startsWith('http')) baseUrl = `https://${baseUrl}`;
  baseUrl = baseUrl.replace(/\/+$/, '');

  // Fetch homepage first
  const homepageHtml = await fetchPage(baseUrl);
  if (!homepageHtml) {
    console.log(`[ANALYZER DEBUG] Could not fetch homepage: ${baseUrl}`);
    return null;
  }

  // Extract internal links from homepage to find about/services/mission pages
  const linkRegex = /href=["']([^"']+)["']/gi;
  const links = [];
  let match;
  while ((match = linkRegex.exec(homepageHtml)) !== null) links.push(match[1]);

  const keyPagePatterns = [
    /\b(about|about-us|who-we-are|our-story|our-team)\b/i,
    /\b(services|what-we-do|our-services|practice-areas|specialties)\b/i,
    /\b(mission|values|our-mission|purpose|vision)\b/i,
    /\b(contact|location|find-us)\b/i,
  ];

  // Resolve and deduplicate key page URLs
  const keyPages = new Set();
  for (const link of links) {
    for (const pattern of keyPagePatterns) {
      if (pattern.test(link)) {
        try {
          const resolved = new URL(link, baseUrl).href;
          // Only follow links on the same domain
          if (resolved.startsWith(baseUrl) || resolved.includes(new URL(baseUrl).hostname)) {
            keyPages.add(resolved);
          }
        } catch {}
        break;
      }
    }
  }

  console.log(`[ANALYZER DEBUG] Found ${keyPages.size} key pages to scrape: ${[...keyPages].join(', ')}`);

  // Also try common paths if not found in links
  const commonPaths = ['/about', '/about-us', '/services', '/our-services', '/mission', '/what-we-do'];
  for (const path of commonPaths) {
    const fullUrl = baseUrl + path;
    if (!keyPages.has(fullUrl) && keyPages.size < 6) {
      keyPages.add(fullUrl);
    }
  }

  // Fetch all key pages in parallel (plus homepage already fetched)
  const pageResults = await Promise.all(
    [...keyPages].map(async (url) => {
      const html = await fetchPage(url);
      if (!html) return null;
      return { url, text: cleanHtml(html).slice(0, 3000) };
    })
  );

  const homepageText = cleanHtml(homepageHtml);

  // Extract meta info from homepage
  const titleMatch = homepageHtml.match(/<title[^>]*>([^<]+)/i);
  const descMatch = homepageHtml.match(/meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)
    || homepageHtml.match(/meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  const ogDescMatch = homepageHtml.match(/og:description[^>]+content=["']([^"']+)/i);

  const pages = [
    { url: baseUrl, label: 'Homepage', text: homepageText.slice(0, 3000) },
    ...pageResults.filter(Boolean),
  ];

  const totalChars = pages.reduce((sum, p) => sum + p.text.length, 0);
  console.log(`[ANALYZER DEBUG] Scraped ${pages.length} pages, ${totalChars} total chars`);

  return {
    title: titleMatch?.[1]?.trim() || null,
    description: descMatch?.[1]?.trim() || ogDescMatch?.[1]?.trim() || null,
    pages,
  };
}

async function runAnalyzer(order) {
  const pageUrl = order.page_url || order.pageUrl || order.facebook_url;
  let scrapedData = null;
  let scraperStatus = 'not_attempted';
  let scraperError = null;

  if (!pageUrl) {
    scraperStatus = 'failed';
    scraperError = 'Missing page URL';
  } else {
    const scraperResult = await runScraper(pageUrl);
    if (scraperResult?.ok) {
      scrapedData = scraperResult.data;
      scraperStatus = 'success';
    } else {
      scraperStatus = 'failed';
      scraperError = scraperResult?.error || 'Unknown scraper failure';
    }
  }

  const websiteUrl = order.website || null;
  console.log(`[ANALYZER DEBUG] Website URL passed in: ${websiteUrl || 'NONE'}`);

  // Deep-scrape the website before calling Claude
  const websiteData = await scrapeWebsiteDeep(websiteUrl);
  const insights = extractInsights(scrapedData);

  // Build website context from all scraped pages
  let websiteContext = '';
  if (websiteData) {
    websiteContext = `\nWEBSITE CONTENT (scraped from ${websiteData.pages.length} pages):
Title: ${websiteData.title || 'N/A'}
Meta Description: ${websiteData.description || 'N/A'}
${websiteData.pages.map(p => `\n--- ${p.label || p.url} ---\n${p.text}`).join('\n')}`;
  }

  const prompt = `You are a Facebook business page audit analyzer.

STEP 1 — UNDERSTAND THE BUSINESS:
${websiteData ? `We scraped the business website (${websiteUrl}) including their homepage, about page, services page, and mission page. The full content is provided below under WEBSITE CONTENT.

READ ALL OF THE WEBSITE CONTENT CAREFULLY. From it, determine:
- The EXACT business type — be very specific (e.g., "HVAC Contractor", "Personal Injury Law Firm", "Italian Restaurant", "Nonprofit Youth Ministry")
- The specific services, products, or programs they offer
- Their mission statement or core purpose (look for "our mission", "what we do", "about us", "who we are" sections)
- What makes them different from competitors

Use ONLY what the website actually says. Pay special attention to About, Services, Mission, and What We Do pages. The homepage alone may not tell the full story — read ALL pages provided.

DO NOT default to a generic label based on the business name. For example, a business called "Righteous Law" might be a church, a nonprofit, or a legal aid organization — READ THE ACTUAL CONTENT to find out.` : `No website URL was provided. Set detected_business_type, detected_services, and detected_mission to null. Do NOT guess the business type.`}

STEP 2 — ANALYZE THE FACEBOOK PAGE:
Using the scraped Facebook data and user intake below, analyze their Facebook presence.

Return ONLY valid JSON. No markdown. No code fences.

Return this exact shape:
{
  "audit_mode": "data" or "strategy",
  "page_name": string or null,
  "detected_business_type": string or null,
  "detected_services": string or null,
  "detected_mission": string or null,
  "verified_metrics": {
    "followers": number or null,
    "avg_likes": number or null,
    "avg_comments": number or null,
    "avg_shares": number or null,
    "engagement_level": "high" or "medium" or "low" or null
  },
  "page_presence": "strong" or "medium" or "weak",
  "content_quality": "strong" or "medium" or "weak",
  "posting_consistency": "strong" or "medium" or "weak",
  "input_summary": { "goal": string or null, "posting_frequency": string or null, "content_type": string or null },
  "core_problems": [string, string, string],
  "strengths": [string, string, string],
  "opportunities": [string, string, string],
  "recommended_focus": [string, string, string],
  "confidence_notes": [string]
}

SCORING RULES for page_presence, content_quality, and posting_consistency:

page_presence (how discoverable and professional the page is):
- "strong": page has a clear name, profile photo, cover photo, complete about section, and category. Followers > 500.
- "medium": page exists and has basic info but is missing some elements, or followers 100-500.
- "weak": page is hard to find, missing key info, very few followers (< 100), or scraper could not find the page.

content_quality (how good the actual posts are):
- "strong": posts are varied, include images/videos, have clear CTAs, and show business expertise. Avg likes > 20.
- "medium": posts exist but are inconsistent in quality, mostly text or reposts. Avg likes 5-20.
- "weak": very few posts, low effort content, no images/videos, or no posts found. Avg likes < 5.

posting_consistency (how regularly they post):
- "strong": user reports posting daily or multiple times per week AND scraped data confirms regular recent posts.
- "medium": user reports posting weekly or a few times a week, OR data shows some gaps.
- "weak": user reports posting rarely/never, OR data shows long gaps between posts, OR no post data available.

If scraper data is unavailable, infer from the user's self-reported posting frequency and content type. Always return a value — never null.

CRITICAL RULES FOR BUSINESS TYPE DETECTION:
- Read ALL website pages provided — not just the homepage. The About, Services, and Mission pages contain the most important information.
- detected_business_type must reflect what the business ACTUALLY DOES, not what the name sounds like.
- detected_services must list specific services/programs/products mentioned on the website.
- detected_mission should be the business's mission statement or core purpose, quoted or closely paraphrased from the website.
- If no website content was provided, set all three to null. Do NOT guess or assume.
- Never use generic labels like "Local Business" or "Service Provider" unless the website explicitly says that.
- Be specific: "HVAC Contractor", "Personal Injury Law Firm", "Italian Restaurant", "Nonprofit Youth Ministry", etc.

INTAKE: ${JSON.stringify(order)}
SCRAPER STATUS: ${JSON.stringify({ scraperStatus, scraperError })}
SCRAPED INSIGHTS: ${JSON.stringify(insights)}
${websiteContext}`;

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Missing ANTHROPIC_API_KEY environment variable');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || 'Analyzer request failed');

  let analysis;
  const textBlock = data.content?.find(b => b.type === 'text');
  const aiText = textBlock?.text || '';
  try {
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    analysis = JSON.parse(jsonMatch ? jsonMatch[0] : aiText);
  } catch {
    console.log(`[ANALYZER DEBUG] JSON parse failed. Raw response: ${aiText.slice(0, 500)}`);
    analysis = null;
  }
  console.log(`[ANALYZER DEBUG] detected_business_type: ${analysis?.detected_business_type || 'NULL'}`);
  console.log(`[ANALYZER DEBUG] detected_services: ${analysis?.detected_services || 'NULL'}`);
  console.log(`[ANALYZER DEBUG] detected_mission: ${analysis?.detected_mission || 'NULL'}`);

  if (!analysis) {
    console.log(`[ANALYZER DEBUG] Using fallback — Claude response could not be parsed`);
    analysis = {
      audit_mode: scraperStatus === 'success' ? 'data' : 'strategy',
      page_name: insights?.pageName || null,
      detected_business_type: null,
      detected_services: null,
      verified_metrics: { followers: insights?.followers ?? null, avg_likes: insights?.avgLikes ?? null, avg_comments: insights?.avgComments ?? null, avg_shares: insights?.avgShares ?? null, engagement_level: insights?.engagementLevel ?? null },
      input_summary: { goal: order.mainGoal, posting_frequency: order.postingFrequency, content_type: order.contentType },
      page_presence: scraperStatus === 'success' ? 'medium' : 'weak',
      content_quality: insights?.avgLikes > 20 ? 'strong' : insights?.avgLikes > 5 ? 'medium' : 'weak',
      posting_consistency: order.postingFrequency === 'Daily' ? 'strong' : order.postingFrequency === 'Rarely or never' ? 'weak' : 'medium',
      core_problems: ['Analyzer parsing failed', 'Fallback used', 'Check scraper data'],
      strengths: [], opportunities: [], recommended_focus: [], confidence_notes: ['Fallback used'],
    };
  }

  return { analysis, scraperStatus, scraperError, scraperInsights: insights };
}

module.exports = { runAnalyzer };