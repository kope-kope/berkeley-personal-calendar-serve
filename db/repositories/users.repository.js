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

module.exports = {
  createOrUpdateUser,
  getUserByEmail,
  getUserById,
  updateUserActivity,
  markDonationEmailSent
};

