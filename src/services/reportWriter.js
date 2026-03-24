function buildWriterPrompt(order, analysis) {
  const name = order.name || "User";
  const pageUrl = order.page_url || order.pageUrl || order.facebook_url || "";
  const goal = order.mainGoal || order.goal || "";
  const reviewType = order.review_type || order.reviewType || "";
  const postingFrequency =
    order.postingFrequency || order.posting_frequency || "";
  const contentType = order.contentType || order.content_type || "";

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
- Scraped page data and analyzer findings are the primary source of truth
- Intake answers are secondary context only
- Do not build the report mainly from the questionnaire
- If scraped data exists, prioritize it over intake answers
- If scraped data is limited, use intake answers only to guide examples and recommendations
- Do not reference business goals unless they are explicitly present in the analysis
- Use the user's selected goal, posting frequency, and content type as supporting context
- Tie recommendations to the user's goal when that goal is provided
- If postingFrequency is provided, give a realistic next-step cadence based on it
- If contentType is provided, tailor examples to that format
- Do not let the questionnaire replace scraped data or analyzer findings

USER:
Name: ${name}
Page: ${pageUrl}
Type: ${reviewType}
Main Goal: ${goal || "Not provided"}
Posting Frequency: ${postingFrequency || "Not provided"}
Main Content Type: ${contentType || "Not provided"}

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

Important:
- Use the user's goal, posting frequency, and content type to tailor this weekly plan
- Give specific cadence recommendations such as 3x per week, 4x per week, daily, etc.
- Make the plan feel connected to what they are trying to achieve

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

Important:
- Tailor these ideas to the user's selected goal
- Tailor these ideas to the user's selected main content type when possible

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