const axios = require("axios");

function buildWriterPrompt(order, analysis) {
  return `
You are a senior Facebook growth strategist and marketing consultant.

Your job is to turn structured analysis data into a premium, professional Facebook page audit report.

IMPORTANT RULES:
- Do NOT invent metrics
- If data is missing, do NOT guess
- Write like a real consultant
- Be specific and actionable

INPUT DATA:
${JSON.stringify(analysis)}

USER CONTEXT:
- Name: ${order.name}
- Page URL: ${order.pageUrl}
- Goal: ${order.goal}

STRUCTURE:

1. Executive Summary
2. Page Overview
3. Strengths
4. Weaknesses
5. Growth Opportunities
6. Content Strategy
7. Action Plan
8. 7-Day Plan
9. Metrics to Track
10. Final Assessment

Write a high-quality, premium report.
`;
}

async function runWriter(order, analysis) {
  const prompt = buildWriterPrompt(order, analysis);

  const response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model: "claude-3-sonnet-20240229",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    },
    {
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
    }
  );

  return response.data.content[0].text;
}

module.exports = { runWriter };