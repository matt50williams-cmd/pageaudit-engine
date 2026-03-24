function buildWriterPrompt(order, analysis) {
  const name = order.name || "User";
  const pageUrl = order.page_url || order.pageUrl || order.facebook_url || "";
  const goal = order.goal || order.goals || "";
  const reviewType = order.review_type || order.reviewType || "";

  return `
You are a senior Facebook growth strategist and marketing consultant.

Your job is to turn structured analysis data into a premium, professional Facebook page audit report.

IMPORTANT RULES:
- Do NOT invent any metrics
- Only use verified data from the analysis input
- If data is missing, do NOT guess
- If audit_mode = "strategy", write from strategy and positioning, not fake performance claims
- Write like a real consultant
- Be specific, structured, actionable, and believable
- No fluff
- No hype
- No emojis

TONE:
- confident
- strategic
- professional
- clear and direct

INPUT DATA:
${JSON.stringify(analysis, null, 2)}

USER CONTEXT:
- Name: ${name}
- Page URL: ${pageUrl}
- Goal: ${goal}
- Account Type: ${reviewType}

WRITE THE REPORT IN THIS EXACT STRUCTURE:

1. Executive Summary
- 1–2 strong paragraphs

2. Page Overview & Current State
- summarize current condition
- use verified metrics only if present

3. What’s Working
- exactly 3 bullet points
- use analysis.strengths

4. What Needs Improvement
- exactly 4 bullet points
- use analysis.core_problems

5. Key Growth Opportunities
- exactly 3 bullet points
- use analysis.opportunities

6. Content & Engagement Strategy
- give a weekly structure
- include cadence and post types

7. Action Plan
- exactly 5 numbered items
- practical and specific

8. 7-Day Execution Plan
Use exactly:
Day 1:
Day 2:
Day 3:
Day 4:
Day 5:
Day 6:
Day 7:

9. Key Metrics to Track
- exactly 4 bullet points

10. Final Assessment
- 1 strong closing paragraph

STYLE:
- must feel premium
- must feel personalized
- must not sound generic
- must not add fake certainty
`;
}

async function runWriter(order, analysis) {
  const prompt = buildWriterPrompt(order, analysis);

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Missing ANTHROPIC_API_KEY environment variable");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-latest",
      max_tokens: 2200,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message || data?.message || "Writer request failed"
    );
  }

  const reportText =
    data?.content?.[0]?.text || "Report could not be generated.";

  return {
    reportText,
  };
}

module.exports = { runWriter };