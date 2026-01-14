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

/**
 * Normalize course number format for matching
 * Converts dots to hyphens for database lookup
 * Handles various formats:
 * - "MBA296.90T" -> "MBA296-90T" (non-OLR format with letters after section number)
 * - "MBA210B.1" -> "MBA210B-1" (standard OLR format)
 * - "MBA212A.2" -> "MBA212A-2"
 * @param {string} courseNo - Course number to normalize
 * @returns {string} Normalized course number
 */
function normalizeCourseNumber(courseNo) {
  if (!courseNo) return courseNo;
  // Replace dots with hyphens in the section part
  // Pattern matches: .digits, .digits+letters (e.g., .90T, .1, .2A, .90AB)
  // This handles both OLR format (MBA210B.1) and non-OLR formats (MBA296.90T)
  return courseNo.replace(/\.(\d+[A-Z]*)$/, '-$1').trim();
}

/**
 * Match extracted course numbers against database
 * Performs exact match on course_no field (format: MBA210B-1)
 * Normalizes extracted course numbers (converts dots to hyphens)
 * @param {Array<string>} courseNumbers - Array of course numbers to match (e.g., ["MBA210B.1", "MBA212A.2"])
 * @param {string} semester - Optional semester filter
 * @returns {Promise<Object>} Object with matched courses and unmatched course numbers
 */
async function matchCoursesByNumbers(courseNumbers, semester = null) {
  try {
    if (!courseNumbers || courseNumbers.length === 0) {
      return { 
        success: true, 
        data: { 
          matched: [], 
          unmatched: [],
          matchCount: 0,
          unmatchedCount: 0
        }
      };
    }

    // Clean, normalize, and dedupe course numbers
    // Normalize format: convert dots to hyphens (MBA210B.1 -> MBA210B-1)
    const normalizedNumbers = courseNumbers.map(cn => normalizeCourseNumber(cn?.trim())).filter(Boolean);
    const cleanedNumbers = [...new Set(normalizedNumbers)];
    
    console.log(`Matching ${cleanedNumbers.length} course numbers against database...`);
    console.log('Normalized course numbers to match:', cleanedNumbers);

    // Build query - using course_no (database format: MBA210B-1)
    let query = supabase
      .from('courses')
      .select('*')
      .in('course_no', cleanedNumbers);
    
    // Add semester filter if provided
    if (semester) {
      query = query.eq('semester', semester);
    }

    const { data: matchedCourses, error } = await query;

    if (error) {
      console.error('Database query error:', error.message);
      throw error;
    }

    // Create a map of matched course numbers for lookup
    const matchedNumbers = new Set((matchedCourses || []).map(c => c.course_no));
    
    // Find unmatched course numbers (using normalized versions)
    const unmatchedNumbers = cleanedNumbers.filter(cn => !matchedNumbers.has(cn));

    console.log(`Match results: ${matchedCourses?.length || 0} matched, ${unmatchedNumbers.length} unmatched`);
    if (matchedCourses && matchedCourses.length > 0) {
      console.log('Matched courses:', matchedCourses.map(c => ({ 
        course_no: c.course_no, 
        title: c.course_title,
        location: c.location,
        start_date: c.start_date,
        end_date: c.end_date
      })));
    }
    if (unmatchedNumbers.length > 0) {
      console.log('Unmatched course numbers:', unmatchedNumbers);
      console.log('These courses are not in the database. Make sure they have been synced from Google Sheets.');
    }

    return {
      success: true,
      data: {
        matched: matchedCourses || [],
        unmatched: unmatchedNumbers,
        matchCount: matchedCourses?.length || 0,
        unmatchedCount: unmatchedNumbers.length
      }
    };
  } catch (error) {
    console.error('Error in matchCoursesByNumbers:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Get a single course by course number (exact match)
 * @param {string} courseNo - Course number to find
 * @returns {Promise<Object>} Course object or null
 */
async function getCourseByNumber(courseNo) {
  try {
    const { data: course, error } = await supabase
      .from('courses')
      .select('*')
      .eq('course_no', courseNo)
      .maybeSingle();

    if (error) throw error;
    
    return { success: true, data: course };
  } catch (error) {
    console.error('Error in getCourseByNumber:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  getCourseByCode,
  getCourseByNumber,
  createCourse,
  searchCourses,
  getCoursesBySemester,
  updateCourse,
  batchUpsertCourses,
  deleteCoursesNotInList,
  matchCoursesByNumbers
};

