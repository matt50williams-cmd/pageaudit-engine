const Stripe = require("stripe");
const { queryOne } = require("../db");

if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is required");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function getFrontendUrl() {
  return (process.env.FRONTEND_URL || "").replace(/\/+$/, "");
}

async function researchCompetitors(websiteUrl, businessName, city) {
  if (!process.env.ANTHROPIC_API_KEY || !city) return null;

  const prompt = `You are a local SEO competitor researcher. Your job is to find the top 3 local competitors for a business and analyze what keywords they rank for.

BUSINESS: ${businessName}
WEBSITE: ${websiteUrl}
CITY: ${city}

STEPS:
1. Use web_search to search for businesses similar to "${businessName}" in ${city}. Try searches like "${businessName} ${city} competitors" and the type of business + "${city}".
2. Use web_search to look at what keywords the top local competitors are targeting — check their title tags, meta descriptions, and page content.
3. Use web_search to find what people in ${city} actually search for when looking for this type of business.

After your research, return ONLY valid JSON (no markdown, no code fences) in this exact shape:
{
  "competitors": [
    {
      "name": "Competitor business name",
      "website": "https://their-website.com",
      "strengths": "What they do well online — be specific",
      "keywords": ["keyword1", "keyword2", "keyword3"]
    }
  ],
  "top_local_keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "keyword_gaps": ["keywords competitors rank for that ${businessName} likely doesn't"],
  "local_search_trends": "Brief summary of what people in ${city} search for in this industry"
}

Return 3 competitors max. Return 5-10 top local keywords. Return 3-5 keyword gaps. If you cannot find competitors, return empty arrays — do NOT make up businesses.`;

  try {
    const tools = [{
      name: 'web_search',
      description: 'Search the web to find competitor websites and keyword data',
      input_schema: { type: 'object', properties: { query: { type: 'string', description: 'The search query' } }, required: ['query'] },
    }];

    let messages = [{ role: 'user', content: prompt }];
    const maxTurns = 8;

    for (let turn = 0; turn < maxTurns; turn++) {
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
          tools,
          messages,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        console.error('Competitor research API error:', data?.error?.message);
        return null;
      }

      if (data.stop_reason === 'tool_use') {
        const toolUseBlock = data.content.find(b => b.type === 'tool_use');
        if (toolUseBlock) {
          let searchResult;
          try {
            const query = encodeURIComponent(toolUseBlock.input?.query || '');
            const searchRes = await fetch(`https://www.google.com/search?q=${query}&num=10`, {
              headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120 Safari/537.36' },
              signal: AbortSignal.timeout(8000),
            });
            if (searchRes.ok) {
              const html = await searchRes.text();
              const bodyText = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000);
              searchResult = bodyText;
            } else {
              searchResult = `Search returned HTTP ${searchRes.status}`;
            }
          } catch (err) {
            searchResult = `Search failed: ${err.message}`;
          }
          messages.push({ role: 'assistant', content: data.content });
          messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseBlock.id, content: searchResult }] });
          continue;
        }
      }

      const textBlock = data.content?.find(b => b.type === 'text');
      const aiText = textBlock?.text || '';
      try {
        const jsonMatch = aiText.match(/\{[\s\S]*\}/);
        return JSON.parse(jsonMatch ? jsonMatch[0] : aiText);
      } catch {
        console.error('Competitor research JSON parse failed');
        return null;
      }
    }

    console.error('Competitor research hit max turns');
    return null;
  } catch (err) {
    console.error('Competitor research failed:', err.message);
    return null;
  }
}

