const express = require('express');
const { google } = require('googleapis');
const usersRepo = require('../db/repositories/users.repository');

const router = express.Router();

// OAuth2 client configuration
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/auth/google/callback'
);

// Scopes required for Google Calendar access
// Using calendar scope (full access) to create calendars and events
const SCOPES = [
  'https://www.googleapis.com/auth/calendar', // Full calendar access (includes events + calendar list + calendar creation)
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
];

/**
 * GET /api/auth/google
 * Initiates Google OAuth2 flow
 * Query params:
 *   - email: User's email to associate with the OAuth session
 */
router.get('/google', (req, res) => {
  const { email } = req.query;
  
  if (!email) {
    return res.status(400).json({ error: 'Email is required to initiate OAuth flow' });
  }

  // Generate state parameter with user email for callback association
  const state = Buffer.from(JSON.stringify({ email })).toString('base64');
  
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    state,
    prompt: 'consent' // Force consent to get refresh token
  });

  res.json({ authUrl });
});

/**
 * GET /api/auth/google/callback
 * Handles OAuth2 callback from Google
 */
router.get('/google/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    console.error('OAuth error:', oauthError);
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3003'}?auth=error&message=${encodeURIComponent(oauthError)}`);
  }

  if (!code) {
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3003'}?auth=error&message=No authorization code received`);
  }

  try {
    // Decode state to get user email
    let email;
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
      email = stateData.email;
    } catch (e) {
      console.error('Failed to decode state:', e);
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3003'}?auth=error&message=Invalid state parameter`);
    }

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    
    // Set tokens to get user info from Google
    oauth2Client.setCredentials(tokens);
    
    // Get user email from Google OAuth (verify it matches what user entered)
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    let googleEmail = email; // Fallback to provided email
    
    try {
      const userInfo = await oauth2.userinfo.get();
      if (userInfo.data && userInfo.data.email) {
        googleEmail = userInfo.data.email;
        console.log('✓ Retrieved email from Google OAuth:', googleEmail);
      }
    } catch (err) {
      console.warn('Failed to get email from Google OAuth, using provided email:', err.message);
    }
    
    // Use email from Google if available, otherwise use provided email
    const finalEmail = googleEmail || email;
    
    // Calculate token expiry
    const tokenExpiry = tokens.expiry_date 
      ? new Date(tokens.expiry_date).toISOString()
      : new Date(Date.now() + 3600 * 1000).toISOString(); // Default 1 hour

    // Store tokens in database using the email from Google
    const result = await usersRepo.updateGoogleTokens(finalEmail, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expiry: tokenExpiry
    });

    if (!result.success) {
      console.error('Failed to store tokens:', result.error);
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3003'}?auth=error&message=Failed to save credentials`);
    }

    // Redirect to frontend with success (use email from Google if different)
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}?auth=success&email=${encodeURIComponent(finalEmail)}`);

  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}?auth=error&message=${encodeURIComponent(error.message)}`);
  }
});

/**
 * GET /api/auth/status
 * Check if user has connected their Google Calendar
 * Query params:
 *   - email: User's email address
 */
router.get('/status', async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const result = await usersRepo.getUserByEmail(email);
    
    if (!result.success || !result.data) {
      return res.json({ 
        connected: false,
        email,
        message: 'User not found'
      });
    }

    const user = result.data;
    
    res.json({
      connected: user.google_calendar_connected || false,
      connectedAt: user.google_calendar_connected_at,
      email: user.email,
      hasValidToken: user.google_access_token && 
        user.google_token_expiry && 
        new Date(user.google_token_expiry) > new Date()
    });

  } catch (error) {
    console.error('Auth status error:', error);
    res.status(500).json({ error: 'Failed to check auth status' });
  }
});

/**
 * POST /api/auth/disconnect
 * Disconnect Google Calendar from user account
 */
router.post('/disconnect', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const result = await usersRepo.disconnectGoogleCalendar(email);
    
    if (!result.success) {
      return res.status(500).json({ error: 'Failed to disconnect calendar' });
    }

    res.json({ 
      success: true, 
      message: 'Google Calendar disconnected successfully' 
    });

  } catch (error) {
    console.error('Disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect calendar' });
  }
});

module.exports = router;

