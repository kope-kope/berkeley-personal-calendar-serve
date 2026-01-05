const express = require('express');
const calendarService = require('../services/google-calendar.service');
const usersRepo = require('../db/repositories/users.repository');
const { supabase } = require('../db/client');

const router = express.Router();

/**
 * POST /api/calendar/events
 * Create calendar events for matched courses
 * Body: { email, courses: [...] }
 */
router.post('/events', async (req, res) => {
  try {
    const { email, courses } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    if (!courses || !Array.isArray(courses) || courses.length === 0) {
      return res.status(400).json({ error: 'Courses array is required and must not be empty' });
    }

    // Verify user has connected Google Calendar
    const userResult = await usersRepo.getUserByEmail(email);
    if (!userResult.success || !userResult.data) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.data;
    if (!user.google_calendar_connected) {
      return res.status(403).json({ 
        error: 'Google Calendar not connected',
        message: 'Please connect your Google Calendar before creating events'
      });
    }

    // Normalize courses first
    const normalizedCourses = courses.map(course => calendarService.normalizeCourse(course));

    // Filter to only matched courses with required data (keep matched check if needed)
    const validCourses = normalizedCourses.filter(c => 
      c.courseNo && c.courseTitle && c.startDate && c.endDate
    );

    if (validCourses.length === 0) {
      return res.status(400).json({ 
        error: 'No valid courses to create events for',
        message: 'Courses must have course number, title, and start/end dates'
      });
    }

    console.log(`Creating ${validCourses.length} calendar events for ${email}`);

    // Create events
    const result = await calendarService.batchCreateEvents(email, validCourses);

    // Store created events in database
    if (result.created.length > 0) {
      for (const created of result.created) {
        try {
          // Find the course data
          const courseData = validCourses.find(c => c.courseNo === created.courseNo);
          
          const { error: dbError } = await supabase.from('calendar_events').insert({
            user_id: user.id,
            user_schedule_id: null, // Not using user_schedules table in this flow
            event_id: created.eventId,
            calendar_provider: 'google',
            event_data: {
              courseNo: created.courseNo,
              htmlLink: created.htmlLink,
              courseData: courseData,
              calendarId: result.calendarId,
              calendarName: result.calendarName
            },
            synced_at: new Date().toISOString()
          });
          
          if (dbError) {
            console.error('Failed to save event to database:', dbError);
          } else {
            console.log(`Saved calendar event to database: ${created.eventId}`);
          }
        } catch (dbError) {
          console.error('Failed to save event to database:', dbError);
          // Continue even if database save fails
        }
      }
    }

    res.json({
      success: result.success,
      message: result.success 
        ? `Successfully created ${result.totalCreated} calendar events`
        : `Created ${result.totalCreated} events with ${result.totalFailed} failures`,
      created: result.created,
      failed: result.failed,
      totalCreated: result.totalCreated,
      totalFailed: result.totalFailed
    });

  } catch (error) {
    console.error('Error creating calendar events:', error);
    res.status(500).json({ 
      error: 'Failed to create calendar events',
      details: error.message 
    });
  }
});

/**
 * POST /api/calendar/preview
 * Generate preview of calendar events (without creating them)
 * Body: { courses: [...] }
 */
router.post('/preview', async (req, res) => {
  try {
    const { courses } = req.body;

    if (!courses || !Array.isArray(courses) || courses.length === 0) {
      return res.status(400).json({ error: 'Courses array is required and must not be empty' });
    }

    // Normalize courses first
    const normalizedCourses = courses.map(course => calendarService.normalizeCourse(course));

    // Generate preview events
    const events = calendarService.generateEventPreview(normalizedCourses);

    res.json({
      success: true,
      events: events,
      count: events.length
    });

  } catch (error) {
    console.error('Error generating preview:', error);
    res.status(500).json({ 
      error: 'Failed to generate preview',
      details: error.message 
    });
  }
});

/**
 * POST /api/calendar/ics
 * Generate ICS file for courses
 * Body: { courses: [...] }
 */
router.post('/ics', async (req, res) => {
  try {
    const { courses } = req.body;

    if (!courses || !Array.isArray(courses) || courses.length === 0) {
      return res.status(400).json({ error: 'Courses array is required and must not be empty' });
    }

    // Normalize courses first
    const normalizedCourses = courses.map(course => calendarService.normalizeCourse(course));

    // Filter to courses with required data
    const validCourses = normalizedCourses.filter(c => 
      c.courseNo && c.courseTitle && c.startDate && c.endDate
    );

    if (validCourses.length === 0) {
      return res.status(400).json({ 
        error: 'No valid courses to generate ICS for',
        message: 'Courses must have course number, title, and date range'
      });
    }

    console.log(`Generating ICS for ${validCourses.length} courses`);

    const icsContent = calendarService.generateICSContent(validCourses);

    // Set headers for ICS file download
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="haas_schedule.ics"');
    res.send(icsContent);

  } catch (error) {
    console.error('Error generating ICS:', error);
    res.status(500).json({ 
      error: 'Failed to generate ICS file',
      details: error.message 
    });
  }
});

/**
 * DELETE /api/calendar/events/:eventId
 * Delete a calendar event
 */
router.delete('/events/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    if (!eventId) {
      return res.status(400).json({ error: 'Event ID is required' });
    }

    const result = await calendarService.deleteEvent(email, eventId);

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    // Remove from database
    const userResult = await usersRepo.getUserByEmail(email);
    if (userResult.success && userResult.data) {
      await supabase
        .from('calendar_events')
        .delete()
        .eq('user_id', userResult.data.id)
        .eq('event_id', eventId);
    }

    res.json({ success: true, message: 'Event deleted successfully' });

  } catch (error) {
    console.error('Error deleting calendar event:', error);
    res.status(500).json({ 
      error: 'Failed to delete calendar event',
      details: error.message 
    });
  }
});

/**
 * GET /api/calendar/events
 * Get all calendar events for a user
 * Query: ?email=user@example.com
 */
router.get('/events', async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const userResult = await usersRepo.getUserByEmail(email);
    if (!userResult.success || !userResult.data) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { data: events, error } = await supabase
      .from('calendar_events')
      .select('*')
      .eq('user_id', userResult.data.id)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      events: events || [],
      count: events?.length || 0
    });

  } catch (error) {
    console.error('Error fetching calendar events:', error);
    res.status(500).json({ 
      error: 'Failed to fetch calendar events',
      details: error.message 
    });
  }
});

module.exports = router;

