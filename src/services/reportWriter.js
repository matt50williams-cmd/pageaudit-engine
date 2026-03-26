async function runWriter(order, analysis) {
  const name = order.name || 'User';
  const pageUrl = order.page_url || order.pageUrl || order.facebook_url || '';
  const goal = order.mainGoal || order.goal || '';
  const postingFrequency = order.postingFrequency || order.posting_frequency || '';
  const contentType = order.contentType || order.content_type || '';

  const prompt = `You are a senior Facebook growth strategist who has helped 500+ businesses scale their Facebook presence.

Your job is to create a high-value, actionable Facebook audit that feels like a $500 consultant report. The customer paid $39.99 — make them feel like they got a steal.

STRICT RULES:
- Do NOT invent metrics. Only use real data from analysis.
- If data is missing, shift to strategy, not guessing.
- Be specific, practical, and direct. No generic advice. No fluff.
- If scraped data exists, prioritize it over intake answers.

USER:
Name: ${name}
Page: ${pageUrl}
Main Goal: ${goal || 'Not provided'}
Posting Frequency: ${postingFrequency || 'Not provided'}
Main Content Type: ${contentType || 'Not provided'}

ANALYSIS:
${JSON.stringify(analysis, null, 2)}

WRITE THE REPORT USING THIS STRUCTURE:

# 1. Executive Summary
Explain what is really happening with their page in plain English. Be honest but encouraging.
Call out the #1 problem clearly. Reference real data if available.

# 2. What's Actually Holding You Back
List 3-4 specific problems. For each: what it is, why it hurts growth, severity (critical/moderate/minor).

# 3. What You Should Do Instead
The strategic shift needed. Give them the one key mindset change.

# 4. Weekly Content Plan
Full 7-day calendar Monday-Sunday. Each day: what to post, why it works, CTA.

# 5. 7-Day Quick-Start Action Plan
Day-by-day tasks with exact steps they can start today.

# 6. 5 High-Performing Post Ideas
For each: Hook, Body, CTA, Best format, Best time to post.

# 7. Growth Tactics
8-10 specific actionable tactics. Not generic advice.

# 8. 30-Day Growth Roadmap
Week 1-4 with specific milestones.

# 9. Final Strategy & What to Expect
Realistic expectations: Week 1-2, Month 1, Month 2-3.
Encouraging but honest closing statement.

Use ${name}'s name at least twice.
Write like a real expert who actually cares.
The customer should think: "This was worth way more than $39.99."`;

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
  if (!response.ok) throw new Error(data?.error?.message || 'Writer request failed');

  const reportText = data?.content?.[0]?.text || 'Report could not be generated.';
  return { reportText };
}

module.exports = { runWriter };