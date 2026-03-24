const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function buildWriterPrompt(order, analysis) {
  const name = order.name || "User";
  const pageUrl = order.page_url || order.pageUrl || order.facebook_url || "";
  const goal = order.goal || order.goals || "";
  const reviewType = order.review_type || order.reviewType || "";

  return `
You are a premium Facebook growth strategist.

Your job is to turn structured analysis JSON into a high-value written audit report.

IMPORTANT RULES:
1. You must ONLY use the facts in the analysis JSON.
2. Never invent follower counts, engagement metrics, or page performance numbers.
3. If a metric is null, do not mention it.
4. If audit_mode = "strategy", write a strategy-based audit and do not mention missing data repeatedly.
5. If audit_mode = "data", you may reference verified metrics from analysis.verified_metrics.
6. Do not use generic filler like:
   - "your page shows potential"
   - "post more consistently"
   - "focus on engagement"
7. Be specific, direct, and useful.
8. Make it feel like a paid consultant wrote it.

USER CONTEXT:
- Name: ${name}
- Page URL: ${pageUrl}
- Goal: ${goal}
- Account Type: ${reviewType}

ANALYSIS JSON:
${JSON.stringify(analysis, null, 2)}

WRITE THE REPORT IN THIS EXACT STRUCTURE:

1. Personalized Overview
- 1 strong paragraph
- speak directly to ${name}
- mention the goal
- if audit_mode = data, reference only verified metrics
- if audit_mode = strategy, focus on strategy and growth direction

2. What We Analyzed
- short section
- explain what was reviewed using the analysis JSON
- no bullets required, but make it readable

3. Visibility / Positioning Analysis
- explain how the page is or is not positioned for growth

4. Content & Consistency Analysis
- explain how posting habits/content approach affect growth

5. Top 3 Growth Blockers
- exactly 3 numbered items
- based only on analysis.core_problems

6. Top 3 Strengths
- exactly 3 numbered items
- based only on analysis.strengths

7. Immediate Growth Moves
- exactly 5 numbered actions
- practical, high-impact, specific

8. Your 7-Day Action Plan
Use this exact format:
Day 1:
Day 2:
Day 3:
Day 4:
Day 5:
Day 6:
Day 7:

9. 3 Content Ideas
Use this exact format:
Content Idea 1:
Hook:
What to post:
CTA:

Content Idea 2:
Hook:
What to post:
CTA:

Content Idea 3:
Hook:
What to post:
CTA:

10. 30-Day Strategy Summary
- 1 strong paragraph
- clear growth direction
- no fluff

STYLE:
- premium
- strategic
- direct
- clear
- believable
- no fake certainty
`;
}

async function runWriter(order, analysis) {
  const prompt = buildWriterPrompt(order, analysis);

  const response = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.6,
  });

  const reportText =
    response.choices?.[0]?.message?.content || "Report could not be generated.";

  return {
    reportText,
  };
}

module.exports = { runWriter };