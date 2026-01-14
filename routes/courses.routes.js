const express = require('express');
const calendarService = require('../services/google-calendar.service');

const router = express.Router();

/**
 * POST /api/courses/normalize
 * Normalize and validate course data
 * Body: { courses: [...] }
 */
router.post('/normalize', async (req, res) => {
  try {
    const { courses } = req.body;

    if (!courses || !Array.isArray(courses)) {
      return res.status(400).json({ error: 'Courses array is required' });
    }

    // Normalize each course
    const normalizedCourses = courses.map(course => calendarService.normalizeCourse(course));

    res.json({
      success: true,
      courses: normalizedCourses,
      count: normalizedCourses.length
    });

  } catch (error) {
    console.error('Error normalizing courses:', error);
    res.status(500).json({ 
      error: 'Failed to normalize courses',
      details: error.message 
    });
  }
});

module.exports = router;




