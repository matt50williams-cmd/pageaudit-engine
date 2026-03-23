const { getClient } = require('./openai');

async function analyzePage(input) {
  const client = getClient();

  const {
    name,
    email,
    pageUrl,
    reviewType,
    goals,
    postingFrequency,
    contentType,
    struggles,
    extraNotes,
    pageData
  } = input || {};

  const prompt = `
You are an expert Facebook page growth analyst.

IMPORTANT:
- Return ONLY valid JSON
- Do not include markdown or explanations
- Do not include trailing commas
- All scores must be between 0 and 10
- Use one decimal place maximum
- Each strength and weakness must be at least 10 words
- Be specific and actionable
- Use the customer intake details to personalize the report
- If pageData is missing or limited, do not pretend to have exact analytics
- If the customer's stated goal conflicts with current page setup, explain that in weaknesses and priority_fixes

Customer intake:
Name: ${name || ''}
Email: ${email || ''}
Page URL: ${pageUrl || ''}
Review type: ${reviewType || 'Personal'}
Primary goals: ${goals || 'General growth'}
Posting frequency: ${postingFrequency || 'Unknown'}
Main content type: ${contentType || 'Unknown'}
Main struggles: ${struggles || 'Unknown'}
Extra notes: ${extraNotes || 'None'}

Page data:
${JSON.stringify(pageData || {}, null, 2)}

Scoring guidance:
- profile_clarity: how clear the brand, message, identity, and purpose are
- posting_consistency: how likely the page is posting often enough to build momentum
- engagement_quality: how well the page appears to create interaction and audience response
- content_structure: how strong the content mix, formatting, and presentation appear
- growth_readiness: how prepared the page is to grow based on current setup and habits
- conversion_readiness: how ready the page is to turn visitors into followers, leads, or customers

Use the intake details to shape the analysis:
- If goals mention growth, prioritize visibility, consistency, and audience appeal
- If goals mention leads or business, prioritize trust, offer clarity, and conversion readiness
- If postingFrequency is low, reflect that in posting_consistency and priority fixes
- If struggles mention engagement, explain likely causes and practical fixes
- If contentType is narrow or repetitive, address this in weak_post_patterns and content_structure
- If extraNotes reveal special context, include it where relevant

Return this exact JSON structure:
{
  "overall_score": 7.2,
  "score_breakdown": {
    "profile_clarity": 7.0,
    "posting_consistency": 6.5,
    "engagement_quality": 7.5,
    "content_structure": 7.0,
    "growth_readiness": 7.5,
    "conversion_readiness": 6.0
  },
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "weaknesses": ["weakness 1", "weakness 2", "weakness 3"],
  "growth_limiters": ["limiter 1", "limiter 2"],
  "best_post_patterns": ["pattern 1", "pattern 2"],
  "weak_post_patterns": ["pattern 1", "pattern 2"],
  "priority_fixes": ["fix 1", "fix 2", "fix 3"],
  "growth_potential": {
    "summary": "summary here",
    "expected_30_day_outcome": "outcome here",
    "expected_90_day_outcome": "outcome here"
  },
  "recommended_next_step": "7_day"
}
`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'You are a precise Facebook page audit engine. Return only valid JSON.'
      },
      {
        role: 'user',
        content: prompt
      }
    ]
  });

  try {
    return JSON.parse(response.choices[0].message.content);
  } catch (err) {
    console.error('JSON parse failed:', response.choices[0].message.content);
    return {
      overall_score: 5.0,
      score_breakdown: {
        profile_clarity: 5.0,
        posting_consistency: 5.0,
        engagement_quality: 5.0,
        content_structure: 5.0,
        growth_readiness: 5.0,
        conversion_readiness: 5.0
      },
      strengths: [
        'The page appears to have enough baseline information to begin improvement planning.'
      ],
      weaknesses: [
        'The analysis response could not be fully parsed, so this fallback report is limited.'
      ],
      growth_limiters: [
        'The page needs a valid structured analysis response to generate a stronger report.'
      ],
      best_post_patterns: [],
      weak_post_patterns: [],
      priority_fixes: [
        'Retry the analysis so a complete personalized report can be generated.'
      ],
      growth_potential: {
        summary: 'Unable to fully analyze page with the current response.',
        expected_30_day_outcome: 'Unknown until a valid analysis is generated.',
        expected_90_day_outcome: 'Unknown until a valid analysis is generated.'
      },
      recommended_next_step: '7_day'
    };
  }
}

// Backward-compatible helper if any old code still calls analyzePageData(pageData, goal, reviewType)
async function analyzePageData(pageData, goal, reviewType) {
  return analyzePage({
    pageData,
    goals: goal,
    reviewType
  });
}

module.exports = { analyzePage, analyzePageData };