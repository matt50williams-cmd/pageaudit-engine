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

  const avgLikes = posts.length ? Math.round(totalLikes / posts.length) : 0;
  const avgComments = posts.length ? Math.round(totalComments / posts.length) : 0;
  const avgShares = posts.length ? Math.round(totalShares / posts.length) : 0;
  const avgViews = posts.length ? Math.round(totalViews / posts.length) : 0;

  let engagementLevel = "LOW";
  if (avgLikes > 50 || avgComments > 10) engagementLevel = "MEDIUM";
  if (avgLikes > 200 || avgComments > 30) engagementLevel = "HIGH";

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
  const goalText = `${order.goal || ""} ${order.goals || ""} ${order.struggles || ""} ${order.postingFrequency || ""}`.toLowerCase();

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
  if (goalText.includes("lead")) contentScore += 5;
  if (goalText.includes("inconsistent")) consistencyScore -= 15;
  if (goalText.includes("rarely")) consistencyScore -= 15;
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
  const name = order.name || "User";
  const pageUrl = order.page_url || order.pageUrl || order.facebook_url || "";
  const goal = order.goal || order.goals || "";
  const struggles = order.struggles || "";
  const reviewType = order.review_type || order.reviewType || "";
  const postingFrequency = order.postingFrequency || order.posting_frequency || "";
  const contentType = order.contentType || order.content_type || "";

  return `
You are a HIGH-LEVEL Facebook growth strategist.

This is a PAID audit report.
It must feel PERSONAL, SPECIFIC, DATA-DRIVEN, and PREMIUM.

STRICT RULES:
- Use the user's name "${name}" at least 2 times.
- Mention their exact Facebook profile URL: ${pageUrl}
- Mention their actual goal: ${goal}
- Mention their struggle if provided: ${struggles || "Not provided"}
- Use real numbers from the scraped data if available.
- DO NOT write generic filler like "your page shows potential."
- DO NOT give vague advice.
- If the engagement is low, explain that clearly using the numbers.
- Be direct and useful like a paid consultant.

IMPORTANT:
If data shows a gap between followers and engagement, call it out directly.
Example:
"You have 13,000 followers but only 6 average likes per post. That tells us your current content is not creating enough engagement signals for Facebook to keep pushing it."

USER DATA
Name: ${name}
Profile URL: ${pageUrl}
Goal: ${goal}
Struggles: ${struggles || "Not provided"}
Review Type: ${reviewType}
Posting Frequency: ${postingFrequency || "Not provided"}
Content Type: ${contentType || "Not provided"}

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

TASK:
Write the report in these exact sections:

1. Personalized Overview
- Speak directly to ${name}
- Mention the goal
- Mention the Facebook URL
- Explain what is happening on this page in plain English

2. What We Analyzed
- Bullet-style explanation in paragraph form of what was analyzed:
  profile setup, visibility, engagement signals, content patterns, consistency

3. Visibility Analysis
- Explain whether visibility/discoverability is helping or hurting growth

4. Engagement Analysis
- Use the real numbers
- Explain what they mean
- If the page has a lot of followers but weak engagement, say that directly

5. Top 3 Growth Blockers
- Give 3 specific blockers
- They must feel real and tied to this user's data and goals

6. Top 3 Strengths
- Give 3 genuine positives
- If data is limited, still find legitimate positives

7. 7-Day Action Plan
Use this exact format:
Day 1:
Day 2:
Day 3:
Day 4:
Day 5:
Day 6:
Day 7:

Each day must be specific and tactical.

8. 3 Specific Post Ideas
Use this exact format:
Post Idea 1:
Hook:
What to say:
CTA:

Post Idea 2:
Hook:
What to say:
CTA:

Post Idea 3:
Hook:
What to say:
CTA:

9. 30-Day Strategy Summary
- Explain what ${name} should focus on over the next 30 days
- Keep it strong and specific

FINAL RULES:
- No fluff
- No generic filler
- No repeating the same idea
- Make it feel worth paying for
`;
}

async function analyzeOrder(order) {
  const pageUrl = order.page_url || order.pageUrl || order.facebook_url || "";

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

  const reportText =
    response.choices?.[0]?.message?.content || "Report could not be generated.";

  return {
    reportText,
    scores,
    scraperStatus,
    scraperError,
    scraperInsights: insights,
  };
}

module.exports = { analyzeOrder };S