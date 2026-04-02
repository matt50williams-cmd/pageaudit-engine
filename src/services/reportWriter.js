async function runWriter(order, analysis, trendInsights = null) {
  const name = order.name || 'User';
  const pageUrl = order.page_url || order.pageUrl || order.facebook_url || '';
  const goal = order.mainGoal || order.goal || '';
  const postingFrequency = order.postingFrequency || order.posting_frequency || '';
  const contentType = order.contentType || order.content_type || '';
  const detectedBusinessType = analysis?.detected_business_type || null;
  const detectedServices = analysis?.detected_services || null;
  const businessType = detectedBusinessType || order.account_type || order.businessType || 'Business';
  const city = order.city || '';
  const businessName = order.businessName || order.business_name || name;
  const facebookNotFound = order.facebookNotFound || false;
  const hasDetectedType = detectedBusinessType && detectedBusinessType !== 'Business';
  const typeDesc = hasDetectedType ? businessType.toLowerCase() : 'business';

  const hasRealData = analysis?.verified_metrics?.followers || analysis?.verified_metrics?.avg_likes;
  const followers = analysis?.verified_metrics?.followers;
  const avgLikes = analysis?.verified_metrics?.avg_likes;
  const engagementLevel = analysis?.verified_metrics?.engagement_level;

  // Filter out technical errors from core_problems — never expose these to customers
  const technicalPatterns = /fail|error|scraper|scrape|parsing|fallback|fetch|timeout|missing.*url|check.*data|not.*attempted/i;
  const cleanProblems = (analysis?.core_problems || []).filter(p => !technicalPatterns.test(p));
  const cleanStrengths = (analysis?.strengths || []).filter(p => !technicalPatterns.test(p));
  const cleanOpportunities = (analysis?.opportunities || []).filter(p => !technicalPatterns.test(p));

  // Derive a real growth blocker from form data if analyzer didn't produce one
  function deriveGrowthBlocker() {
    if (cleanProblems.length > 0) return cleanProblems[0];
    if (postingFrequency === 'Rarely or never') return 'inconsistent posting — Facebook\'s algorithm stops showing your page when you go quiet';
    if (postingFrequency === 'Weekly') return 'posting too infrequently to stay in your audience\'s feed';
    if (contentType === 'Text posts') return 'relying on text-only posts which get the lowest reach on Facebook';
    if (facebookNotFound) return 'low visibility — potential customers can\'t find your page when they search';
    return 'a lack of strategic focus in your content';
  }

  const section1 = facebookNotFound
    ? `# 1. Your #1 Problem: Nobody Can Find You

${businessName} has a critical visibility problem. When we searched for your Facebook page, we couldn't find it — and if our technology can't find it, your customers in ${city || 'your area'} definitely can't either. Every day this goes unfixed, potential customers are finding your competitors instead.

Here's exactly what's happening: when someone in ${city || 'your area'} searches Facebook for "${businessName}" or a ${typeDesc} near them, your page either doesn't show up or is buried so deep nobody sees it. This is the single biggest thing holding your business back on Facebook right now.

**Here's your step-by-step fix to make ${businessName} discoverable on Facebook:**

1. **Go to your Facebook Page** → Settings → Page Info
2. **Page Name**: Make sure it says exactly "${businessName}" — no abbreviations, no extra words
3. **Category**: Choose the most specific category for your ${typeDesc} (e.g., "Local Service" or your exact industry)
4. **Address**: Enter your full business address in ${city || 'your city'}. This is CRITICAL for local search.
5. **Phone Number**: Add your business phone — Facebook uses this to verify you're a real business
6. **Website**: Add your website URL${order.website ? ` (${order.website})` : ''}
7. **Hours**: Fill out every day, even if you're closed on weekends — incomplete hours hurt your ranking
8. **About Section**: Write 2-3 sentences that include "${businessName}", "${city || 'your city'}", and what you do. Example: "${businessName} is a trusted ${typeDesc} serving ${city || 'the local area'}. We specialize in [your main service]. Contact us today for [your offer]."
9. **Profile Photo**: Use your logo or a professional headshot — NOT a blurry photo or a stock image
10. **Cover Photo**: Use a branded image that shows what ${businessName} does — include your phone number or website on the cover image

Do ALL 10 of these before anything else in this report. Once your page is findable, everything else we recommend will actually work.`
    : `# 1. What's Really Going On With ${businessName}'s Page

${name}, here's the honest truth about where ${businessName} stands on Facebook right now.${city ? ` As a ${typeDesc} in ${city}, you're competing with every other local business for attention in the feed.` : ''} Your stated goal is to ${goal || 'grow your Facebook presence'}, and ${hasRealData ? `with ${followers ? followers.toLocaleString() + ' followers' : 'your current audience'} and ${engagementLevel || 'moderate'} engagement, you have a foundation to build on` : `we need to build a strategy that gets you there`}.

${postingFrequency === 'Rarely or never' ? `The biggest issue: you're barely posting. Facebook's algorithm forgets pages that go quiet — and so do your customers in ${city || 'your area'}. ${businessName} needs to exist in people's feeds consistently before any other strategy will work.` : postingFrequency === 'Daily' ? `You're posting daily, which is great for staying visible. But for ${businessName}, the question isn't frequency — it's whether each post is actually driving toward your goal of ${goal || 'growth'}. We found opportunities to make every post work harder.` : `Your current posting schedule of "${postingFrequency}" ${postingFrequency === 'Weekly' ? 'is a start, but' : 'shows effort, but'} ${businessName} needs more strategic consistency to ${goal || 'grow'} in ${city || 'your market'}.`}

The single biggest thing holding ${businessName} back is ${deriveGrowthBlocker()}. Here's exactly what we're going to fix.`;

  const prompt = `You are a no-nonsense Facebook growth expert who has helped 1,000+ local businesses fix their pages. You charge $2,000 per consultation. You write like a trusted advisor who tells the truth — not a corporate report generator.

ABSOLUTE RULES — BREAK ANY OF THESE AND THE REPORT IS WORTHLESS:
1. Every single recommendation MUST use "${businessName}" by name and reference "${city || 'their local area'}" specifically. NO generic advice. If you write "your business" instead of "${businessName}" you have failed.
2. Every example post, CTA, and script must be written AS IF you are the social media manager for ${businessName}. Use their actual name, city, and business type.
3. NO FLUFF. Every sentence must contain a specific insight or action for ${businessName}.
4. NO REPETITION. Say something once, say it well, move on.
5. NEVER mention scrapers, data collection, missing metrics, technical issues, API errors, fetch failures, or anything about how we gathered data. If data is limited, work with what you have — never say "we couldn't find" or "our system failed." The customer should never know how this report was generated.
6. Write in second person — direct, confident, warm. Use "${name}" by name 3-4 times throughout.
7. Total report length: 5-7 pages. Tight. Punchy. Impactful.
8. Each section must end with ONE clear next action for ${businessName}.
9. NEVER ASSUME THE BUSINESS TYPE, INDUSTRY, OR SERVICES. Only use what is explicitly provided in the customer profile below. If "Detected Business Type" says "Not detected" or "Business", keep your language general — say "${businessName}" instead of guessing they are a restaurant, salon, contractor, etc. Do NOT invent services, products, or industry-specific advice unless the detected info confirms it. Getting the business type wrong destroys credibility.

CUSTOMER PROFILE:
- Owner Name: ${name}
- Business Name: ${businessName}
- Detected Business Type: ${detectedBusinessType || 'Not detected — do NOT guess'}
- Detected Services: ${detectedServices || 'Not detected — do NOT guess'}
- User-Reported Account Type: ${order.account_type || 'Not specified'}
- City: ${city || 'Not specified'}
- Page URL: ${pageUrl || 'Not found'}
- Website: ${order.website || 'Not provided'}
- Goal: ${goal || 'Grow followers and generate leads'}
- Current Posting: ${postingFrequency || 'Not specified'}
- Content Preference: ${contentType || 'Not specified'}
- Facebook Page Found: ${facebookNotFound ? 'NO — page was not discoverable' : 'Yes'}

${hasRealData ? `VERIFIED DATA:
- Followers: ${followers ? followers.toLocaleString() : 'N/A'}
- Avg Likes per Post: ${avgLikes || 'N/A'}
- Engagement Level: ${engagementLevel || 'N/A'}` : ''}

${cleanProblems.length ? `KEY PROBLEMS IDENTIFIED: ${cleanProblems.join('; ')}` : ''}
${cleanStrengths.length ? `STRENGTHS: ${cleanStrengths.join('; ')}` : ''}
${cleanOpportunities.length ? `OPPORTUNITIES: ${cleanOpportunities.join('; ')}` : ''}

${trendInsights ? `CURRENT TRENDS:\n${trendInsights}` : ''}

SECTION 1 IS PRE-WRITTEN — DO NOT WRITE SECTION 1. Start your response with Section 2.

WRITE EXACTLY THESE SECTIONS (2 through 7):

# 2. ${businessName}'s #1 Growth Blocker — And The Fix
One problem. One root cause. One solution. Go deep — not surface symptoms. Explain WHY this specific problem is killing ${businessName}'s growth in ${city || 'their market'}, the chain reaction it causes, and the exact fix. Include a real example: "For a ${typeDesc} like ${businessName} in ${city || 'your area'}, this means..." 3 paragraphs max. No bullet points — write it as a direct conversation.

# 3. ${businessName}'s 7-Day Action Plan
${goal.includes('lead') || goal.toLowerCase().includes('lead') ? `Every single day must focus on LEAD GENERATION for ${businessName}. No brand awareness tasks — every action should directly generate inquiries, DMs, or calls for ${businessName} in ${city || 'the area'}.` : goal.includes('authority') || goal.toLowerCase().includes('authority') ? `Every single day must focus on BUILDING AUTHORITY for ${businessName} in ${city || 'the area'}. Every action should position ${name} as the go-to expert ${typeDesc} that people trust and recommend.` : goal.includes('engagement') || goal.toLowerCase().includes('engagement') ? `Every single day must focus on DRIVING ENGAGEMENT for ${businessName}. Every action should get people commenting, sharing, and interacting with ${businessName}'s posts in ${city || 'the area'}.` : `Every single day must tie directly back to ${businessName}'s goal: ${goal || 'growing their Facebook presence'}. No generic tasks.`}

Format each day like this:
**Day 1 — [Task Name]**
[What ${businessName} should do + why it works for a ${typeDesc} in ${city || 'their area'} + time required]

Include the actual post copy or script ${businessName} should use for at least 3 of the 7 days. Write it ready to copy and paste.

# 4. ${businessName}'s Content Strategy
This is the heart of the report. Cover:
- **3 Content Pillars** specific to ${businessName} as a ${typeDesc} in ${city || 'their area'}. Explain each in 2-3 sentences with an example.
- **Best Posting Times** for ${businessName}'s audience in ${city || 'their timezone'} with ONE sentence explaining why.
- **The #1 Content Format** winning right now for ${typeDesc} businesses — explain why ${contentType ? `their current preference for "${contentType}" ${contentType === 'Videos' ? 'is smart' : 'should evolve'}` : 'this format matters'}.

Then write **3 COMPLETE EXAMPLE POSTS** ready for ${businessName} to copy and paste:

**Post 1 — [Pillar Name]**
Hook: [The first line that stops the scroll — must mention ${businessName} or ${city || 'the local area'}]
Body: [2-3 sentences]
CTA: [Exact call-to-action with ${businessName}'s name]

**Post 2 — [Pillar Name]**
[Same format — different pillar, must reference ${city || 'local area'}]

**Post 3 — [Pillar Name]**
[Same format — different pillar, tied to their goal of ${goal || 'growth'}]

# 5. How ${businessName} Turns Followers Into Customers
Walk ${name} through the exact path: stranger → follower → paying customer for ${businessName} in ${city || 'their area'}. Include:
- The one post type that generates the most leads for a ${typeDesc}
- The exact CTA that converts — write the actual words ${businessName} should use. Example: "DM us '${city || 'FREE'}' to get..."
- A word-for-word DM script ${businessName} can use when someone responds
- How to handle comments to close sales — give a real example response
Keep this to 3-4 paragraphs. Make every word count.

# 6. ${businessName}'s 30-Day Roadmap
Four weeks, four focuses:
**Week 1 — Foundation:** What ${businessName} needs to fix and set up first
**Week 2 — Content:** What to post and test — specific to ${typeDesc} in ${city || 'their area'}
**Week 3 — Engagement:** How to build community around ${businessName}
**Week 4 — Convert:** How to turn momentum into revenue for ${businessName}

One paragraph per week with specific actions. End with a powerful closing statement that makes ${name} feel confident and ready to execute.

# 7. ${businessName}'s Facebook Visibility Score
Grade ${businessName} on these 4 factors. Give each a score out of 25 (total out of 100) and a specific one-line fix:

**Profile Completeness: __/25**
${facebookNotFound ? 'Score this LOW (5-10) since the page was not discoverable.' : 'Score based on what we know about their page setup.'}
Fix: [Exact field or setting ${businessName} needs to update]

**Posting Consistency: __/25**
Based on their current frequency of "${postingFrequency || 'unknown'}".
Fix: [Exact posting schedule ${businessName} should follow]

**Engagement Rate: __/25**
${hasRealData ? `Based on ${avgLikes || 0} avg likes and ${engagementLevel || 'unknown'} engagement.` : 'Estimated based on available signals.'}
Fix: [One specific tactic to boost ${businessName}'s engagement]

**Findability: __/25**
${facebookNotFound ? 'Score this 0-5. The page is very hard for customers to find on Facebook.' : 'Score based on how easily customers can find the page on Facebook.'}
Fix: [Exact step to make ${businessName} easier to find in ${city || 'local'} Facebook search]

**TOTAL VISIBILITY SCORE: __/100**
[One sentence summary of where ${businessName} stands and what to fix first]

---
FINAL REMINDER: 5-7 pages. Every sentence must reference ${businessName}, ${city || 'their area'}, or their specific situation. NO generic advice. Make ${name} think "this person actually looked at my business."`;

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

  const aiText = data?.content?.[0]?.text || '';
  const reportText = section1 + '\n\n' + aiText;
  return { reportText };
}

module.exports = { runWriter };
