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

  const totalLikes = posts.reduce((sum, p) => sum + (p.likes || 0), 0);
  const totalComments = posts.reduce((sum, p) => sum + (p.num_comments || 0), 0);
  const totalShares = posts.reduce((sum, p) => sum + (p.num_shares || 0), 0);
  const totalViews = posts.reduce((sum, p) => sum + (p.video_view_count || p.play_count || 0), 0);

  const avgLikes = posts.length ? Math.round(totalLikes / posts.length) : 0;
  const avgComments = posts.length ? Math.round(totalComments / posts.length) : 0;
  const avgShares = posts.length ? Math.round(totalShares / posts.length) : 0;
  const avgViews = posts.length ? Math.round(totalViews / posts.length) : 0;

  let engagementLevel = "LOW";
  if (avgLikes > 50 || avgComments > 10) engagementLevel = "MEDIUM";
  if (avgLikes > 200 || avgComments > 30) engagementLevel = "HIGH";

  const first = posts[0] || {};

  return {
    pageName: first.page_name || first.user_username_raw || "Unknown",
    followers: first.page_followers || 0,
    category: first.page_category || "Unknown",
    intro: first.page_intro || "",
    website: first.page_external_website || "",
    verified: Boolean(first.page_is_verified),
    postCountAnalyzed: posts.length,
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

function buildScores(order, insights) {
  const goalText = `${order.goal || ""} ${order.struggles || ""}`.toLowerCase();

  let visibilityScore = 55;
  let contentScore = 55;
  let consistencyScore = 50;
  let engagementScore = 50;
  let growthPotentialScore = 60;

  if (insights) {
    if (insights.followers >= 1000) visibilityScore += 10;
    if (insights.website) visibilityScore += 5;
    if (insights.verified) visibilityScore += 5;

    if (insights.avgLikes < 10) engagementScore -= 15;
    if (insights.avgComments < 3) engagementScore -= 10;
    if (insights.avgShares > 3) engagementScore += 10;

    if (insights.samplePostText.length >= 2) contentScore += 5;
    if (insights.avgViews > 500) contentScore += 10;

    if (insights.engagementLevel === "LOW") growthPotentialScore += 10;
    if (insights.engagementLevel === "HIGH") growthPotentialScore -= 5;
  }

  if (goalText.includes("engagement")) growthPotentialScore += 5;
  if (goalText.includes("followers")) growthPotentialScore += 5;
  if (goalText.includes("leads")) contentScore += 5;
  if (goalText.includes("inconsistent")) consistencyScore -= 15;
  if (goalText.includes("no growth")) growthPotentialScore += 10;
  if (goalText.includes("views")) visibilityScore -= 5;

  const clamp = (num) => Math.max(1, Math.min(100, Math.round(num)));

  visibilityScore = clamp(visibilityScore);
  contentScore = clamp(contentScore);
  consistencyScore = clamp(consistencyScore);
  engagementScore = clamp(engagementScore);
  growthPotentialScore = clamp(growthPotentialScore);

  const overallScore = clamp(
    visibilityScore * 0.2 +
      contentScore * 0.25 +
      consistencyScore * 0.15 +
      engagementScore * 0.25 +
      growthPotentialScore * 0.15
  );

  return {
    visibilityScore,
    contentScore,
    consistencyScore,
    engagementScore,
    growthPotentialScore,
    overallScore,
  };
}

function buildPrompt(order, insights, scores, scraperStatus, scraperError) {
  const {
    name = "User",
    page_url = "",
    goal = "",
    struggles = "",
    review_type = "",
  } = order;

  return `
You are a premium Facebook growth strategist.

This is a PAID audit report.
It must feel specific, tactical, premium, and clearly based on THIS user's page and goals.

STRICT RULES:
- Use the user's name at least 2 times.
- Mention their Facebook URL.
- Mention their goal.
- Mention their struggle.
- Never sound generic.
- Never say "based on limited data" unless absolutely necessary.
- If scraper data exists, use it as proof.
- If scraper data failed, still deliver a strong report using the intake data and scores.
- Make the report feel like a consultant wrote it.

USER INFO
Name: ${name}
Profile URL: ${page_url}
Goal: ${goal}
Struggles: ${struggles}
Review Type: ${review_type}

SCRAPER STATUS
Status: ${scraperStatus}
Error: ${scraperError || "None"}

PAGE INSIGHTS
Page Name: ${insights?.pageName || "Unknown"}
Followers: ${insights?.followers || 0}
Category: ${insights?.category || "Unknown"}
Intro: ${insights?.intro || "Unknown"}
Website: ${insights?.website || "None"}
Verified: ${insights?.verified ? "Yes" : "No"}
Posts Analyzed: ${insights?.postCountAnalyzed || 0}
Average Likes: ${insights?.avgLikes || 0}
Average Comments: ${insights?.avgComments || 0}
Average Shares: ${insights?.avgShares || 0}
Average Views: ${insights?.avgViews || 0}
Engagement Level: ${insights?.engagementLevel || "Unknown"}

SAMPLE POST TEXT
${insights?.samplePostText?.length ? insights.samplePostText.map((t, i) => `${i + 1}. ${t}`).join("\n") : "No scraped post samples available"}

SCORES
Overall Score: ${scores.overallScore}/100
Visibility Score: ${scores.visibilityScore}/100
Content Score: ${scores.contentScore}/100
Consistency Score: ${scores.consistencyScore}/100
Engagement Score: ${scores.engagementScore}/100
Growth Potential Score: ${scores.growthPotentialScore}/100

OUTPUT FORMAT:
1. Personalized Overview
2. What We Analyzed
3. Visibility Analysis
4. Engagement Analysis
5. Top 3 Growth Blockers
6. Top 3 Strengths
7. 7-Day Action Plan
8. 3 Specific Post Ideas
9. 30-Day Strategy Summary

The 7-Day Action Plan must be day-by-day:
Day 1:
Day 2:
Day 3:
Day 4:
Day 5:
Day 6:
Day 7:

The 3 post ideas must each contain:
- Hook
- What to say
- CTA

Write cleanly. Be direct. Be useful. No fluff.
`;
}

async function analyzeOrder(order) {
  const pageUrl = order.page_url || order.facebook_url || "";

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
  const scores = buildScores(order, insights);
  const prompt = buildPrompt(order, insights, scores, scraperStatus, scraperError);

  const response = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.7,
  });

  const reportText = response.choices?.[0]?.message?.content || "Report could not be generated.";

  return {
    reportText,
    scores,
    scraperStatus,
    scraperError,
    scraperInsights: insights,
  };
}

module.exports = { analyzeOrder };