const OpenAI = require('openai');
const { runScraper } = require('./scraper');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

  const insights = extractInsights(scrapedData);

  const prompt = `You are a Facebook business page audit analyzer.
Return ONLY valid JSON. No markdown. No code fences.

Return this exact shape:
{
  "audit_mode": "data" or "strategy",
  "page_name": string or null,
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

INTAKE: ${JSON.stringify(order)}
SCRAPER STATUS: ${JSON.stringify({ scraperStatus, scraperError })}
SCRAPED INSIGHTS: ${JSON.stringify(insights)}`;

  const response = await client.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    response_format: { type: 'json_object' },
  });

  let analysis;
  try {
    analysis = JSON.parse(response.choices?.[0]?.message?.content || '{}');
  } catch {
    analysis = {
      audit_mode: scraperStatus === 'success' ? 'data' : 'strategy',
      page_name: insights?.pageName || null,
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