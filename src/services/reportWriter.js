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
  const avgComments = analysis?.verified_metrics?.avg_comments;
  const engagementLevel = analysis?.verified_metrics?.engagement_level;
  const coreProblems = analysis?.core_problems || [];
  const strengths = analysis?.strengths || [];
  const opportunities = analysis?.opportunities || [];

  const prompt = `You are the world's top Facebook growth consultant. You have personally helped over 1,000 businesses transform their Facebook presence into revenue-generating machines. Your clients include Fortune 500 companies, local businesses, and everything in between. You charge $2,000 for a single consultation. Today you are writing a report for ${name}.

This customer paid $39.99. Your job is to make them feel like they got $2,000 worth of value. Every sentence must earn its place. No filler. No generic advice. No corporate speak.

CUSTOMER PROFILE:
- Name: ${name}
- Business Type: ${businessType}
- Facebook Page: ${pageUrl}
- Primary Goal: ${goal || 'Grow followers and generate leads'}
- Current Posting Frequency: ${postingFrequency || 'Not specified'}
- Main Content Type: ${contentType || 'Not specified'}

${hasRealData ? `REAL PAGE DATA (use these exact numbers):
- Followers: ${followers ? followers.toLocaleString() : 'Not available'}
- Average Likes per Post: ${avgLikes || 'Not available'}
- Average Comments per Post: ${avgComments || 'Not available'}
- Engagement Level: ${engagementLevel || 'Not available'}` : `DATA NOTE: Real page metrics were not available for this audit. Focus entirely on strategy based on their goals and business type. Do NOT mention missing data to the customer — just deliver an exceptional strategy.`}

AI ANALYSIS RESULTS:
- Core Problems Identified: ${coreProblems.join(', ') || 'See analysis below'}
- Key Strengths: ${strengths.join(', ') || 'To be identified'}
- Growth Opportunities: ${opportunities.join(', ') || 'See recommendations'}

${trendInsights ? `CURRENT FACEBOOK TRENDS (use these to make recommendations timely and relevant):
${trendInsights}` : ''}

WRITING RULES — NEVER BREAK THESE:
1. Write in second person — talk directly to ${name}, use their name at least 4 times
2. Every recommendation must be SPECIFIC to their business type (${businessType}) and goal (${goal})
3. Never say "consider" or "you might want to" — be direct and authoritative
4. No bullet point lists without explanation — every point needs context
5. Reference their specific Facebook URL when relevant
6. If you mention a posting time, explain WHY that time works
7. Make every section feel like it was written ONLY for ${name} — not a template
8. Use real psychology — loss aversion, social proof, urgency
9. End every section with a clear next action
10. The report must be comprehensive — minimum 10 sections, each with substantial content

REPORT STRUCTURE — WRITE ALL OF THESE IN FULL:

# Facebook Growth Audit Report
## Prepared exclusively for ${name} | ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}

---

# 1. Executive Summary & Honest Assessment
Start with a powerful opening that shows you understand their specific situation. 
- What is their page's current reality? Be honest but not harsh.
- What is the single biggest opportunity they are missing RIGHT NOW?
- What will their page look like in 90 days if they follow this plan?
- End with an energizing statement that makes them want to keep reading.
Write at least 4 substantial paragraphs.

# 2. Your Page Score Breakdown
Analyze and explain each score area in depth:
- Overall Score: What it means for their business
- Visibility Score: Why people can or can't find their page
- Content Score: What their content is doing right and wrong
- Engagement Score: The real reason people are or aren't interacting
- Growth Score: Their trajectory and what's holding it back
For each score, explain: what it means, why it matters, and what moves the needle.
Write 2-3 paragraphs per score area.

# 3. The Real Reason Your Page Isn't Growing (Your #1 Problem)
This is the most important section. Identify the ROOT CAUSE of their struggle.
- Go deeper than surface symptoms — find the underlying issue
- Use specific language about their business type (${businessType})
- Explain the chain reaction: Problem → Effect → Business Impact
- Make them feel understood — like you've seen their page personally
- Be direct: "Here is exactly what is happening and why"
Write at least 5 paragraphs. This should feel like a breakthrough moment.

# 4. What Your Competitors Are Doing That You're Not
- Describe what successful ${businessType} pages are doing RIGHT NOW
- What content formats are winning in their niche
- What posting strategies are generating the most reach
- What the algorithm rewards for their specific business type
- 3 specific tactics their competitors use that they should steal immediately
Write at least 4 paragraphs with specific actionable examples.

# 5. Your 90-Day Transformation Plan
Break this into three 30-day phases:

PHASE 1 — Foundation (Days 1-30):
- Exact page optimizations to make this week
- Profile setup, about section, cover photo strategy
- First content pillars to establish
- Milestone: What success looks like at day 30

PHASE 2 — Momentum (Days 31-60):
- Content escalation strategy
- Community building tactics
- Engagement multiplication techniques
- Milestone: What success looks like at day 60

PHASE 3 — Scale (Days 61-90):
- What to double down on based on what's working
- How to start generating leads consistently
- Building toward their specific goal (${goal})
- Milestone: What success looks like at day 90

Write at least 2 paragraphs per phase.

# 6. Your Custom 7-Day Quick Start Action Plan
Day-by-day specific tasks. Each day must include:
- The exact task (not vague — specific)
- Why this task matters
- How long it will take
- What result to expect

DAY 1: Page Audit & Foundation Fix
DAY 2: Content Pillar Setup
DAY 3: First Optimized Post
DAY 4: Community Engagement Blitz
DAY 5: Content Creation Day
DAY 6: Collaboration Outreach
DAY 7: Review, Analyze & Plan Week 2

Make each day feel achievable but impactful.

# 7. Your Custom Content Strategy
This must be specific to ${businessType} and ${goal}:

CONTENT PILLARS (3-4 pillars that will work for their specific business):
For each pillar explain: what it is, why it works for their audience, examples

WEEKLY POSTING CALENDAR:
Full Monday-Sunday schedule with:
- Content type for each day
- Best posting time (with explanation of WHY)
- Caption style and length
- CTA for each post type
- Hashtag strategy

CONTENT FORMATS THAT WIN RIGHT NOW:
- Which formats the algorithm is rewarding in 2025
- Video vs image vs text for their business type
- Reel strategy if applicable
- Story strategy

Write this section in extensive detail — at least 6 paragraphs.

# 8. The Engagement Acceleration System
This is your secret weapon section. Include:
- The first 30-minute engagement window and why it's critical
- The comment strategy that multiplies reach
- How to turn followers into a community
- The exact response framework for comments and messages
- Cross-platform amplification without spending money
- The collaboration strategy for their niche
Write at least 5 paragraphs with specific scripts and examples.

# 9. Lead Generation Blueprint
How to turn their Facebook page into an actual revenue generator:
- The content-to-customer journey for ${businessType}
- How to move followers from passive to active buyers
- The Facebook funnel specific to their goal (${goal})
- 3 specific post formats proven to generate leads
- How to use Facebook's free tools to capture leads
- The follow-up strategy once someone engages
Write at least 4 paragraphs with specific examples.

# 10. Advanced Growth Tactics (Your Competitive Edge)
10 specific tactics that most page owners don't know:
For each tactic: what it is, how to implement it, expected result.
Make these feel like insider secrets — things they wouldn't find in a Google search.
Write 2-3 sentences minimum per tactic.

# 11. What to Expect — Realistic Timeline
Be honest about growth timelines:
- Week 1-2: What they'll see (and what they won't)
- Month 1: Realistic expectations with this plan
- Month 2-3: Where compound growth kicks in
- Month 6: What's possible if they stay consistent
- The mindset shift required to succeed

Include a section on common mistakes to avoid that derail growth.
Write at least 4 paragraphs.

# 12. Your Personal Action Checklist
A prioritized list of everything they should do, in order:
- This week (5 things)
- This month (10 things)
- Ongoing (5 habits to build)

Make this feel like a gift — something they can print out and check off.

---

FINAL NOTE TO CLAUDE:
This report is the product. It's what ${name} paid for. Make it extraordinary. 
Make it specific. Make it personal. Make it worth $2,000.
${name} should finish reading this and think: "I need to share this with every business owner I know."
That reaction = word of mouth = PageAudit Pro grows.
Write with that responsibility in mind.`;

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
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || 'Writer request failed');

  const reportText = data?.content?.[0]?.text || 'Report could not be generated.';
  return { reportText };
}

module.exports = { runWriter };