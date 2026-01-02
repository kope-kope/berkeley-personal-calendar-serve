const { supabase } = require('../client');

/**
 * Courses Repository
 * Handles all database operations related to courses
 */

/**
 * Get course by course number and semester
 * @param {string} courseNo - Course number (e.g., "MBA210-1")
 * @param {string} semester - Semester (e.g., "Spring 2026")
 * @returns {Promise<Object>} Course object or null
 */
async function getCourseByCode(courseNo, semester) {
  try {
    const { data: course, error } = await supabase
      .from('courses')
      .select('*')
      .eq('course_no', courseNo)
      .eq('semester', semester)
      .single();

    if (error && error.code !== 'PGRST116') { // Not found error
      throw error;
    }

    return { success: true, data: course };
  } catch (error) {
    console.error('Error in getCourseByCode:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Create a new course
 * @param {Object} courseData - Course data
 * @returns {Promise<Object>} Created course object
 */
async function createCourse(courseData) {
  try {
    const { data: course, error } = await supabase
      .from('courses')
      .insert({
        course_no: courseData.course_no,
        course_title: courseData.course_title,
        units: courseData.units,
        instructor: courseData.instructor,
        start_date: courseData.start_date,
        end_date: courseData.end_date,
        days: courseData.days,
        time: courseData.time,
        notes: courseData.notes,
        location: courseData.location,
        semester: courseData.semester
      })
      .select()
      .single();

    if (error) throw error;
    return { success: true, data: course };
  } catch (error) {
    console.error('Error in createCourse:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Search courses by code or title
 * @param {string} query - Search query
 * @returns {Promise<Object>} Array of matching courses
 */
async function searchCourses(query) {
  try {
    const { data: courses, error } = await supabase
      .from('courses')
      .select('*')
      .or(`course_no.ilike.%${query}%,course_title.ilike.%${query}%`)
      .order('course_no');

    if (error) throw error;
    return { success: true, data: courses || [] };
  } catch (error) {
    console.error('Error in searchCourses:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Get all courses for a specific semester
 * @param {string} semester - Semester (e.g., "Spring 2026")
 * @returns {Promise<Object>} Array of courses
 */
async function getCoursesBySemester(semester) {
  try {
    const { data: courses, error } = await supabase
      .from('courses')
      .select('*')
      .eq('semester', semester)
      .order('course_no');

    if (error) throw error;
    return { success: true, data: courses || [] };
  } catch (error) {
    console.error('Error in getCoursesBySemester:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Update course information
 * @param {string} courseId - Course UUID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated course object
 */
async function updateCourse(courseId, updates) {
  try {
    const { data: course, error } = await supabase
      .from('courses')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', courseId)
      .select()
      .single();

    if (error) throw error;
    return { success: true, data: course };
  } catch (error) {
    console.error('Error in updateCourse:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Batch upsert courses from Google Sheets
 * Upserts (insert or update) courses based on unique constraint
 * @param {Array<Object>} coursesData - Array of course objects from Google Sheets
 * @returns {Promise<Object>} Result with inserted/updated count
 */
async function batchUpsertCourses(coursesData) {
  try {
    if (!coursesData || coursesData.length === 0) {
      return { success: true, data: { inserted: 0, updated: 0 }, count: 0, message: 'No courses to process' };
    }

    console.log(`Processing ${coursesData.length} courses from Google Sheets...`);
    
    let successCount = 0;
    let errorCount = 0;
    
    // Process one by one to handle duplicates within the batch
    for (const course of coursesData) {
      try {
        const { data, error } = await supabase
          .from('courses')
          .upsert({
            course_no: course.course_no,
            course_title: course.course_title,
            units: course.units,
            instructor: course.instructor,
            start_date: course.start_date,
            end_date: course.end_date,
            days: course.days,
            time: course.time,
            notes: course.notes,
            location: course.location,
            semester: course.semester,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'course_no,semester',
            ignoreDuplicates: false // Update existing records
          })
          .select();

        if (error) {
          console.error(`Error upserting ${course.course_no}:`, error.message);
          errorCount++;
        } else {
          successCount++;
        }
      } catch (err) {
        console.error(`Error processing ${course.course_no}:`, err.message);
        errorCount++;
      }
    }

    const message = errorCount > 0 
      ? `Successfully synced ${successCount} courses (${errorCount} errors)`
      : `Successfully synced ${successCount} courses`;

    return { 
      success: true, 
      count: successCount,
      errors: errorCount,
      message: message
    };
  } catch (error) {
    console.error('Error in batchUpsertCourses:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Delete courses not present in the provided list (for full sync)
 * @param {Array<Object>} coursesData - Array of course objects that should exist
 * @param {string} semester - Semester to limit deletion scope
 * @returns {Promise<Object>} Result with deleted count
 */
async function deleteCoursesNotInList(coursesData, semester) {
  try {
    const courseNos = coursesData.map(c => c.course_no).filter(Boolean);
    
    if (courseNos.length === 0) {
      return { success: true, data: [], count: 0 };
    }
    
    const { data: deleted, error } = await supabase
      .from('courses')
      .delete()
      .eq('semester', semester)
      .not('course_no', 'in', `(${courseNos.join(',')})`)
      .select();

    if (error) throw error;
    
    return { 
      success: true, 
      data: deleted,
      count: deleted?.length || 0 
    };
  } catch (error) {
    console.error('Error in deleteCoursesNotInList:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  getCourseByCode,
  createCourse,
  searchCourses,
  getCoursesBySemester,
  updateCourse,
  batchUpsertCourses,
  deleteCoursesNotInList
};

