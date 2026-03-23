const { getClient } = require('./openai');

async function writeCustomerReport(pageData, analysis, reviewType, goal) {
  const client = getClient();
  const overallScore100 = Math.round((analysis.overall_score || 0) * 10);

  const prompt = `
You are writing a professional Facebook page growth report for a paying customer.

Tone: friendly, direct, professional, honest. No emojis. No fluff.

IMPORTANT RULES:
- Use clear section headers exactly as written
- Do not skip any sections
- Keep formatting consistent and easy to read
- Do not repeat ideas across sections
- Keep sentences concise and actionable
- Each action step must be clear and immediately usable
- Keep total report length between 600 and 900 words
- If data is incomplete, still provide a useful and professional report

The customer paid for a ${reviewType} page review. Their goal: ${goal || 'grow their page'}.

Page facts:
- Page name: ${pageData.page_name}
- Followers: ${pageData.followers}
- Posts analyzed: ${pageData.posting_summary.posts_analyzed}
- Average days between posts: ${pageData.posting_summary.average_days_between_posts}
- Category: ${pageData.category}
- Scrape success: ${pageData.scrape_success}

Analysis results:
${JSON.stringify(analysis, null, 2)}

Write a full report with these sections:

1. PAGE OVERVIEW
Talk about their page specifically. Mention follower count, posting consistency, and activity.

2. OVERALL SCORE: ${overallScore100}/100
Explain the score in plain English.

3. WHAT YOU ARE DOING WELL
Explain each strength clearly.

4. WHAT IS HOLDING YOU BACK
Explain each weakness directly and honestly.

5. WHAT FACEBOOK ACTUALLY REWARDS RIGHT NOW
Explain the algorithm in plain English.

6. YOUR CONTENT STRATEGY
Specific advice on content types, frequency, hooks, and post structure.

7. ENGAGEMENT STRATEGY
How to increase comments, shares, and saves with specific examples.

8. YOUR GROWTH POTENTIAL
What they can expect in 30 and 90 days.

9. YOUR 7-DAY ACTION PLAN
Day-by-day plan with specific actions.

End with exactly this:

---
WANT TO KEEP GROWING AFTER YOUR 7 DAYS?

Get a fresh audit every 30 days with updated strategy, progress tracking, and a full 30-day content plan.

Start your Growth Plan here:
https://buy.stripe.com/bJefZiaZydoL0qxdZlasg06
---
`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.6,
    messages: [
      { role: 'system', content: 'You write premium agency-style Facebook page audit reports.' },
      { role: 'user', content: prompt }
    ]
  });

  return response.choices[0].message.content;
}

module.exports = { writeCustomerReport };