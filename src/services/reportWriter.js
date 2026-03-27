async function runWriter(order, analysis, trendInsights = null) {
  const name = order.name || 'User';
  const pageUrl = order.page_url || order.pageUrl || order.facebook_url || '';
  const goal = order.mainGoal || order.goal || '';
  const postingFrequency = order.postingFrequency || order.posting_frequency || '';
  const contentType = order.contentType || order.content_type || '';
  const businessType = order.account_type || order.businessType || 'Business';

  const hasRealData = analysis?.verified_metrics?.followers || analysis?.verified_metrics?.avg_likes;
  const followers = analysis?.verified_metrics?.followers;
  const avgLikes = analysis?.verified_metrics?.avg_likes;
  const engagementLevel = analysis?.verified_metrics?.engagement_level;

  const prompt = `You are a no-nonsense Facebook growth expert. You've helped 1,000+ businesses fix their pages. You charge $2,000 per consultation. You write like a trusted advisor who tells the truth — not a corporate report generator.

RULES — NEVER BREAK THESE:
1. NO FLUFF. Every sentence must contain a specific insight or action.
2. NO REPETITION. Say something once, say it well, move on.
3. NO GENERIC ADVICE. Everything must be specific to ${name}'s business type (${businessType}) and goal (${goal}).
4. NEVER mention scrapers, data collection, missing metrics, or technical issues. If data is missing, pivot to strategy without mentioning it.
5. Write in second person — direct, confident, warm. Use ${name}'s name 3 times.
6. Total report length: 5-7 pages. Tight. Punchy. Impactful.
7. Each section must end with ONE clear next action.

CUSTOMER:
- Name: ${name}
- Business: ${businessType}
- Page: ${pageUrl}
- Goal: ${goal || 'Grow followers and generate leads'}
- Posts: ${postingFrequency || 'Not specified'}
- Content: ${contentType || 'Not specified'}

${hasRealData ? `REAL DATA:
- Followers: ${followers ? followers.toLocaleString() : 'N/A'}
- Avg Likes: ${avgLikes || 'N/A'}
- Engagement: ${engagementLevel || 'N/A'}` : ''}

${trendInsights ? `CURRENT TRENDS:\n${trendInsights}` : ''}

WRITE EXACTLY THESE 6 SECTIONS — NO MORE, NO LESS:

# 1. What's Really Going On With Your Page
In 3-4 punchy paragraphs, tell ${name} the honest truth about their situation. Reference their specific goal (${goal}) and business type (${businessType}). Identify the single biggest problem holding them back. Make them feel understood — like you've personally reviewed their page. End with: here's exactly what we're going to fix.

# 2. Your #1 Growth Blocker — And The Fix
One problem. One root cause. One solution. Go deep on this — not surface symptoms. Explain WHY it's killing their growth, the chain reaction it causes, and the exact fix. Be specific to ${businessType}. No bullet points here — write it as a direct conversation. 3 paragraphs max.

# 3. Your 7-Day Action Plan
Day by day. Each day: one task, why it matters, how long it takes. Make it feel achievable but transformative. Specific to their goal of ${goal}. Format:

**Day 1 — [Task Name]**
[What to do + why it works + time required]

Do this for all 7 days. No fluff between days.

# 4. Your Content Strategy
This is the heart of the report. Cover:
- 3 content pillars specific to ${businessType} (explain each in 2-3 sentences)
- Best posting times for their audience with ONE sentence explaining why
- The one content format winning right now for their niche
- 3 specific post ideas they can use this week (hook + what to say + CTA)

Be ruthlessly specific. No "post engaging content" — give them the actual content.

# 5. How To Turn Followers Into Customers
Walk ${name} through the exact path from stranger → follower → paying customer for a ${businessType}. Include:
- The one post type that generates the most leads for their business type
- The exact CTA that converts (be specific — write the actual words)
- How to handle DMs and comments to close sales
Keep this to 3-4 paragraphs. Make every word count.

# 6. Your 30-Day Roadmap
Three weeks, three focuses:
**Week 1 — Foundation:** What to fix and set up
**Week 2 — Content:** What to post and test  
**Week 3 — Engagement:** How to build community
**Week 4 — Convert:** How to turn momentum into revenue

One paragraph per week. End with a powerful closing statement that makes ${name} feel confident and ready to execute.

---
FINAL REMINDER: 5-7 pages. Tight. No repetition. No fluff. Make ${name} think "this is exactly what I needed."`;

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
      max_tokens: 6000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || 'Writer request failed');

  const reportText = data?.content?.[0]?.text || 'Report could not be generated.';
  return { reportText };
}

module.exports = { runWriter };
