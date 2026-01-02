const { supabase } = require('../client');

/**
 * Extraction History Repository
 * Handles all database operations related to image extraction tracking
 */

/**
 * Save an extraction attempt
 * @param {string} userId - User UUID
 * @param {Object} extractedData - Raw extracted data from GPT-4 Vision
 * @param {string} status - Extraction status (pending, success, failed, partial)
 * @param {string} errorMessage - Error message if failed
 * @param {string} imageUrl - Optional image URL
 * @returns {Promise<Object>} Created extraction history entry
 */
async function saveExtraction(userId, extractedData, status, errorMessage = null, imageUrl = null) {
  try {
    const coursesCount = Array.isArray(extractedData) ? extractedData.length : 0;

    const { data: extraction, error } = await supabase
      .from('extraction_history')
      .insert({
        user_id: userId,
        image_url: imageUrl,
        extracted_data: extractedData,
        extraction_status: status,
        error_message: errorMessage,
        courses_extracted: coursesCount
      })
      .select()
      .single();

    if (error) throw error;
    return { success: true, data: extraction };
  } catch (error) {
    console.error('Error in saveExtraction:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Get extraction history for a user
 * @param {string} userId - User UUID
 * @param {number} limit - Maximum number of records to return
 * @returns {Promise<Object>} Array of extraction history entries
 */
async function getExtractionHistory(userId, limit = 20) {
  try {
    const { data: history, error } = await supabase
      .from('extraction_history')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return { success: true, data: history || [] };
  } catch (error) {
    console.error('Error in getExtractionHistory:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Get extraction by ID
 * @param {string} extractionId - Extraction UUID
 * @returns {Promise<Object>} Extraction history entry
 */
async function getExtractionById(extractionId) {
  try {
    const { data: extraction, error } = await supabase
      .from('extraction_history')
      .select('*')
      .eq('id', extractionId)
      .single();

    if (error) throw error;
    return { success: true, data: extraction };
  } catch (error) {
    console.error('Error in getExtractionById:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Get extraction statistics for a user
 * @param {string} userId - User UUID
 * @returns {Promise<Object>} Statistics object
 */
async function getExtractionStats(userId) {
  try {
    const { data: stats, error } = await supabase
      .rpc('get_extraction_stats', { user_id_param: userId });

    if (error) {
      // If RPC doesn't exist, calculate manually
      const { data: history, error: historyError } = await supabase
        .from('extraction_history')
        .select('extraction_status, courses_extracted')
        .eq('user_id', userId);

      if (historyError) throw historyError;

      const totalExtractions = history.length;
      const successfulExtractions = history.filter(h => h.extraction_status === 'success').length;
      const totalCourses = history.reduce((sum, h) => sum + (h.courses_extracted || 0), 0);

      return {
        success: true,
        data: {
          total_extractions: totalExtractions,
          successful_extractions: successfulExtractions,
          total_courses_extracted: totalCourses,
          success_rate: totalExtractions > 0 ? (successfulExtractions / totalExtractions * 100).toFixed(2) : 0
        }
      };
    }

    return { success: true, data: stats };
  } catch (error) {
    console.error('Error in getExtractionStats:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Update extraction status
 * @param {string} extractionId - Extraction UUID
 * @param {string} status - New status
 * @param {string} errorMessage - Optional error message
 * @returns {Promise<Object>} Updated extraction entry
 */
async function updateExtractionStatus(extractionId, status, errorMessage = null) {
  try {
    const { data: extraction, error } = await supabase
      .from('extraction_history')
      .update({
        extraction_status: status,
        error_message: errorMessage
      })
      .eq('id', extractionId)
      .select()
      .single();

    if (error) throw error;
    return { success: true, data: extraction };
  } catch (error) {
    console.error('Error in updateExtractionStatus:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  saveExtraction,
  getExtractionHistory,
  getExtractionById,
  getExtractionStats,
  updateExtractionStatus
};

