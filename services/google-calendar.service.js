const { google } = require('googleapis');
const usersRepo = require('../db/repositories/users.repository');

/**
 * Google Calendar Service
 * Handles all Google Calendar API operations
 */

/**
 * Create an authenticated OAuth2 client for a user
 * @param {string} email - User email address
 * @returns {Promise<Object>} OAuth2 client or error
 */
async function getAuthenticatedClient(email) {
  try {
    const tokensResult = await usersRepo.getGoogleTokens(email);
    
    if (!tokensResult.success || !tokensResult.data) {
      return { success: false, error: 'User has not connected Google Calendar' };
    }

    const { accessToken, refreshToken, tokenExpiry } = tokensResult.data;

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
      expiry_date: new Date(tokenExpiry).getTime()
    });

    // Check if token needs refresh
    if (new Date(tokenExpiry) <= new Date()) {
      console.log('Access token expired, refreshing...');
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        
        // Update tokens in database
        await usersRepo.updateGoogleTokens(email, {
          access_token: credentials.access_token,
          refresh_token: credentials.refresh_token || refreshToken,
          token_expiry: new Date(credentials.expiry_date).toISOString()
        });

        oauth2Client.setCredentials(credentials);
      } catch (refreshError) {
        console.error('Failed to refresh token:', refreshError);
        return { success: false, error: 'Failed to refresh access token. Please reconnect your calendar.' };
      }
    }

    return { success: true, client: oauth2Client };
  } catch (error) {
    console.error('Error getting authenticated client:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Convert day name to RRULE day abbreviation
 * @param {string} dayName - Full day name (e.g., "Monday")
 * @returns {string} Day abbreviation (e.g., "MO")
 */
function dayToRRule(dayName) {
  const dayMap = {
    'Sunday': 'SU',
    'Monday': 'MO',
    'Tuesday': 'TU',
    'Wednesday': 'WE',
    'Thursday': 'TH',
    'Friday': 'FR',
    'Saturday': 'SA'
  };
  return dayMap[dayName] || dayName.substring(0, 2).toUpperCase();
}

/**
 * Parse time string to hours and minutes
 * Supports formats: "09:00 AM - 11:00 AM" or "09:00-11:00" (24h)
 * @param {string} timeStr - Time string
 * @returns {Object} { startHour, startMinute, endHour, endMinute }
 */
function parseTimeString(timeStr) {
  if (!timeStr) {
    return { startHour: 9, startMinute: 0, endHour: 10, endMinute: 0 };
  }

  // Handle 24-hour format "HH:MM-HH:MM"
  const match24h = timeStr.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (match24h) {
    return {
      startHour: parseInt(match24h[1], 10),
      startMinute: parseInt(match24h[2], 10),
      endHour: parseInt(match24h[3], 10),
      endMinute: parseInt(match24h[4], 10)
    };
  }

  // Handle 12-hour format "HH:MM AM/PM - HH:MM AM/PM"
  const match12h = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (match12h) {
    let startHour = parseInt(match12h[1], 10);
    const startMinute = parseInt(match12h[2], 10);
    const startPeriod = match12h[3].toUpperCase();
    
    let endHour = parseInt(match12h[4], 10);
    const endMinute = parseInt(match12h[5], 10);
    const endPeriod = match12h[6].toUpperCase();

    // Convert to 24-hour format
    if (startPeriod === 'PM' && startHour !== 12) startHour += 12;
    if (startPeriod === 'AM' && startHour === 12) startHour = 0;
    if (endPeriod === 'PM' && endHour !== 12) endHour += 12;
    if (endPeriod === 'AM' && endHour === 12) endHour = 0;

    return { startHour, startMinute, endHour, endMinute };
  }

  return { startHour: 9, startMinute: 0, endHour: 10, endMinute: 0 };
}

/**
 * Format datetime in LA timezone for Google Calendar API (RFC3339 format)
 * Creates a datetime string that represents the given date/time in LA timezone
 * @param {string} dateStr - Date string (YYYY-MM-DD)
 * @param {number} hour - Hour (0-23)
 * @param {number} minute - Minute (0-59)
 * @returns {string} RFC3339 formatted datetime string
 */
function formatDateTimeInLA(dateStr, hour, minute) {
  // Format as YYYY-MM-DDTHH:MM:SS (Google Calendar will interpret this as LA time when timeZone is specified)
  const h = hour.toString().padStart(2, '0');
  const m = minute.toString().padStart(2, '0');
  return `${dateStr}T${h}:${m}:00`;
}

/**
 * Calculate the first occurrence date for a recurring event
 * @param {string} startDateStr - Start date string (YYYY-MM-DD)
 * @param {Array<string>} daysOfWeek - Array of day names
 * @returns {Date} First occurrence date (YYYY-MM-DD format string)
 */
function calculateFirstOccurrence(startDateStr, daysOfWeek) {
  const startDate = new Date(startDateStr + 'T00:00:00');
  const startDayOfWeek = startDate.getDay();
  
  const dayIndices = {
    'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
    'Thursday': 4, 'Friday': 5, 'Saturday': 6
  };

  // Find the earliest day on or after the start date
  let minDaysToAdd = 7;
  for (const dayName of daysOfWeek) {
    const targetDay = dayIndices[dayName];
    let daysToAdd = targetDay - startDayOfWeek;
    if (daysToAdd < 0) daysToAdd += 7;
    if (daysToAdd < minDaysToAdd) minDaysToAdd = daysToAdd;
  }

  const firstOccurrence = new Date(startDate);
  firstOccurrence.setDate(startDate.getDate() + minDaysToAdd);
  
  // Return as YYYY-MM-DD string
  const year = firstOccurrence.getFullYear();
  const month = (firstOccurrence.getMonth() + 1).toString().padStart(2, '0');
  const day = firstOccurrence.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format date for RRULE UNTIL clause
 * @param {string} dateStr - Date string (YYYY-MM-DD)
 * @returns {string} Formatted date (YYYYMMDD)
 */
function formatRRuleUntil(dateStr) {
  return dateStr.replace(/-/g, '') + 'T235959Z';
}

/**
 * Create or get a calendar with the specified name
 * @param {string} email - User email
 * @param {string} calendarName - Name of the calendar (e.g., "Spring 2026 schedule")
 * @returns {Promise<Object>} Calendar ID or error
 */
async function getOrCreateCalendar(email, calendarName) {
  try {
    const clientResult = await getAuthenticatedClient(email);
    if (!clientResult.success) {
      return clientResult;
    }

    const calendar = google.calendar({ version: 'v3', auth: clientResult.client });

    // First, try to find an existing calendar with this name
    const calendarList = await calendar.calendarList.list();
    
    if (calendarList.data.items) {
      const existingCalendar = calendarList.data.items.find(
        cal => cal.summary === calendarName
      );
      
      if (existingCalendar) {
        console.log(`Found existing calendar: ${calendarName} (${existingCalendar.id})`);
        return { success: true, calendarId: existingCalendar.id };
      }
    }

    // Calendar doesn't exist, create it
    console.log(`Creating new calendar: ${calendarName}`);
    const newCalendar = await calendar.calendars.insert({
      requestBody: {
        summary: calendarName,
        description: `Course schedule calendar for ${calendarName}`,
        timeZone: 'America/Los_Angeles'
      }
    });

    console.log(`Created calendar: ${calendarName} (${newCalendar.data.id})`);
    return { success: true, calendarId: newCalendar.data.id };

  } catch (error) {
    console.error('Error getting/creating calendar:', error);
    return { 
      success: false, 
      error: error.message,
      details: error.response?.data?.error || null
    };
  }
}

/**
 * Create a recurring calendar event for a course
 * @param {string} email - User email
 * @param {Object} courseData - Course data with all required fields
 * @param {string} calendarId - Calendar ID to add event to (defaults to 'primary')
 * @returns {Promise<Object>} Created event or error
 */
async function createRecurringEvent(email, courseData, calendarId = 'primary') {
  try {
    const clientResult = await getAuthenticatedClient(email);
    if (!clientResult.success) {
      return clientResult;
    }

    const calendar = google.calendar({ version: 'v3', auth: clientResult.client });

    // Parse course data
    const {
      courseNo,
      courseTitle,
      instructor,
      location,
      startDate,
      endDate,
      days,        // Array of day names or string
      times,       // Time range string
      dbTime,      // Time from database
      notes
    } = courseData;

    // Determine days array
    const daysArray = Array.isArray(days) ? days : (days ? [days] : ['Monday']);
    
    // Parse time - prefer extracted times, fallback to database time
    const timeString = times || dbTime || '09:00-10:00';
    const { startHour, startMinute, endHour, endMinute } = parseTimeString(timeString);

    // Calculate first occurrence (returns YYYY-MM-DD string)
    const firstOccurrenceDate = calculateFirstOccurrence(startDate, daysArray);
    
    // Format datetime strings in LA timezone (Google Calendar interprets these as LA time)
    const eventStartDateTime = formatDateTimeInLA(firstOccurrenceDate, startHour, startMinute);
    const eventEndDateTime = formatDateTimeInLA(firstOccurrenceDate, endHour, endMinute);

    // Build RRULE
    const byDay = daysArray.map(dayToRRule).join(',');
    const until = formatRRuleUntil(endDate);
    const rrule = `RRULE:FREQ=WEEKLY;BYDAY=${byDay};UNTIL=${until}`;

    // Build event object
    const event = {
      summary: `${courseNo} - ${courseTitle}`,
      location: location || 'Room TBD',
      description: [
        `Instructor: ${instructor || 'TBD'}`,
        `Course: ${courseNo}`,
        `Dates: ${startDate} to ${endDate}`,
        notes ? `Notes: ${notes}` : ''
      ].filter(Boolean).join('\n'),
      start: {
        dateTime: eventStartDateTime,
        timeZone: 'America/Los_Angeles'
      },
      end: {
        dateTime: eventEndDateTime,
        timeZone: 'America/Los_Angeles'
      },
      recurrence: [rrule],
      reminders: {
        useDefault: true
      }
    };

    console.log('Creating calendar event:', JSON.stringify(event, null, 2));

    const response = await calendar.events.insert({
      calendarId: calendarId,
      resource: event
    });

    console.log('Event created:', response.data.id);

    return {
      success: true,
      data: {
        eventId: response.data.id,
        htmlLink: response.data.htmlLink,
        summary: response.data.summary,
        start: response.data.start,
        end: response.data.end
      }
    };
  } catch (error) {
    console.error('Error creating calendar event:', error);
    return { 
      success: false, 
      error: error.message,
      details: error.response?.data?.error || null
    };
  }
}

/**
 * Create multiple calendar events in batch
 * @param {string} email - User email
 * @param {Array<Object>} courses - Array of course data objects
 * @param {string} calendarName - Name of the calendar to create/use (default: "Spring 2026 schedule")
 * @returns {Promise<Object>} Results with created events and errors
 */
async function batchCreateEvents(email, courses, calendarName = 'Spring 2026 schedule') {
  const results = {
    success: true,
    created: [],
    failed: [],
    totalCreated: 0,
    totalFailed: 0,
    calendarId: null,
    calendarName: calendarName
  };

  // Get or create the calendar first
  const calendarResult = await getOrCreateCalendar(email, calendarName);
  if (!calendarResult.success) {
    return {
      success: false,
      error: `Failed to create/get calendar: ${calendarResult.error}`,
      created: [],
      failed: courses.map(c => ({ courseNo: c.courseNo, error: 'Calendar creation failed' })),
      totalCreated: 0,
      totalFailed: courses.length,
      calendarId: null,
      calendarName: calendarName
    };
  }

  results.calendarId = calendarResult.calendarId;

  // Create events in the calendar
  for (const course of courses) {
    try {
      const result = await createRecurringEvent(email, course, calendarResult.calendarId);
      
      if (result.success) {
        results.created.push({
          courseNo: course.courseNo,
          eventId: result.data.eventId,
          htmlLink: result.data.htmlLink
        });
        results.totalCreated++;
      } else {
        results.failed.push({
          courseNo: course.courseNo,
          error: result.error
        });
        results.totalFailed++;
      }
    } catch (error) {
      results.failed.push({
        courseNo: course.courseNo,
        error: error.message
      });
      results.totalFailed++;
    }
  }

  results.success = results.totalFailed === 0;
  return results;
}

/**
 * Delete a calendar event
 * @param {string} email - User email
 * @param {string} eventId - Google Calendar event ID
 * @returns {Promise<Object>} Result
 */
async function deleteEvent(email, eventId) {
  try {
    const clientResult = await getAuthenticatedClient(email);
    if (!clientResult.success) {
      return clientResult;
    }

    const calendar = google.calendar({ version: 'v3', auth: clientResult.client });

    await calendar.events.delete({
      calendarId: 'primary',
      eventId: eventId
    });

    return { success: true, message: 'Event deleted successfully' };
  } catch (error) {
    console.error('Error deleting calendar event:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Normalize and validate course data
 * @param {Object} course - Raw course data
 * @returns {Object} Normalized course data
 */
function normalizeCourse(course) {
  const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const normalized = { ...course };
  
  // Parse times if not already split
  if (course.times && (!course.startTime || !course.endTime)) {
    const parts = course.times.split(' - ').map(t => t.trim());
    normalized.startTime = parts[0] || '9:00 AM';
    normalized.endTime = parts[1] || '10:00 AM';
  }
  
  // Ensure all fields exist with defaults
  normalized.location = normalized.location || 'Room TBD';
  normalized.startDate = normalized.startDate || '2025-08-28';
  normalized.endDate = normalized.endDate || '2025-12-05';
  normalized.startTime = normalized.startTime || '9:00 AM';
  normalized.endTime = normalized.endTime || '10:00 AM';
  
  // Ensure days is always an array of full day names
  if (Array.isArray(normalized.days)) {
    // Filter to only valid full day names and sort by day of week order
    normalized.days = normalized.days
      .filter(day => DAYS_OF_WEEK.includes(day))
      .sort((a, b) => DAYS_OF_WEEK.indexOf(a) - DAYS_OF_WEEK.indexOf(b));
  } else if (normalized.days) {
    // Convert string to array if needed
    const dayStr = String(normalized.days).trim();
    if (DAYS_OF_WEEK.includes(dayStr)) {
      normalized.days = [dayStr];
    } else {
      // Try to parse comma-separated days
      const parsedDays = dayStr.split(',').map(d => d.trim()).filter(d => DAYS_OF_WEEK.includes(d));
      normalized.days = parsedDays.length > 0 ? parsedDays.sort((a, b) => DAYS_OF_WEEK.indexOf(a) - DAYS_OF_WEEK.indexOf(b)) : ['Monday'];
    }
  } else {
    normalized.days = ['Monday'];
  }
  
  return normalized;
}

/**
 * Generate preview events for courses (without creating them)
 * @param {Array<Object>} courses - Array of normalized course data
 * @returns {Array<Object>} Preview event objects
 */
function generateEventPreview(courses) {
  const events = [];
  
  courses.forEach(course => {
    const normalized = normalizeCourse(course);
    if (!normalized.days || normalized.days.length === 0) return;
    
    // Parse time strings to hours/minutes for display
    const parseTimeForPreview = (timeStr) => {
      if (!timeStr) return { hours: 9, minutes: 0 };
      try {
        const [time, period] = timeStr.split(' ');
        if (!time || !period) return { hours: 9, minutes: 0 };
        let [hours, minutes] = time.split(':').map(Number);
        if (isNaN(hours) || isNaN(minutes)) return { hours: 9, minutes: 0 };
        if (period === 'PM' && hours !== 12) hours += 12;
        else if (period === 'AM' && hours === 12) hours = 0;
        return { hours, minutes };
      } catch {
        return { hours: 9, minutes: 0 };
      }
    };
    
    const start = parseTimeForPreview(normalized.startTime);
    const end = parseTimeForPreview(normalized.endTime);
    
    const days = Array.isArray(normalized.days) ? normalized.days : [normalized.days];
    
    days.forEach(day => {
      events.push({
        id: `${normalized.courseNo}-${day}`,
        courseNo: normalized.courseNo,
        title: normalized.courseTitle,
        instructor: normalized.instructor,
        location: normalized.location || 'TBD',
        day,
        startTime: normalized.startTime,
        endTime: normalized.endTime,
        startDate: normalized.startDate,
        endDate: normalized.endDate,
        start,
        end,
      });
    });
  });
  
  return events;
}

/**
 * Generate ICS file content for courses
 * @param {Array<Object>} courses - Array of course data objects
 * @returns {string} ICS file content
 */
function generateICSContent(courses) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Berkeley Haas Schedule Converter//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-TIMEZONE:America/Los_Angeles'
  ];

  for (const course of courses) {
    const {
      courseNo,
      courseTitle,
      instructor,
      location,
      startDate,
      endDate,
      days,
      times,
      dbTime
    } = course;

    const daysArray = Array.isArray(days) ? days : (days ? [days] : ['Monday']);
    const timeString = times || dbTime || '09:00-10:00';
    const { startHour, startMinute, endHour, endMinute } = parseTimeString(timeString);
    
    const firstOccurrenceDate = calculateFirstOccurrence(startDate, daysArray);
    
    // Format dates for ICS (YYYYMMDDTHHMMSS) in LA timezone
    // ICS format: YYYYMMDDTHHMMSS (no timezone suffix when using TZID)
    const formatICSDate = (dateStr, hour, minute) => {
      const h = hour.toString().padStart(2, '0');
      const m = minute.toString().padStart(2, '0');
      return dateStr.replace(/-/g, '') + 'T' + h + m + '00';
    };

    const dtstart = formatICSDate(firstOccurrenceDate, startHour, startMinute);
    const dtend = formatICSDate(firstOccurrenceDate, endHour, endMinute);
    const until = endDate.replace(/-/g, '') + 'T235959Z';
    const byDay = daysArray.map(dayToRRule).join(',');

    // Generate unique ID
    const uid = `${courseNo.replace(/[^a-zA-Z0-9]/g, '')}-${Date.now()}@berkeleyhaas.edu`;

    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
      `DTSTART;TZID=America/Los_Angeles:${dtstart}`,
      `DTEND;TZID=America/Los_Angeles:${dtend}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${byDay};UNTIL=${until}`,
      `SUMMARY:${courseNo} - ${courseTitle}`,
      `LOCATION:${location || 'Room TBD'}`,
      `DESCRIPTION:Instructor: ${instructor || 'TBD'}\\nCourse: ${courseNo}\\nDates: ${startDate} to ${endDate}`,
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

module.exports = {
  getAuthenticatedClient,
  getOrCreateCalendar,
  createRecurringEvent,
  batchCreateEvents,
  deleteEvent,
  generateICSContent,
  normalizeCourse,
  generateEventPreview
};

