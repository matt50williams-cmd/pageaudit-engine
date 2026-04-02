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
  const insights = extractInsights(scrapedData);

  const prompt = `You are a Facebook business page audit analyzer.

STEP 1 — UNDERSTAND THE BUSINESS:
${websiteUrl ? `The business website is: ${websiteUrl}
You MUST use the web_search tool to fetch and read this website BEFORE analyzing anything else. From the website, determine:
- The exact business type (e.g., "HVAC Contractor", "Personal Injury Law Firm", "Italian Restaurant", "Dog Grooming Salon")
- The specific services or products they offer
- Their mission or value proposition
Use ONLY what the website actually says. Do NOT guess or assume.` : `No website URL was provided. Set detected_business_type and detected_services to null. Do NOT guess the business type.`}

STEP 2 — ANALYZE THE FACEBOOK PAGE:
Using the scraped Facebook data and user intake below, analyze their Facebook presence.

Return ONLY valid JSON. No markdown. No code fences.

Return this exact shape:
{
  "audit_mode": "data" or "strategy",
  "page_name": string or null,
  "detected_business_type": string or null,
  "detected_services": string or null,
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

CRITICAL RULE FOR detected_business_type AND detected_services:
- If you fetched the website, use what you found to determine the ACTUAL business type and services.
- If no website was provided or the fetch failed, set both to null. Do NOT guess or assume.
- Never use generic labels like "Local Business" or "Service Provider" unless the website explicitly says that.
- Be specific: "HVAC Contractor", "Personal Injury Law Firm", "Italian Restaurant", "Dog Grooming Salon", etc.
- For detected_services, list the specific services mentioned on the website (e.g., "AC repair, furnace installation, duct cleaning").

INTAKE: ${JSON.stringify(order)}
SCRAPER STATUS: ${JSON.stringify({ scraperStatus, scraperError })}
SCRAPED INSIGHTS: ${JSON.stringify(insights)}`;

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Missing ANTHROPIC_API_KEY environment variable');
  }

  const tools = websiteUrl ? [{
    name: 'web_search',
    description: 'Search the web or fetch a URL to read its contents',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'The URL or search query' } }, required: ['query'] },
  }] : [];

  let messages = [{ role: 'user', content: prompt }];
  let analysis;
  const maxTurns = 3;

  for (let turn = 0; turn < maxTurns; turn++) {
    const body = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages,
    };
    if (tools.length > 0) body.tools = tools;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || 'Analyzer request failed');

    if (data.stop_reason === 'tool_use') {
      const toolUseBlock = data.content.find(b => b.type === 'tool_use');
      if (toolUseBlock) {
        let fetchResult;
        try {
          let targetUrl = toolUseBlock.input?.query || websiteUrl;
          if (!targetUrl.startsWith('http')) targetUrl = `https://${targetUrl}`;
          const fetchRes = await fetch(targetUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120 Safari/537.36' },
            signal: AbortSignal.timeout(10000),
          });
          if (fetchRes.ok) {
            const html = await fetchRes.text();
            const bodyText = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000);
            fetchResult = bodyText;
          } else {
            fetchResult = `Failed to fetch: HTTP ${fetchRes.status}`;
          }
        } catch (err) {
          fetchResult = `Failed to fetch: ${err.message}`;
        }
        messages.push({ role: 'assistant', content: data.content });
        messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseBlock.id, content: fetchResult }] });
        continue;
      }
    }

    // Extract text response
    const textBlock = data.content?.find(b => b.type === 'text');
    const aiText = textBlock?.text || '';
    try {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      analysis = JSON.parse(jsonMatch ? jsonMatch[0] : aiText);
    } catch {
      analysis = null;
    }
    break;
  }

  if (!analysis) {
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