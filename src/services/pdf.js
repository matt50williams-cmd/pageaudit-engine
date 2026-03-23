const puppeteer = require('puppeteer');

async function generatePDF(reportText, customerName, pageUrl) {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: Arial, sans-serif;
      color: #111;
      line-height: 1.7;
      padding: 60px;
      max-width: 800px;
      margin: 0 auto;
    }
    .header {
      border-bottom: 3px solid #1877F2;
      padding-bottom: 20px;
      margin-bottom: 40px;
    }
    .logo {
      font-size: 24px;
      font-weight: bold;
      color: #1877F2;
    }
    .report-title {
      font-size: 20px;
      color: #333;
      margin-top: 8px;
    }
    .meta {
      color: #666;
      font-size: 13px;
      margin-top: 6px;
    }
    .report-body {
      white-space: pre-wrap;
      font-size: 15px;
      line-height: 1.8;
    }
    h1, h2, h3 {
      color: #111;
    }
    .footer {
      margin-top: 60px;
      padding-top: 20px;
      border-top: 1px solid #ddd;
      color: #999;
      font-size: 12px;
    }
    .upsell {
      background: #f0f4ff;
      border-left: 4px solid #1877F2;
      padding: 20px;
      margin-top: 40px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">PageAudit Pro</div>
    <div class="report-title">Facebook Page Growth Report</div>
    <div class="meta">
      Page: ${pageUrl}<br>
      Generated: ${new Date().toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })}
    </div>
  </div>

  <div class="report-body">${reportText.replace(/---[\s\S]*?---/, '')}</div>

  <div class="upsell">
    <strong>Want to keep growing after your 7 days?</strong><br><br>
    We put together a full 30-Day Growth Plan based on your page. It includes daily post ideas, 
    engagement scripts, hook templates, and a week-by-week strategy built specifically for your niche.<br><br>
    <strong>30-Day Growth Plan: $12</strong><br>
    Reply to this email to get yours instantly.
  </div>

  <div class="footer">
    PageAudit Pro &nbsp;|&nbsp; info@pageauditpro.net &nbsp;|&nbsp; pageauditpro.net<br>
    This report was generated specifically for ${pageUrl}
  </div>
</body>
</html>
  `;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });

  const pdf = await page.pdf({
    format: 'A4',
    margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' },
    printBackground: true
  });

  await browser.close();
  return pdf;
}

module.exports = { generatePDF };