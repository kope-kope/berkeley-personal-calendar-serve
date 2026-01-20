const { google } = require('googleapis');

/**
 * Gmail Service
 * Handles Gmail API operations for sending emails
 */

/**
 * Get authenticated OAuth2 client for sender account
 * Uses sender refresh token from environment variables
 * @returns {Promise<Object>} OAuth2 client or error
 */
async function getSenderAuthenticatedClient() {
  try {
    const senderRefreshToken = process.env.GMAIL_SENDER_REFRESH_TOKEN;
    const senderEmail = process.env.GMAIL_SENDER_EMAIL;

    if (!senderRefreshToken) {
      return { success: false, error: 'Gmail sender refresh token not configured' };
    }

    if (!senderEmail) {
      return { success: false, error: 'Gmail sender email not configured' };
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    // Set credentials using refresh token
    oauth2Client.setCredentials({
      refresh_token: senderRefreshToken
    });

    // Refresh access token if needed
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);
    } catch (refreshError) {
      console.error('Failed to refresh sender access token:', refreshError);
      return { success: false, error: 'Failed to refresh sender access token. Please check sender refresh token.' };
    }

    return { success: true, client: oauth2Client };
  } catch (error) {
    console.error('Error getting sender authenticated client:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Create email message in RFC 2822 format
 * @param {string} to - Recipient email address
 * @param {string} from - Sender email address
 * @param {string} subject - Email subject
 * @param {string} body - Email body (plain text or HTML)
 * @param {boolean} isHtml - Whether body is HTML (default: false)
 * @returns {string} RFC 2822 formatted message
 */
function createEmailMessage(to, from, subject, body, isHtml = false) {
  // Format From header with display name
  const fromHeader = from.includes('@') 
    ? `Tosin Oladokun <${from}>`
    : from;
  
  const headers = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    isHtml ? 'Content-Type: text/html; charset=utf-8' : 'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0'
  ].join('\r\n');

  return `${headers}\r\n\r\n${body}`;
}

/**
 * Send email using Gmail API
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} body - Email body (plain text or HTML)
 * @param {boolean} isHtml - Whether body is HTML (default: false)
 * @returns {Promise<Object>} Result with message ID or error
 */
async function sendEmail(to, subject, body, isHtml = false) {
  try {
    const senderEmail = process.env.GMAIL_SENDER_EMAIL;
    if (!senderEmail) {
      return { success: false, error: 'Gmail sender email not configured' };
    }

    const clientResult = await getSenderAuthenticatedClient();
    if (!clientResult.success) {
      return clientResult;
    }

    const gmail = google.gmail({ version: 'v1', auth: clientResult.client });

    // Create email message in RFC 2822 format
    const message = createEmailMessage(to, senderEmail, subject, body, isHtml);

    // Encode message in base64url format (Gmail API requirement)
    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // Send email
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage
      }
    });

    console.log(`Email sent successfully to ${to}. Message ID: ${response.data.id}`);

    return {
      success: true,
      messageId: response.data.id
    };
  } catch (error) {
    console.error('Error sending email:', error);
    return {
      success: false,
      error: error.message,
      details: error.response?.data?.error || null
    };
  }
}

/**
 * Generate email template for calendar events confirmation
 * @param {string} userEmail - Recipient email address
 * @param {Array<Object>} events - Array of created calendar events
 * @param {string} calendarName - Name of the calendar
 * @param {string} calendarUrl - URL to the calendar
 * @returns {Object} Email subject and body
 */
function generateCalendarEventsEmail(userEmail, events, calendarName, calendarUrl) {
  const subject = 'Quick favor after you\'ve used the scheduler';

  // HTML email body
  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="font-family: Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; text-align: left;">
  <p>Hey there!</p>
  
  <p>Hope the scheduling tool helped make your life a tiny bit easier this semester!</p>
  
  <p>Now that you've got your classes sorted, I wanted to share something close to my heart: I'm raising support for the <strong>Kwara State Education Trust Fund</strong> back home in Nigeria.</p>
  
  <p>Scholarships from this fund are literally why I can be a Haasie today.</p>
  
  <p>If you can spare even a small donation, you'd be keeping that door open for bright kids who just need a chance.</p>
  
  <p style="text-align: center; margin: 30px 0;">
    <a href="https://kwaraetf.org/donations/kwaraetf/" style="display: inline-block; padding: 12px 24px; background-color: #000; color: white; text-decoration: none; border-radius: 5px;">Donate to Kwara ETF</a>
  </p>
  
  <p>If you're unable to donate through the link above, just reply to this email and I'll send you my Venmo or Zelle link.</p>
  
  <p>And hey—if you donate, find me on campus. I owe you a genuine hug and probably a thank you coffee ☕</p>
  
  <p>No pressure at all. Just wanted to loop you in on something that shaped my story.</p>
  
  <p>Thanks for reading,<br>Tosin</p>
</body>
</html>
  `.trim();

  // Plain text email body (fallback)
  const textBody = `Hey there!

Hope the scheduling tool helped make your life a tiny bit easier this semester!

Now that you've got your classes sorted, I wanted to share something close to my heart: I'm raising support for the Kwara State Education Trust Fund back home in Nigeria.

Scholarships from this fund are literally why I can be a Haasie today.

If you can spare even a small donation, you'd be keeping that door open for bright kids who just need a chance.

Donate here: https://kwaraetf.org/donations/kwaraetf/

If you're unable to donate through the link above, just reply to this email and I'll send you my Venmo or Zelle link.

And hey—if you donate, find me on campus. I owe you a genuine hug and probably a thank you coffee ☕

No pressure at all. Just wanted to loop you in on something that shaped my story.

Thanks for reading,
Tosin
  `.trim();

  return {
    subject,
    htmlBody,
    textBody
  };
}

module.exports = {
  getSenderAuthenticatedClient,
  sendEmail,
  createEmailMessage,
  generateCalendarEventsEmail
};