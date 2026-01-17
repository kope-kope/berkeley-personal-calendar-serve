const express = require('express');
const calendarService = require('../services/google-calendar.service');
const gmailService = require('../services/gmail.service');
const usersRepo = require('../db/repositories/users.repository');
const sessionsRepo = require('../db/repositories/sessions.repository');
const schedulesRepo = require('../db/repositories/schedules.repository');
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

    console.log(`Creating/syncing ${validCourses.length} calendar events for ${email}`);

    // Create/update/delete events (smart diff)
    const result = await calendarService.batchCreateEvents(email, validCourses);

    // Handle unchanged schedule
    if (result.unchanged) {
      return res.json({
        success: true,
        message: 'Schedule unchanged - no updates needed',
        unchanged: true,
        calendarId: result.calendarId,
        calendarName: result.calendarName,
        calendarUrl: result.calendarUrl
      });
    }

    // Helper function to process a course event (create schedule + save to DB)
    const processEvent = async (eventInfo, courseData, action = 'created') => {
      let userScheduleId = null;
      
      // If course was matched and has dbCourseId, create course_session and user_schedule
      if (courseData && courseData.dbCourseId) {
        try {
          // Parse time to get start_time and end_time
          const timeParts = (courseData.times || '').split('-');
          const startTime = timeParts[0]?.trim() || '09:00';
          const endTime = timeParts[1]?.trim() || '10:30';
          
          // Create or find course session
          const sessionResult = await sessionsRepo.findOrCreateSession({
            courseId: courseData.dbCourseId,
            instructor: courseData.instructor || courseData.dbInstructor || null,
            daysOfWeek: courseData.days || [],
            startTime: startTime,
            endTime: endTime,
            startDate: courseData.startDate,
            endDate: courseData.endDate,
            location: courseData.location || 'Room TBD',
            section: courseData.courseNo.split('-')[1] || null
          });
          
          if (sessionResult.success && sessionResult.data) {
            const sessionId = sessionResult.data.id;
            
            // For created events, add to schedule; for updated, update existing
            if (action === 'created') {
              const scheduleResult = await schedulesRepo.addCourseToSchedule(
                user.id,
                courseData.dbCourseId,
                sessionId
              );
              
              if (scheduleResult.success) {
                userScheduleId = scheduleResult.data.id;
              }
            } else if (action === 'updated') {
              // Find existing user_schedule for this course
              const { data: existingSchedule } = await supabase
                .from('user_schedules')
                .select('id')
                .eq('user_id', user.id)
                .eq('session_id', sessionId)
                .maybeSingle();
              
              if (existingSchedule) {
                userScheduleId = existingSchedule.id;
              }
            }
            
            // Update schedule as synced
            if (userScheduleId) {
              await supabase
                .from('user_schedules')
                .update({
                  calendar_synced: true,
                  calendar_synced_at: new Date().toISOString()
                })
                .eq('id', userScheduleId);
            }
          }
        } catch (scheduleError) {
          console.error(`Error processing schedule for ${eventInfo.courseNo}:`, scheduleError);
        }
      }

      return userScheduleId;
    };

    // Store created events in database
    if (result.created.length > 0) {
      for (const created of result.created) {
        try {
          const courseData = validCourses.find(c => c.courseNo === created.courseNo);
          const userScheduleId = await processEvent(created, courseData, 'created');
          
          // Insert new calendar event
          const { error: dbError } = await supabase.from('calendar_events').insert({
            user_id: user.id,
            user_schedule_id: userScheduleId,
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
            console.error('Failed to save created event to database:', dbError);
          } else {
            console.log(`✓ Saved created calendar event to database: ${created.eventId}`);
          }
        } catch (dbError) {
          console.error('Failed to save created event to database:', dbError);
        }
      }
    }

    // Update database records for updated events
    if (result.updated.length > 0) {
      for (const updated of result.updated) {
        try {
          const courseData = validCourses.find(c => c.courseNo === updated.courseNo);
          const userScheduleId = await processEvent(updated, courseData, 'updated');
          
          // Update existing calendar event record
          const { error: dbError } = await supabase
            .from('calendar_events')
            .update({
              user_schedule_id: userScheduleId,
              event_data: {
                courseNo: updated.courseNo,
                htmlLink: updated.htmlLink,
                courseData: courseData,
                calendarId: result.calendarId,
                calendarName: result.calendarName
              },
              synced_at: new Date().toISOString()
            })
            .eq('event_id', updated.eventId)
            .eq('user_id', user.id);
          
          if (dbError) {
            console.error('Failed to update event in database:', dbError);
          } else {
            console.log(`✓ Updated calendar event in database: ${updated.eventId}`);
          }
        } catch (dbError) {
          console.error('Failed to update event in database:', dbError);
        }
      }
    }

    // Mark database records as deleted for removed events (soft delete)
    if (result.deleted.length > 0) {
      for (const deleted of result.deleted) {
        try {
          // Soft delete: Update calendar_events record with deleted_at timestamp
          const { error: dbError } = await supabase
            .from('calendar_events')
            .update({ deleted_at: new Date().toISOString() })
            .eq('event_id', deleted.eventId)
            .eq('user_id', user.id)
            .is('deleted_at', null); // Only update if not already deleted
          
          if (dbError) {
            console.error('Failed to mark event as deleted in database:', dbError);
          } else {
            console.log(`✓ Marked calendar event as deleted in database: ${deleted.eventId}`);
          }
        } catch (dbError) {
          console.error('Failed to mark event as deleted in database:', dbError);
        }
      }
    }

    // Send confirmation email after events are successfully created/updated
    const hasChanges = result.totalCreated > 0 || result.totalUpdated > 0 || result.totalDeleted > 0;
    if (result.success && hasChanges) {
      try {
        // Generate email content with all changed courses
        const allChangedCourses = [
          ...result.created.map(c => ({ ...c, action: 'created' })),
          ...result.updated.map(c => ({ ...c, action: 'updated' })),
          ...result.deleted.map(c => ({ ...c, action: 'deleted' }))
        ];
        
        const emailContent = gmailService.generateCalendarEventsEmail(
          email,
          allChangedCourses.map(eventInfo => ({
            courseNo: eventInfo.courseNo,
            courseData: validCourses.find(c => c.courseNo === eventInfo.courseNo)
          })),
          result.calendarName || 'Spring 2026 schedule',
          result.calendarUrl || ''
        );

        // Send email asynchronously (don't block response)
        gmailService.sendEmail(email, emailContent.subject, emailContent.htmlBody, true)
          .then(async (emailResult) => {
            if (emailResult.success) {
              console.log(`Confirmation email sent successfully to ${email}`);
              
              // Save donation tracking record
              try {
                const { error: trackingError } = await supabase.from('donation_tracking').insert({
                  user_id: user.id,
                  email_sent_at: new Date().toISOString(),
                  campaign_id: 'calendar_events_confirmation'
                });
                
                if (trackingError) {
                  console.error('Failed to save donation tracking record:', trackingError);
                } else {
                  console.log('✓ Saved donation tracking record');
                }
              } catch (trackingErr) {
                console.error('Error saving donation tracking:', trackingErr);
              }
            } else {
              console.error(`Failed to send confirmation email to ${email}:`, emailResult.error);
            }
          })
          .catch(emailError => {
            console.error(`Error sending confirmation email to ${email}:`, emailError);
          });
      } catch (emailError) {
        // Log error but don't fail the request
        console.error('Error preparing email:', emailError);
      }
    }

    // Build response message
    const actionParts = [];
    if (result.totalCreated > 0) actionParts.push(`created ${result.totalCreated}`);
    if (result.totalUpdated > 0) actionParts.push(`updated ${result.totalUpdated}`);
    if (result.totalDeleted > 0) actionParts.push(`deleted ${result.totalDeleted}`);
    
    const message = result.unchanged
      ? 'Schedule unchanged - no updates needed'
      : result.success
        ? `Successfully ${actionParts.join(', ')} calendar event(s)`
        : `${actionParts.join(', ')} with ${result.totalFailed} failure(s)`;

    res.json({
      success: result.success,
      unchanged: result.unchanged || false,
      message: message,
      created: result.created,
      updated: result.updated || [],
      deleted: result.deleted || [],
      failed: result.failed,
      totalCreated: result.totalCreated,
      totalUpdated: result.totalUpdated || 0,
      totalDeleted: result.totalDeleted || 0,
      totalFailed: result.totalFailed,
      calendarId: result.calendarId,
      calendarName: result.calendarName,
      calendarUrl: result.calendarUrl
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

    // Soft delete from database (mark as deleted)
    const userResult = await usersRepo.getUserByEmail(email);
    if (userResult.success && userResult.data) {
      await supabase
        .from('calendar_events')
        .update({ deleted_at: new Date().toISOString() })
        .eq('user_id', userResult.data.id)
        .eq('event_id', eventId)
        .is('deleted_at', null); // Only update if not already deleted
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

/**
 * GET /api/calendar/check-existing
 * Check if user has existing calendar events in their Google Calendar
 * Query: ?email=user@example.com
 */
router.get('/check-existing', async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const userResult = await usersRepo.getUserByEmail(email);
    if (!userResult.success || !userResult.data) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.data;
    
    // Check if user has connected Google Calendar
    if (!user.google_calendar_connected) {
      return res.json({
        success: true,
        hasExistingSchedule: false,
        courseCount: 0,
        courses: []
      });
    }

    // First, try to find existing calendar from database (exclude soft-deleted)
    const { data: dbEvents } = await supabase
      .from('calendar_events')
      .select('event_data')
      .eq('user_id', user.id)
      .is('deleted_at', null) // Exclude soft-deleted events
      .limit(1);

    // If we have events in database, use the calendar name from there
    let calendarName = dbEvents && dbEvents.length > 0 && dbEvents[0].event_data?.calendarName
      ? dbEvents[0].event_data.calendarName
      : 'Spring 2026 schedule';

    console.log(`Checking for existing schedule in calendar: ${calendarName}`);

    // Get or create calendar with the determined name
    const calendarResult = await calendarService.getOrCreateCalendar(email, calendarName);
    if (!calendarResult.success) {
      throw new Error(calendarResult.error || 'Failed to access calendar');
    }

    const calendarId = calendarResult.calendarId;

    // Fetch existing events from Google Calendar (not database)
    const existingEventsResult = await calendarService.getExistingCalendarEvents(email, calendarId);
    
    if (!existingEventsResult.success) {
      throw new Error(existingEventsResult.error || 'Failed to fetch calendar events');
    }

    const existingEvents = existingEventsResult.data || [];
    const hasExistingSchedule = existingEvents.length > 0;
    
    console.log(`Found ${existingEvents.length} events in Google Calendar: ${calendarName}`);
    
    // Extract unique course numbers from events
    const existingCourses = existingEvents
      .map(event => event.courseNo)
      .filter(Boolean);

    res.json({
      success: true,
      hasExistingSchedule,
      courseCount: existingCourses.length,
      courses: existingCourses,
      calendarName: calendarName
    });

  } catch (error) {
    console.error('Error checking existing schedule:', error);
    res.status(500).json({ 
      error: 'Failed to check existing schedule',
      details: error.message 
    });
  }
});

module.exports = router;

