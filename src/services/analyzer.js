const OpenAI = require("openai");
const { runScraper } = require("./scraper");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function normalizeOrder(order) {
  return {
    name: order.name || null,
    email: order.email || null,
    pageUrl: order.page_url || order.pageUrl || order.facebook_url || null,
    goal: order.mainGoal || order.goal || null,
    struggles: null,
    reviewType: order.review_type || order.reviewType || "Business",
    postingFrequency: order.postingFrequency || order.posting_frequency || null,
    contentType: order.contentType || order.content_type || null,
  };
}

function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function extractPostsFromBrightData(scrapedData) {
  if (!scrapedData) return [];

  if (Array.isArray(scrapedData)) return scrapedData;
  if (Array.isArray(scrapedData.data)) return scrapedData.data;
  if (Array.isArray(scrapedData.results)) return scrapedData.results;
  if (Array.isArray(scrapedData.items)) return scrapedData.items;
  if (Array.isArray(scrapedData.posts)) return scrapedData.posts;

  return [];
}

function extractInsights(scrapedData) {
  const posts = extractPostsFromBrightData(scrapedData).slice(0, 10);

  if (!posts.length) {
    return null;
  }

  const first = posts[0] || {};

  const totalLikes = posts.reduce(
    (sum, p) => sum + (numberOrNull(p.likes) || 0),
    0
  );

  const totalComments = posts.reduce(
    (sum, p) => sum + (numberOrNull(p.num_comments || p.comments) || 0),
    0
  );

  const totalShares = posts.reduce(
    (sum, p) => sum + (numberOrNull(p.num_shares || p.shares) || 0),
    0
  );

  const totalViews = posts.reduce(
    (sum, p) =>
      sum +
      (numberOrNull(
        pickFirst(
          p.video_view_count,
          p.play_count,
          p.video_views,
          p.views
        )
      ) || 0),
    0
  );

  const avgLikes = posts.length ? Math.round(totalLikes / posts.length) : null;
  const avgComments = posts.length ? Math.round(totalComments / posts.length) : null;
  const avgShares = posts.length ? Math.round(totalShares / posts.length) : null;
  const avgViews = totalViews > 0 ? Math.round(totalViews / posts.length) : null;

  let engagementLevel = null;
  if (avgLikes !== null || avgComments !== null || avgShares !== null) {
    const score = (avgLikes || 0) + (avgComments || 0) * 3 + (avgShares || 0) * 4;

    if (score >= 300) engagementLevel = "high";
    else if (score >= 75) engagementLevel = "medium";
    else engagementLevel = "low";
  }

  return {
    pageName: pickFirst(
      first.page_name,
      first.user_username_raw,
      first.user_name,
      first.page_title,
      first.author_name
    ),
    followers: numberOrNull(
      pickFirst(
        first.page_followers,
        first.followers,
        first.page_followers_count,
        first.followers_count
      )
    ),
    category: pickFirst(first.page_category, first.category),
    intro: pickFirst(first.page_intro, first.about, first.bio),
    website: pickFirst(first.page_external_website, first.website),
    verified:
      typeof first.page_is_verified === "boolean"
        ? first.page_is_verified
        : typeof first.is_verified === "boolean"
        ? first.is_verified
        : null,
    postCountAnalyzed: posts.length,
    avgLikes,
    avgComments,
    avgShares,
    avgViews,
    engagementLevel,
    samplePostText: posts
      .map((p) => pickFirst(p.content, p.text, p.post_text, p.caption))
      .filter(Boolean)
      .slice(0, 3),
  };
}

function buildAnalyzerPrompt(order, insights, scraperStatus, scraperError) {
  return `
You are a Facebook business page audit analyzer.

Return ONLY valid JSON.
No markdown.
No code fences.
No explanation outside JSON.
Do not invent metrics.
If unknown, use null.

Return this exact shape:
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

Rules:
1. If scraperStatus is not "success", audit_mode must be "strategy".
2. Use verified_metrics only from SCRAPED INSIGHTS.
3. Never put 0 unless it is verified.
4. Focus on business page growth.
5. Keep items short and specific.
6. Output JSON only.
7. Verified scraped insights are the primary source of truth.
8. Intake answers are supporting context only.
9. Never infer performance metrics from intake answers.
10. Never let questionnaire answers override scraped data.

INTAKE DATA:
${JSON.stringify(order, null, 2)}

SCRAPER STATUS:
${JSON.stringify({ scraperStatus, scraperError }, null, 2)}

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

  if (!pageUrl) {
    scraperStatus = "failed";
    scraperError = "Missing page URL";
  } else {
    const scraperResult = await runScraper(pageUrl);

    if (scraperResult?.ok) {
      scrapedData = scraperResult.data;
      scraperStatus = "success";
    } else {
      scraperStatus = "failed";
      scraperError = scraperResult?.error || "Unknown scraper failure";
    }
  }

  const insights = extractInsights(scrapedData);

  console.log("SCRAPER STATUS:", scraperStatus);
  console.log("SCRAPER ERROR:", scraperError);
  console.log(
    "SCRAPER RAW SAMPLE:",
    JSON.stringify(scrapedData || null).slice(0, 1200)
  );
  console.log("SCRAPER INSIGHTS:", JSON.stringify(insights, null, 2));

  const prompt = buildAnalyzerPrompt(
    normalizedOrder,
    insights,
    scraperStatus,
    scraperError
  );

  const response = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [{ role: "user", content: prompt }],
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
      core_problems: [
        "Analyzer JSON parsing failed",
        "Fallback analysis used",
        "Scraped data may need field mapping",
      ],
      strengths: [],
      opportunities: [],
      recommended_focus: [],
      confidence_notes: [
        "AI JSON parsing failed",
        "Fallback object returned",
      ],
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