const { supabase } = require('../client');

/**
 * Course Sessions Repository
 * Handles all database operations related to course sessions
 */

/**
 * Create a new course session
 * @param {Object} sessionData - Session data
 * @returns {Promise<Object>} Created session object
 */
async function createSession(sessionData) {
  try {
    const { data: session, error } = await supabase
      .from('course_sessions')
      .insert({
        course_id: sessionData.courseId || sessionData.course_id,
        instructor: sessionData.instructor,
        days_of_week: sessionData.daysOfWeek || sessionData.days_of_week,
        start_time: sessionData.startTime || sessionData.start_time,
        end_time: sessionData.endTime || sessionData.end_time,
        start_date: sessionData.startDate || sessionData.start_date,
        end_date: sessionData.endDate || sessionData.end_date,
        location: sessionData.location,
        section: sessionData.section
      })
      .select()
      .single();

    if (error) throw error;
    return { success: true, data: session };
  } catch (error) {
    console.error('Error in createSession:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Get all sessions for a specific course
 * @param {string} courseId - Course UUID
 * @returns {Promise<Object>} Array of sessions
 */
async function getSessionsByCourse(courseId) {
  try {
    const { data: sessions, error } = await supabase
      .from('course_sessions')
      .select('*, courses(*)')
      .eq('course_id', courseId)
      .order('start_date');

    if (error) throw error;
    return { success: true, data: sessions || [] };
  } catch (error) {
    console.error('Error in getSessionsByCourse:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Get session by ID with course details
 * @param {string} sessionId - Session UUID
 * @returns {Promise<Object>} Session object with course details
 */
async function getSessionById(sessionId) {
  try {
    const { data: session, error } = await supabase
      .from('course_sessions')
      .select('*, courses(*)')
      .eq('id', sessionId)
      .single();

    if (error) throw error;
    return { success: true, data: session };
  } catch (error) {
    console.error('Error in getSessionById:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Find or create a course session
 * @param {Object} sessionData - Session data
 * @returns {Promise<Object>} Found or created session
 */
async function findOrCreateSession(sessionData) {
  try {
    // Try to find existing session with matching details
    const { data: existingSession, error: findError } = await supabase
      .from('course_sessions')
      .select('*')
      .eq('course_id', sessionData.courseId || sessionData.course_id)
      .eq('instructor', sessionData.instructor || '')
      .eq('start_time', sessionData.startTime || sessionData.start_time)
      .eq('end_time', sessionData.endTime || sessionData.end_time)
      .maybeSingle();

    if (findError && findError.code !== 'PGRST116') {
      throw findError;
    }

    if (existingSession) {
      return { success: true, data: existingSession, created: false };
    }

    // Create new session if not found
    return await createSession(sessionData);
  } catch (error) {
    console.error('Error in findOrCreateSession:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Update a course session
 * @param {string} sessionId - Session UUID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated session object
 */
async function updateSession(sessionId, updates) {
  try {
    const { data: session, error } = await supabase
      .from('course_sessions')
      .update(updates)
      .eq('id', sessionId)
      .select()
      .single();

    if (error) throw error;
    return { success: true, data: session };
  } catch (error) {
    console.error('Error in updateSession:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  createSession,
  getSessionsByCourse,
  getSessionById,
  findOrCreateSession,
  updateSession
};

