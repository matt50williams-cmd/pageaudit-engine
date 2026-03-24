const OpenAI = require("openai");
const { runScraper } = require("./scraper");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function extractInsights(scrapedData) {
  if (!scrapedData || !Array.isArray(scrapedData) || scrapedData.length === 0) {
    return null;
  }

  const posts = scrapedData.slice(0, 10);
  const first = posts[0] || {};

  const totalLikes = posts.reduce((sum, p) => sum + (p.likes || 0), 0);
  const totalComments = posts.reduce((sum, p) => sum + (p.num_comments || 0), 0);
  const totalShares = posts.reduce((sum, p) => sum + (p.num_shares || 0), 0);
  const totalViews = posts.reduce(
    (sum, p) => sum + (p.video_view_count || p.play_count || 0),
    0
  );

  const avgLikes = posts.length ? Math.round(totalLikes / posts.length) : null;
  const avgComments = posts.length ? Math.round(totalComments / posts.length) : null;
  const avgShares = posts.length ? Math.round(totalShares / posts.length) : null;
  const avgViews = posts.length ? Math.round(totalViews / posts.length) : null;

  let engagementLevel = null;
  if (avgLikes !== null && avgComments !== null) {
    if (avgLikes > 200 || avgComments > 30) engagementLevel = "high";
    else if (avgLikes > 50 || avgComments > 10) engagementLevel = "medium";
    else engagementLevel = "low";
  }

  return {
    pageName: first.page_name || first.user_username_raw || null,
    followers: first.page_followers ?? null,
    category: first.page_category || null,
    intro: first.page_intro || null,
    website: first.page_external_website || null,
    verified:
      typeof first.page_is_verified === "boolean" ? first.page_is_verified : null,
    postCountAnalyzed: posts.length || 0,
    avgLikes,
    avgComments,
    avgShares,
    avgViews,
    engagementLevel,
    samplePostText: posts
      .map((p) => p.content)
      .filter(Boolean)
      .slice(0, 3),
  };
}

function normalizeOrder(order) {
  return {
    name: order.name || null,
    email: order.email || null,
    pageUrl: order.page_url || order.pageUrl || order.facebook_url || null,
    goal: order.goal || order.goals || null,
    struggles: order.struggles || null,
    reviewType: order.review_type || order.reviewType || null,
    postingFrequency: order.postingFrequency || order.posting_frequency || null,
    contentType: order.contentType || order.content_type || null,
  };
}

function buildAnalyzerPrompt(order, insights, scraperStatus, scraperError) {
  return `
You are a Facebook page audit analyzer.

Your job is to output ONLY valid JSON.
Do not write a report.
Do not use markdown.
Do not use code fences.
Do not invent data.
If data is unavailable, use null instead of guessing.

Return this exact JSON shape:

{
  "audit_mode": "data" or "strategy",
  "page_type": "business" or "personal" or null,
  "page_name": string or null,
  "verified_metrics": {
    "followers": number or null,
    "avg_likes": number or null,
    "avg_comments": number or null,
    "avg_shares": number or null,
    "avg_views": number or null,
    "engagement_level": "high" or "medium" or "low" or null
  },
  "input_summary": {
    "goal": string or null,
    "struggles": string or null,
    "posting_frequency": string or null,
    "content_type": string or null
  },
  "core_problems": [string, string, string],
  "strengths": [string, string, string],
  "opportunities": [string, string, string],
  "recommended_focus": [string, string, string],
  "confidence_notes": [string, string]
}

RULES:
1. If scraperStatus is not "success", audit_mode must be "strategy".
2. If followers or engagement metrics are not verified, keep them null.
3. Never say 0 unless the metric was actually verified as 0.
4. Focus on known facts from:
   - intake data
   - verified scraped insights
5. Keep each list item short and specific.
6. If page looks like a business page, set page_type to "business". If unclear, null.
7. Output JSON only.

INTAKE DATA:
${JSON.stringify(order, null, 2)}

SCRAPER STATUS:
${JSON.stringify(
  {
    scraperStatus,
    scraperError,
  },
  null,
  2
)}

SCRAPED INSIGHTS:
${JSON.stringify(insights, null, 2)}
`;
}

async function runAnalyzer(order) {
  const normalizedOrder = normalizeOrder(order);
  const pageUrl = normalizedOrder.pageUrl;

  let scrapedData = null;
  let scraperStatus = "not_attempted";
  let scraperError = null;

  if (pageUrl) {
    const scraperResult = await runScraper(pageUrl);

    if (scraperResult.ok) {
      scrapedData = scraperResult.data;
      scraperStatus = "success";
    } else {
      scraperStatus = "failed";
      scraperError = scraperResult.error || "Unknown scraper failure";
    }
  }

  const insights = extractInsights(scrapedData);
  const prompt = buildAnalyzerPrompt(
    normalizedOrder,
    insights,
    scraperStatus,
    scraperError
  );

  const response = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
  });

  const raw = response.choices?.[0]?.message?.content || "{}";

  let analysis;
  try {
    analysis = JSON.parse(raw);
  } catch (error) {
    analysis = {
      audit_mode: scraperStatus === "success" ? "data" : "strategy",
      page_type: null,
      page_name: insights?.pageName || null,
      verified_metrics: {
        followers: insights?.followers ?? null,
        avg_likes: insights?.avgLikes ?? null,
        avg_comments: insights?.avgComments ?? null,
        avg_shares: insights?.avgShares ?? null,
        avg_views: insights?.avgViews ?? null,
        engagement_level: insights?.engagementLevel ?? null,
      },
      input_summary: {
        goal: normalizedOrder.goal,
        struggles: normalizedOrder.struggles,
        posting_frequency: normalizedOrder.postingFrequency,
        content_type: normalizedOrder.contentType,
      },
      core_problems: ["Analyzer parsing failed"],
      strengths: [],
      opportunities: [],
      recommended_focus: [],
      confidence_notes: ["AI JSON parsing failed"],
    };
  }

  return {
    analysis,
    scraperStatus,
    scraperError,
    scraperInsights: insights,
  };
}

module.exports = { runAnalyzer };