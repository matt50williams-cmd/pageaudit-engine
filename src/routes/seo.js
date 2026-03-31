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
      hasTitle: "Page Title (10+ characters)",
      hasMetaDesc: "Meta Description (50+ characters)",
      hasH1: "H1 Heading Tag",
      hasOgTags: "Open Graph / Social Sharing Tags",
      hasMobile: "Mobile Viewport Tag",
      hasSSL: "HTTPS / SSL Certificate",
      fastPageLoad: "Page Size Under 100KB",
      hasAnalytics: "Analytics / Tracking Installed",
      hasPhoneNumber: "Phone Number on Page",
      hasAddress: "Business Address on Page",
      hasPrivacyPolicy: "Privacy Policy Link",
      hasSocialLinks: "Social Media Links (non-Facebook)",
    };

    const failedReadable = failed.map(k => `FAIL: ${checkLabels[k] || k}`).join("\n");
    const passedReadable = passedList.map(k => `PASS: ${checkLabels[k] || k}`).join("\n");

    const prompt = `You are a no-nonsense SEO expert who has audited 1,000+ small business websites. You charge $2,000 per consultation. You write like a trusted advisor — direct, specific, no fluff.

ABSOLUTE RULES:
1. Every recommendation MUST reference "${businessName}" by name and "${websiteUrl}" specifically. NO generic advice.
2. For every FAILED check, provide the EXACT HTML code or text they need to add to fix it. Write it ready to copy and paste.
3. NO FLUFF. Every sentence must contain a specific insight or action for ${businessName}.
4. NO REPETITION. Say something once, say it well, move on.
5. Use "${customerName || businessName}" by name 3-4 times throughout.
6. Total report: 5-7 pages. Tight. Punchy. Impactful.

BUSINESS PROFILE:
- Business Name: ${businessName}
- Website: ${websiteUrl}
- City: ${city || "Not specified"}
- Email: ${email}
- Current Title Tag: ${existingTitle ? `"${existingTitle}"` : "MISSING"}
- Current Meta Description: ${existingDesc ? `"${existingDesc.substring(0, 120)}..."` : "MISSING"}

SEO SCORE: ${score}/100 (${passed}/${total} checks passed)

PASSED CHECKS:
${passedReadable}

FAILED CHECKS (these are what's hurting ${businessName}):
${failedReadable || "None — all checks passed!"}

WRITE EXACTLY THESE SECTIONS:

# 1. ${businessName}'s SEO Score: ${score}/100
Start with a 2-3 paragraph honest assessment of where ${businessName}'s website stands in Google search results${city ? ` for customers in ${city}` : ""}. Reference the specific score breakdown — ${passed} passed, ${failed.length} failed. Tell them exactly what this means in terms of customers they're losing. Make it feel personal and urgent.

# 2. Critical Fixes: What's Hurting ${businessName} Right Now
For EACH failed check, write a subsection with:
- **What's wrong**: One sentence explaining the problem in plain English
- **Why it matters**: How this specifically hurts ${businessName}${city ? ` in ${city}` : ""} (lost customers, lower rankings, etc.)
- **Exact fix**: The literal HTML code, text, or setting they need to add/change. Write it so they can copy and paste it.
${!checks.hasTitle ? `\nFor the missing/weak title tag, write the exact <title> tag ${businessName} should use, optimized for "${businessName}"${city ? ` in ${city}` : ""}.` : ""}
${!checks.hasMetaDesc ? `\nFor the missing meta description, write the exact <meta name="description" content="..."> tag ${businessName} should use, 150-160 characters, mentioning ${businessName}${city ? ` and ${city}` : ""}.` : ""}
${!checks.hasH1 ? `\nFor the missing H1, write the exact <h1> tag ${businessName} should add to their homepage.` : ""}
${!checks.hasOgTags ? `\nFor missing Open Graph tags, write ALL the og: meta tags ${businessName} needs (og:title, og:description, og:image, og:url).` : ""}
${!checks.hasAnalytics ? `\nFor missing analytics, provide the exact Google Analytics 4 setup instructions and code snippet for ${businessName}.` : ""}
${!checks.hasPhoneNumber ? `\nFor missing phone number, show exactly where and how to add a clickable tel: link on the page.` : ""}
${!checks.hasAddress ? `\nFor missing address, show the exact HTML with schema markup ${businessName} should add${city ? ` with their ${city} address` : ""}.` : ""}
${!checks.hasPrivacyPolicy ? `\nFor missing privacy policy, explain why it's required and where to add the link.` : ""}
${!checks.hasSocialLinks ? `\nFor missing social links, show the exact HTML for a social media links section.` : ""}
If all checks passed, congratulate them and explain what to optimize next for even higher rankings.

# 3. What ${businessName} Is Doing Right
Go through each PASSED check and explain why it matters and how to make it even better. Be specific — don't just say "good job", tell them the next level optimization for each.

# 4. ${businessName}'s Google Ranking Opportunities${city ? ` in ${city}` : ""}
Based on ${businessName}'s business type and location, identify:
- 5 specific keywords ${businessName} should target${city ? ` in ${city}` : ""}
- The #1 local SEO opportunity they're missing
- How to optimize their Google Business Profile for these keywords
- One competitor research tactic they can do today

# 5. ${businessName}'s 30-Day SEO Action Plan
Build this ONLY around the checks that FAILED. Each week should fix specific failed items:
**Week 1 — Critical Fixes:** Fix the most impactful failed checks (title, meta desc, H1)
**Week 2 — Technical SEO:** Fix remaining technical issues (SSL, speed, analytics)
**Week 3 — Local SEO:** Add address, phone, social links, Google Business Profile
**Week 4 — Content & Growth:** Start content strategy, build backlinks, monitor rankings
One paragraph per week with specific tasks tied to ${businessName}'s actual failures.

# 6. Quick Wins: Fix These in 10 Minutes
List the 3-5 fastest fixes from the failed checks. For EACH one:
- What to do (one sentence)
- The exact code or text to copy and paste
- Where to put it (which file or which part of their website builder)
Write these so a non-technical business owner can do them TODAY without hiring a developer.

# 7. ${businessName}'s SEO Scorecard
Create a scorecard grading these 4 areas out of 25 each (total /100):

**Technical Foundation: __/25**
Based on: SSL, page speed, mobile viewport, analytics
Fix: [One specific action]

**On-Page SEO: __/25**
Based on: Title tag, meta description, H1, Open Graph tags
Fix: [One specific action]

**Local Visibility: __/25**
Based on: Phone number, address, social links${city ? `, ${city} mentions` : ""}
Fix: [One specific action]

**Trust & Compliance: __/25**
Based on: Privacy policy, analytics, page structure
Fix: [One specific action]

**TOTAL: ${score}/100**

End with a powerful one-line statement that makes ${customerName || businessName} feel confident about fixing their SEO.`;

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
        success_url: `${frontendUrl}/dashboard?seo_success=true&audit_id=${audit.id}`,
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