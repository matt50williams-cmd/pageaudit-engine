const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function sendConfirmationEmail(email, pageUrl) {
  return transporter.sendMail({
    from: process.env.FROM_EMAIL,
    to: email,
    subject: 'Your PageAudit Pro order is confirmed',
    text: `Thank you for your purchase.

We received your Facebook page review order for:
${pageUrl}

Your report is now being prepared and will be delivered within 1 hour.

- PageAudit Pro`
  });
}

async function sendReportEmail(email, pageUrl, pdfBuffer) {
  return transporter.sendMail({
    from: process.env.FROM_EMAIL,
    to: email,
    subject: 'Your PageAudit Pro report is ready',
    text: `Your PageAudit Pro report is attached.

Reviewed page:
${pageUrl}

If you want to keep improving, start your Monthly Growth Plan here:
https://buy.stripe.com/bJefZiaZydoL0qxdZlasg06

- PageAudit Pro`,
    attachments: [
      {
        filename: 'PageAuditPro-Report.pdf',
        content: pdfBuffer
      }
    ]
  });
}

module.exports = {
  sendConfirmationEmail,
  sendReportEmail
};