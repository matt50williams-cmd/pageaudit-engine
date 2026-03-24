const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function analyzeOrder(order) {
  const {
    name,
    page_url,
    goal,
    struggles,
    review_type,
  } = order;

  const prompt = `
You are a high-level social media growth strategist.

This is NOT a generic audit.
This must feel like a PREMIUM, personalized report based on the user's actual profile and goals.

STRICT RULES:
- Use the user's NAME at least 2 times
- Reference their GOAL directly
- Reference their STRUGGLE directly
- Mention their PROFILE URL explicitly
- DO NOT speak generally
- DO NOT give generic advice
- Every recommendation must feel specific and tactical

USER DATA:
Name: ${name}
Profile URL: ${page_url}
Goal: ${goal}
Struggles: ${struggles}
Review Type: ${review_type}

OUTPUT FORMAT:

1. PERSONALIZED OVERVIEW
- Speak directly to ${name}
- Mention their goal and struggle
- Explain what is likely happening on their page

2. VISIBILITY ANALYSIS
- Explain how their visibility may be limiting growth
- Tie it to real-world reach

3. TOP 3 GROWTH BLOCKERS
- Be specific
- No generic phrases

4. WHAT’S WORKING
- Even if limited, find positives

5. 7-DAY ACTION PLAN
Day 1:
Day 2:
Day 3:
Day 4:
Day 5:
Day 6:
Day 7:

6. POSTING EXAMPLES
Give 3 SPECIFIC post ideas they can copy:

Post Idea 1:
Hook:
What to say:
Call to action:

7. GROWTH STRATEGY SUMMARY
- What they should focus on over the next 30 days

TONE:
- Confident
- Direct
- No fluff
- Must feel like a paid consultant wrote it
`;

  const response = await client.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.8,
  });

  return response.choices[0].message.content;
}

module.exports = { analyzeOrder };