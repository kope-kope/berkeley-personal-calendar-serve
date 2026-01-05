const { supabase } = require('../client');

/**
 * User Repository
 * Handles all database operations related to users
 */

/**
 * Create or update a user by email (upsert)
 * @param {string} email - User email address
 * @param {Object} data - Additional user data
 * @returns {Promise<Object>} Created/updated user object
 */
async function createOrUpdateUser(email, data = {}) {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .upsert(
        { 
          email, 
          ...data,
          last_active: new Date().toISOString()
        },
        { 
          onConflict: 'email',
          ignoreDuplicates: false 
        }
      )
      .select()
      .single();

    if (error) throw error;
    return { success: true, data: user };
  } catch (error) {
    console.error('Error in createOrUpdateUser:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Get user by email address
 * @param {string} email - User email address
 * @returns {Promise<Object>} User object or null
 */
async function getUserByEmail(email) {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 is "not found" error
      throw error;
    }

    return { success: true, data: user };
  } catch (error) {
    console.error('Error in getUserByEmail:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Get user by ID
 * @param {string} userId - User UUID
 * @returns {Promise<Object>} User object or null
 */
async function getUserById(userId) {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) throw error;
    return { success: true, data: user };
  } catch (error) {
    console.error('Error in getUserById:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Update user's last active timestamp
 * @param {string} userId - User UUID
 * @returns {Promise<Object>} Update result
 */
async function updateUserActivity(userId) {
  try {
    const { data, error } = await supabase
      .from('users')
      .update({ last_active: new Date().toISOString() })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Error in updateUserActivity:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Mark donation email as sent for user
 * @param {string} userId - User UUID
 * @returns {Promise<Object>} Update result
 */
async function markDonationEmailSent(userId) {
  try {
    const { data, error } = await supabase
      .from('users')
      .update({ 
        donation_email_sent: true,
        donation_email_sent_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Error in markDonationEmailSent:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Update Google OAuth tokens for a user
 * @param {string} email - User email address
 * @param {Object} tokens - OAuth tokens { access_token, refresh_token, token_expiry }
 * @returns {Promise<Object>} Updated user object
 */
async function updateGoogleTokens(email, tokens) {
  try {
    // First ensure user exists
    const existingUser = await getUserByEmail(email);
    
    if (!existingUser.success || !existingUser.data) {
      // Create user if not exists
      const createResult = await createOrUpdateUser(email);
      if (!createResult.success) {
        throw new Error('Failed to create user');
      }
    }

    const { data: user, error } = await supabase
      .from('users')
      .update({
        google_access_token: tokens.access_token,
        google_refresh_token: tokens.refresh_token || existingUser?.data?.google_refresh_token,
        google_token_expiry: tokens.token_expiry,
        google_calendar_connected: true,
        google_calendar_connected_at: new Date().toISOString(),
        last_active: new Date().toISOString()
      })
      .eq('email', email)
      .select()
      .single();

    if (error) throw error;
    return { success: true, data: user };
  } catch (error) {
    console.error('Error in updateGoogleTokens:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Get Google OAuth tokens for a user
 * @param {string} email - User email address
 * @returns {Promise<Object>} User tokens or null
 */
async function getGoogleTokens(email) {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, google_access_token, google_refresh_token, google_token_expiry, google_calendar_connected')
      .eq('email', email)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (!user || !user.google_access_token) {
      return { success: false, error: 'No tokens found for user' };
    }

    return { 
      success: true, 
      data: {
        userId: user.id,
        email: user.email,
        accessToken: user.google_access_token,
        refreshToken: user.google_refresh_token,
        tokenExpiry: user.google_token_expiry,
        isConnected: user.google_calendar_connected
      }
    };
  } catch (error) {
    console.error('Error in getGoogleTokens:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Disconnect Google Calendar from user account
 * @param {string} email - User email address
 * @returns {Promise<Object>} Update result
 */
async function disconnectGoogleCalendar(email) {
  try {
    const { data, error } = await supabase
      .from('users')
      .update({
        google_access_token: null,
        google_refresh_token: null,
        google_token_expiry: null,
        google_calendar_connected: false
      })
      .eq('email', email)
      .select()
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Error in disconnectGoogleCalendar:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  createOrUpdateUser,
  getUserByEmail,
  getUserById,
  updateUserActivity,
  markDonationEmailSent,
  updateGoogleTokens,
  getGoogleTokens,
  disconnectGoogleCalendar
};

