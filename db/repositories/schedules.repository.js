const { supabase } = require('../client');

/**
 * User Schedules Repository
 * Handles all database operations related to user course schedules
 */

/**
 * Add a course to user's schedule
 * @param {string} userId - User UUID
 * @param {string} courseId - Course UUID
 * @param {string} sessionId - Session UUID
 * @returns {Promise<Object>} Created schedule entry
 */
async function addCourseToSchedule(userId, courseId, sessionId) {
  try {
    const { data: schedule, error } = await supabase
      .from('user_schedules')
      .insert({
        user_id: userId,
        course_id: courseId,
        session_id: sessionId,
        calendar_synced: false
      })
      .select()
      .single();

    if (error) throw error;
    return { success: true, data: schedule };
  } catch (error) {
    // Handle duplicate enrollment gracefully
    if (error.code === '23505') { // Unique constraint violation
      return { success: false, error: 'User already enrolled in this session' };
    }
    console.error('Error in addCourseToSchedule:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Get user's full schedule with course and session details
 * @param {string} userId - User UUID
 * @returns {Promise<Object>} Array of schedule entries with details
 */
async function getUserSchedule(userId) {
  try {
    const { data: schedule, error } = await supabase
      .from('user_schedules')
      .select(`
        *,
        courses(*),
        course_sessions(*)
      `)
      .eq('user_id', userId)
      .order('added_at', { ascending: false });

    if (error) throw error;
    return { success: true, data: schedule || [] };
  } catch (error) {
    console.error('Error in getUserSchedule:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Update calendar sync status for a schedule entry
 * @param {string} scheduleId - Schedule UUID
 * @param {boolean} synced - Sync status
 * @returns {Promise<Object>} Updated schedule entry
 */
async function updateSyncStatus(scheduleId, synced) {
  try {
    const updateData = {
      calendar_synced: synced
    };
    
    if (synced) {
      updateData.calendar_synced_at = new Date().toISOString();
    }

    const { data: schedule, error } = await supabase
      .from('user_schedules')
      .update(updateData)
      .eq('id', scheduleId)
      .select()
      .single();

    if (error) throw error;
    return { success: true, data: schedule };
  } catch (error) {
    console.error('Error in updateSyncStatus:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Remove a course from user's schedule
 * @param {string} userId - User UUID
 * @param {string} sessionId - Session UUID
 * @returns {Promise<Object>} Deletion result
 */
async function removeCourseFromSchedule(userId, sessionId) {
  try {
    const { data, error } = await supabase
      .from('user_schedules')
      .delete()
      .eq('user_id', userId)
      .eq('session_id', sessionId)
      .select();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Error in removeCourseFromSchedule:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Check if user is already enrolled in a session
 * @param {string} userId - User UUID
 * @param {string} sessionId - Session UUID
 * @returns {Promise<Object>} Boolean indicating enrollment status
 */
async function isEnrolled(userId, sessionId) {
  try {
    const { data, error } = await supabase
      .from('user_schedules')
      .select('id')
      .eq('user_id', userId)
      .eq('session_id', sessionId)
      .maybeSingle();

    if (error) throw error;
    return { success: true, data: !!data };
  } catch (error) {
    console.error('Error in isEnrolled:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Get all unsynced schedules for a user
 * @param {string} userId - User UUID
 * @returns {Promise<Object>} Array of unsynced schedule entries
 */
async function getUnsyncedSchedules(userId) {
  try {
    const { data: schedules, error } = await supabase
      .from('user_schedules')
      .select(`
        *,
        courses(*),
        course_sessions(*)
      `)
      .eq('user_id', userId)
      .eq('calendar_synced', false)
      .order('added_at');

    if (error) throw error;
    return { success: true, data: schedules || [] };
  } catch (error) {
    console.error('Error in getUnsyncedSchedules:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  addCourseToSchedule,
  getUserSchedule,
  updateSyncStatus,
  removeCourseFromSchedule,
  isEnrolled,
  getUnsyncedSchedules
};