async function runSeoReport(websiteUrl, email, auditId, options = {}) {
  if (!process.env.ANTHROPIC_API_KEY) return;
  const businessName = options.businessName || websiteUrl;
  const city = options.city || '';
  const customerName = options.customerName || '';

  try {
    let html = "";
    try {
      const res = await fetch(websiteUrl, {
        headers: { "User-Agent": "Mozilla/5.0 Chrome/120 Safari/537.36" },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) html = await res.text();
    } catch (e) {
      console.error("SEO scrape failed:", e.message);
    }

    // Extract existing title and meta desc for the report
    const existingTitle = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || null;
    const existingDesc = (html.match(/meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i) || [])[1]
      || (html.match(/meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i) || [])[1]
      || null;

    const checks = {
      hasTitle: /<title>[^<]{10,}/i.test(html),
      hasMetaDesc: /meta[^>]+name=["']description["'][^>]+content=["'][^"']{50,}/i.test(html) || /meta[^>]+content=["'][^"']{50,}["'][^>]+name=["']description["']/i.test(html),
      hasH1: /<h1[^>]*>[^<]{3,}/i.test(html),
      hasOgTags: /og:title/i.test(html),
      hasMobile: /viewport/i.test(html),
      hasSSL: websiteUrl.startsWith("https"),
      fastPageLoad: html.length < 100000,
      hasAnalytics: /google-analytics|googletagmanager|gtag|fbevents|facebook\.net\/en_US\/fbevents|clarity\.ms|hotjar|plausible|fathom/i.test(html),
      hasPhoneNumber: /(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})|tel:/i.test(html),
      hasAddress: /\b\d{2,5}\s+[A-Z][a-z]+\s+(St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl|Pkwy|Hwy|Suite|Ste)\b/i.test(html) || /\b[A-Z][a-z]+,\s?[A-Z]{2}\s?\d{5}\b/.test(html),
      hasPrivacyPolicy: /privacy.?policy|\/privacy/i.test(html),
      hasSocialLinks: /instagram\.com|twitter\.com|x\.com|linkedin\.com|youtube\.com|tiktok\.com/i.test(html),
    };

    const passed = Object.values(checks).filter(Boolean).length;
    const total = Object.keys(checks).length;
    const score = Math.round((passed / total) * 100);

    const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    const passedList = Object.entries(checks).filter(([, v]) => v).map(([k]) => k);

    const checkLabels = {
      hasTitle: "Website Name in Browser Tab",
      hasMetaDesc: "Google Preview Text",
      hasH1: "Main Page Headline",
      hasOgTags: "Social Media Preview (what shows when someone shares your link)",
      hasMobile: "Mobile-Friendly Setup",
      hasSSL: "Security Lock (the padlock in the browser)",
      fastPageLoad: "Fast Loading Speed",
      hasAnalytics: "Visitor Tracking (seeing who visits your site)",
      hasPhoneNumber: "Phone Number on Your Website",
      hasAddress: "Business Address on Your Website",
      hasPrivacyPolicy: "Privacy Policy Page",
      hasSocialLinks: "Links to Your Social Media Accounts",
    };

    const failedReadable = failed.map(k => `MISSING: ${checkLabels[k] || k}`).join("\n");
    const passedReadable = passedList.map(k => `GOOD: ${checkLabels[k] || k}`).join("\n");

    // Run competitor research in parallel with prompt construction
    const competitorData = await researchCompetitors(websiteUrl, businessName, city);
    const hasCompetitors = competitorData?.competitors?.length > 0;

    let competitorContext = '';
    if (hasCompetitors) {
      competitorContext = `\nCOMPETITOR RESEARCH (from live web search):
${competitorData.competitors.map((c, i) => `Competitor ${i + 1}: ${c.name} (${c.website})\n  Strengths: ${c.strengths}\n  Keywords: ${c.keywords?.join(', ') || 'unknown'}`).join('\n')}

TOP LOCAL KEYWORDS people in ${city} search for: ${competitorData.top_local_keywords?.join(', ') || 'unknown'}

KEYWORD GAPS (competitors rank for these, ${businessName} likely doesn't): ${competitorData.keyword_gaps?.join(', ') || 'unknown'}

LOCAL SEARCH TRENDS: ${competitorData.local_search_trends || 'Not available'}`;
    }

    const prompt = `You are a friendly website expert who helps small business owners get found on Google. You explain everything like you're talking to a plumber, restaurant owner, or hair salon — never use developer jargon. When you must reference code, present it as "ask your website person to paste this" or "if you use Wix/Squarespace/WordPress, here's where to find this setting."

ABSOLUTE RULES:
1. NEVER use technical terms. Say "Google preview text" not "meta description." Say "main headline" not "H1 tag." Say "security lock" not "SSL certificate." Say "social media preview" not "Open Graph tags." Say "visitor tracking" not "analytics." Say "business info card" not "schema markup."
2. Every recommendation MUST reference "${businessName}" by name. NO generic advice.
3. For every MISSING item, explain what it is in one plain sentence, why it costs ${businessName} customers, and give the exact text or steps to fix it.
4. When you show code, always explain it as: "Have your website person paste this into your site" or "In [Wix/Squarespace/WordPress], go to Settings > [specific menu]."
5. Use "${customerName || businessName}" by name 3-4 times throughout.
6. Write like you're sitting across the table from a business owner explaining their website. Warm, direct, no fluff.
7. Total report: 7-10 pages.

BUSINESS PROFILE:
- Business Name: ${businessName}
- Website: ${websiteUrl}
- City: ${city || "Not specified"}
- What currently shows in their browser tab: ${existingTitle ? `"${existingTitle}"` : "NOTHING — it's blank or says something generic"}
- What currently shows on Google under their link: ${existingDesc ? `"${existingDesc.substring(0, 120)}..."` : "NOTHING — Google is making up its own description"}

WEBSITE SCORE: ${score}/100 (${passed} out of ${total} items are set up correctly)

WHAT'S WORKING:
${passedReadable}

WHAT'S MISSING (costing ${businessName} customers right now):
${failedReadable || "Nothing — everything looks great!"}
${competitorContext}

WRITE EXACTLY THESE SECTIONS:

# 1. How Easy Is It for Customers to Find You on Google?
In 2-3 paragraphs, give ${businessName} an honest assessment of where their website stands. ${passed} out of ${total} things are set up correctly, and ${failed.length} important things are missing. Explain what this means in plain English${city ? ` — specifically for customers in ${city} searching on Google` : ""}. Don't say "SEO" or "score" — say "how easy it is for customers to find you on Google." Tell them exactly what the missing items are costing them: "Right now, when someone in ${city || 'your area'} searches for a business like yours, Google doesn't have enough information about ${businessName} to show you near the top."

# 2. What's Missing — And Exactly How to Fix It
For EACH missing item, write a subsection like this:

**[Plain English Name of What's Missing]**
- **What this is**: One sentence a restaurant owner would understand. Example: "This is the short description that shows up under your website link on Google."
- **What it's costing ${businessName}**: How this specifically loses customers${city ? ` in ${city}` : ""}. Be concrete: "When someone searches '${businessName}${city ? ` ${city}` : ''}', Google shows your link but the description underneath is random text from your page instead of something that makes people want to click."
- **How to fix it**: Step-by-step instructions. First explain it for someone who uses a website builder (Wix, Squarespace, WordPress), then show the exact text or code to use. Always write the actual content for them — don't say "write a description," give them the description.
${!checks.hasTitle ? `\nFor the missing browser tab name: write the exact text ${businessName} should use. Example format: "${businessName}${city ? ` | Trusted [Service] in ${city}` : ' | [What They Do]'}"` : ""}
${!checks.hasMetaDesc ? `\nFor the missing Google preview text: write the exact 150-160 character description ${businessName} should use. This is what shows up under their link on Google — make it compelling and mention ${businessName}${city ? ` and ${city}` : ""}.` : ""}
${!checks.hasH1 ? `\nFor the missing main headline: write the exact headline ${businessName} should put at the top of their homepage. This is the big text visitors see first.` : ""}
${!checks.hasOgTags ? `\nFor the missing social media preview: explain that when someone shares ${businessName}'s link on Facebook or text message, it shows a blank box instead of a nice preview with their name and image. Show them how to fix it.` : ""}
${!checks.hasAnalytics ? `\nFor the missing visitor tracking: explain that ${businessName} has no way of knowing how many people visit their website, where they come from, or what pages they look at. Walk them through setting up Google Analytics step by step — explain it like they've never heard of it.` : ""}
${!checks.hasPhoneNumber ? `\nFor the missing phone number: explain that customers who find ${businessName} on their phone can't tap to call. Show them exactly where to put their phone number and how to make it clickable.` : ""}
${!checks.hasAddress ? `\nFor the missing address: explain that Google doesn't know where ${businessName} is located, so it can't show them to nearby customers. Show them how to add their address${city ? ` in ${city}` : ""} in a way Google can read it.` : ""}
${!checks.hasPrivacyPolicy ? `\nFor the missing privacy policy: explain in plain English why every business website needs one (it's not just legal — Google actually checks for it) and how to add one in 5 minutes.` : ""}
${!checks.hasSocialLinks ? `\nFor the missing social media links: explain that linking to their Instagram, Facebook, etc. from their website helps Google trust that ${businessName} is a real, active business.` : ""}
If everything passed, congratulate them and tell them 3 things to do next to rank even higher.

# 3. What ${businessName} Is Doing Right
Go through each item that passed. For each one, explain what it is in plain English, why it matters, and one tip to make it even better. Keep it positive and encouraging.

# 4. How to Get More ${city || "Local"} Customers From Google
Write this for a business owner who has never thought about Google rankings:
- 5 things people actually type into Google when looking for a business like ${businessName}${city ? ` in ${city}` : ""}
- The #1 free thing ${businessName} can do to show up higher (Google Business Profile)
- How to check if ${businessName} shows up when people search${city ? ` in ${city}` : ""}
- One thing their competitors are probably doing that ${businessName} isn't

# 5. Who's Beating ${businessName} on Google${city ? ` in ${city}` : ""}
${hasCompetitors ? `We researched ${businessName}'s top local competitors. Using the competitor research data provided above, write this section:
- For each competitor, explain in plain English: who they are, what their website does better than ${businessName}'s, and the specific words/phrases (keywords) they show up for on Google that ${businessName} doesn't.
- Format each competitor as a subsection:

**[Competitor Name] — [their website]**
- What they're doing right: [specific things from the research]
- Words they show up for on Google: [list the keywords from the research in plain English]
- What ${businessName} can steal from them: [one specific, actionable takeaway]

Keep it respectful but honest. The goal is to show ${businessName} exactly what's working for competitors so they can do it too.

If any competitors have weak websites (no Google preview text, no mobile setup, slow loading), call that out as an opportunity: "${businessName} can leap ahead of [Competitor] by fixing these basics first."` : `GOOD NEWS for ${businessName}: We researched competitors${city ? ` in ${city}` : ""} and most of them have a weak online presence — they're not showing up well on Google either. This is a massive opportunity.

Write this section as exciting, motivating news:
- Frame it as: "Most of your competitors are making the same mistakes — or worse. If ${businessName} fixes the issues in this report first, you won't just catch up — you'll leap ahead of everyone in ${city || 'your market'}."
- Explain that most small businesses never fix their websites, so even basic improvements put ${businessName} in the top 10-20% of local businesses online
- Give them 3 specific things to look for when they Google their own competitors (browser tab names, Google preview text, mobile-friendliness) so they can see for themselves how weak the competition is
- End with a motivating statement: "The bar is low and ${businessName} is about to clear it."`}

# 6. ${businessName}'s Keyword Gap — Words Customers Search That You're Missing
${hasCompetitors ? `Using the keyword gap data from the competitor research above, write this section in plain English:
- **What people in ${city || 'your area'} are actually typing into Google** when they need a business like ${businessName}. List each keyword/phrase and explain it like: "When someone types '[keyword]' into Google, they're looking for exactly what ${businessName} offers — but right now, ${businessName} doesn't show up for this."
- **The gap:** Which of these words/phrases competitors rank for but ${businessName} doesn't. Explain why this matters in dollars: "Every time someone searches '[keyword]' and finds a competitor instead of ${businessName}, that's a potential customer lost."
- **How to close the gap:** For each keyword, give ONE specific action — add it to their browser tab name, write a page about it, mention it in their Google Business Profile, etc. Plain English, no jargon.

Format as a simple table or list that a business owner can hand to their website person and say "make us show up for these."` : `Here's the exciting part: since most competitors${city ? ` in ${city}` : ""} aren't optimizing for specific search phrases either, ${businessName} has a wide-open opportunity to own these searches.

Write this section as an opportunity roadmap:
- Use the "Google autocomplete trick" — explain how ${businessName} can type what they do into Google and see what real customers are searching for. Walk them through it step by step.
- Give them 5-7 specific example search phrases customers likely use for a business like theirs${city ? ` in ${city}` : ""} (e.g., "[service type] near me", "[service type] ${city || 'in [city]'}", "best [business type] ${city || 'near me'}")
- For each phrase, show them exactly where to add it: browser tab name, Google preview text, main headline, or a new page on their website
- Frame this as "claiming territory" — "Right now, nobody owns these searches ${city ? `in ${city}` : ''}. ${businessName} can be first."
- End with: "Add these phrases to your website this week and you'll start showing up where your competitors aren't even trying."`}

# 7. ${businessName}'s 30-Day Fix-It Plan
Build this ONLY around what's actually missing. Plain English, no jargon:
**Week 1 — The Basics:** Fix the most important missing items (browser tab name, Google preview text, main headline). Tell them exactly what to do each day.
**Week 2 — Get Tracked:** Set up visitor tracking, make sure the security lock is on, speed up the site. Step by step.
**Week 3 — Get Local:** Add phone number, address, social media links. Set up Google Business Profile if they haven't.
**Week 4 — Get Found:** Start showing up in more searches. Simple content ideas, ask for reviews, share their website.
One paragraph per week with specific actions.

# 8. Quick Wins: Fix These in 10 Minutes
The 3-5 fastest fixes ${businessName} can do RIGHT NOW. For each one:
- What to do (one sentence, plain English)
- The exact text, steps, or settings to change
- Where to find it: "In WordPress, go to Settings > General" or "In Wix, click Site Menu > SEO" or "Ask your website person to paste this"
Write these for someone who is not technical. If they use Wix, Squarespace, or WordPress, tell them the exact menu to click.

# 9. ${businessName}'s Website Report Card
Grade ${businessName} on these 4 areas. Give each a score out of 25 (total out of 100) and one specific fix:

**Can Customers Find You? __/25**
Based on: Browser tab name, Google preview text, main headline, social media preview
Fix: [One plain-English action]

**Is Your Site Fast and Secure? __/25**
Based on: Security lock, loading speed, mobile-friendly, visitor tracking
Fix: [One plain-English action]

**Can Customers Contact You? __/25**
Based on: Phone number, business address, social media links${city ? `, ${city} presence` : ""}
Fix: [One plain-English action]

**Does Google Trust You? __/25**
Based on: Privacy policy, visitor tracking, site structure
Fix: [One plain-English action]

**TOTAL: ${score}/100**

End with one encouraging sentence that makes ${customerName || businessName} feel like they CAN fix this and it WILL bring them more customers.`;

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!aiRes.ok) throw new Error("AI report failed");
    const aiData = await aiRes.json();
    const reportText = aiData.content?.[0]?.text || "";

    await queryOne(
      `UPDATE audits SET report_text = $1, overall_score = $2, status = 'completed', updated_at = NOW() WHERE id = $3`,
      [reportText, score, auditId]
    );
    console.log(`SEO audit ${auditId} completed with score ${score}`);
  } catch (err) {
    console.error("SEO report generation failed:", err.message);
    await queryOne(`UPDATE audits SET status = 'failed', updated_at = NOW() WHERE id = $1`, [auditId]).catch(() => {});
  }
}

async function seoRoutes(fastify) {
  fastify.post("/api/stripe/seo-checkout", async (request, reply) => {
    try {
      const { email, customer_name, website_url } = request.body || {};
      if (!email || !website_url) return reply.status(400).send({ error: "email and website_url are required" });

      const frontendUrl = getFrontendUrl();
      if (!frontendUrl) return reply.status(500).send({ error: "FRONTEND_URL not configured" });

      const audit = await queryOne(
        `INSERT INTO audits (email, customer_name, website, account_type, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING *`,
        [email.toLowerCase().trim(), customer_name || email, website_url, "SEO Audit", "pending"]
      );

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: email,
        metadata: { audit_id: String(audit.id), product: "seo_audit", website_url },
        payment_intent_data: { metadata: { audit_id: String(audit.id), product: "seo_audit" } },
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name: "Full Website SEO Audit", description: "Detailed technical SEO audit with 30-day action plan" },
            unit_amount: 2999,
          },
          quantity: 1,
        }],
        success_url: `${frontendUrl}/seo-loading?audit_id=${audit.id}`,
        cancel_url: `${frontendUrl}/seo-audit?cancelled=true`,
      });

      await queryOne(`UPDATE audits SET stripe_session_id = $1, updated_at = NOW() WHERE id = $2`, [session.id, audit.id]);
      return reply.send({ url: session.url });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: "Checkout failed" });
    }
  });

  fastify.post("/api/audits/:id/run-seo", async (request, reply) => {
    try {
      const auditId = parseInt(request.params.id);
      const audit = await queryOne(`SELECT * FROM audits WHERE id = $1`, [auditId]);
      if (!audit) return reply.status(404).send({ error: "Audit not found" });
      await queryOne(`UPDATE audits SET status = 'analyzing', updated_at = NOW() WHERE id = $1`, [auditId]);
      runSeoReport(audit.website, audit.email, auditId, {
        businessName: audit.business_name || audit.customer_name || audit.website,
        city: audit.city || '',
        customerName: audit.customer_name || '',
      }).catch(console.error);
      return reply.send({ success: true });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: "Failed to start SEO report" });
    }
  });
}

module.exports = seoRoutes;
module.exports.runSeoReport = runSeoReport;