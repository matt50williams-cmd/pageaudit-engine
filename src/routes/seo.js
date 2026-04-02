const Stripe = require("stripe");
const { queryOne } = require("../db");

if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is required");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function getFrontendUrl() {
  return (process.env.FRONTEND_URL || "").replace(/\/+$/, "");
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

    const prompt = `You are a friendly website expert who helps small business owners get found on Google. You explain everything like you're talking to a plumber, restaurant owner, or hair salon — never use developer jargon. When you must reference code, present it as "ask your website person to paste this" or "if you use Wix/Squarespace/WordPress, here's where to find this setting."

ABSOLUTE RULES:
1. NEVER use technical terms. Say "Google preview text" not "meta description." Say "main headline" not "H1 tag." Say "security lock" not "SSL certificate." Say "social media preview" not "Open Graph tags." Say "visitor tracking" not "analytics." Say "business info card" not "schema markup."
2. Every recommendation MUST reference "${businessName}" by name. NO generic advice.
3. For every MISSING item, explain what it is in one plain sentence, why it costs ${businessName} customers, and give the exact text or steps to fix it.
4. When you show code, always explain it as: "Have your website person paste this into your site" or "In [Wix/Squarespace/WordPress], go to Settings > [specific menu]."
5. Use "${customerName || businessName}" by name 3-4 times throughout.
6. Write like you're sitting across the table from a business owner explaining their website. Warm, direct, no fluff.
7. Total report: 5-7 pages.

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

# 5. ${businessName}'s 30-Day Fix-It Plan
Build this ONLY around what's actually missing. Plain English, no jargon:
**Week 1 — The Basics:** Fix the most important missing items (browser tab name, Google preview text, main headline). Tell them exactly what to do each day.
**Week 2 — Get Tracked:** Set up visitor tracking, make sure the security lock is on, speed up the site. Step by step.
**Week 3 — Get Local:** Add phone number, address, social media links. Set up Google Business Profile if they haven't.
**Week 4 — Get Found:** Start showing up in more searches. Simple content ideas, ask for reviews, share their website.
One paragraph per week with specific actions.

# 6. Quick Wins: Fix These in 10 Minutes
The 3-5 fastest fixes ${businessName} can do RIGHT NOW. For each one:
- What to do (one sentence, plain English)
- The exact text, steps, or settings to change
- Where to find it: "In WordPress, go to Settings > General" or "In Wix, click Site Menu > SEO" or "Ask your website person to paste this"
Write these for someone who is not technical. If they use Wix, Squarespace, or WordPress, tell them the exact menu to click.

# 7. ${businessName}'s Website Report Card
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
        max_tokens: 6000,
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