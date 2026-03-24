const { getClient } = require('./openai');

async function analyzePage(data) {
  const client = getClient();

  const {
    name,
    pageUrl,
    reviewType,
    goals,
    postingFrequency,
    contentType,
    struggles,
    extraNotes
  } = data || {};

  const prompt = `
You are a Facebook growth strategist.

Analyze this profile and give specific, actionable advice.

User Info:
Name: ${name || ''}
Profile: ${pageUrl || ''}
Type: ${reviewType || ''}
Goal: ${goals || ''}
Posting: ${postingFrequency || ''}
Content: ${contentType || ''}
Struggles: ${struggles || ''}
Notes: ${extraNotes || ''}

Return JSON:

{
  "overallScore": 0,
  "scoreReason": "",
  "strengths": [],
  "weaknesses": [],
  "priorityFixes": [],
  "nextSteps": []
}
`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.7,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Return only JSON.' },
      { role: 'user', content: prompt }
    ]
  });

  return JSON.parse(response.choices[0].message.content);
}

module.exports = { analyzePage };