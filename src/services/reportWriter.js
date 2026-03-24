function buildWriterPrompt(order, analysis) {
  const name = order.name || "User";
  const pageUrl = order.page_url || order.pageUrl || order.facebook_url || "";
  const goal = order.goal || order.goals || "";
  const reviewType = order.review_type || order.reviewType || "";

  return `
You are a senior Facebook growth strategist.

Your job is to create a high-value, actionable Facebook audit that feels like a paid consultant report.

STRICT RULES:
- Do NOT invent metrics
- Only use real data from analysis
- If data is missing, shift to strategy, not guessing
- Be specific, practical, and direct
- No generic advice
- No fluff

USER:
Name: ${name}
Page: ${pageUrl}
Goal: ${goal}
Type: ${reviewType}

ANALYSIS:
${JSON.stringify(analysis, null, 2)}

WRITE THE REPORT USING THIS STRUCTURE:

1. Executive Summary
Explain what is really happening in plain English.
Call out the main problem clearly.

2. What’s Actually Holding You Back
List 3 to 4 specific problems.
Explain why they hurt growth.

3. What You Should Do Instead
Explain the strategic shift needed.
Be direct.

4. Weekly Content Plan
Give a full weekly plan like this:

MONDAY – Authority Post
Example:
“Most Christians do not struggle with belief. They struggle with boldness.”
CTA:
“Agree or disagree?”

TUESDAY – Engagement Post
Example:
“What is harder right now: staying consistent in faith or standing bold in public?”

WEDNESDAY – Video
Example:
“If your faith is not costing you something, it might not be real.”

THURSDAY – Story Post
Example:
“Here is why we started this movement...”

FRIDAY – Bold Statement
Example:
“The world does not need quieter Christians. It needs stronger ones.”

5. 7-Day Action Plan

Day 1:
Fix bio and pinned post

Day 2:
Post authority content

Day 3:
Post short-form video

Day 4:
Post engagement post

Day 5:
Post story content

Day 6:
Post another video

Day 7:
Review what worked and repeat top performers

6. 3 High-Performing Post Ideas

Content Idea 1:
Hook:
What to say:
CTA:

Content Idea 2:
Hook:
What to say:
CTA:

Content Idea 3:
Hook:
What to say:
CTA:

7. Growth Tactics
Give specific tactics like:
- reply to every comment
- pin top post
- reuse best content
- use comment prompts
- create more shareable posts

8. Final Strategy
Explain what happens if they follow this.
Give realistic expectations.

STYLE:
- Strong
- Clear
- Direct
- Feels like a real expert
- Not robotic
- Not generic

GOAL:
The user should feel:
“I know exactly what to do now.”
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