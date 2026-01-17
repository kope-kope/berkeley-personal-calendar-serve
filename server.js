const express = require('express');
const multer = require('multer');
const { OpenAI } = require('openai');
const cors = require('cors');
require('dotenv').config();

// Import database repositories
const { testConnection, supabase } = require('./db/client');
const usersRepo = require('./db/repositories/users.repository');
const coursesRepo = require('./db/repositories/courses.repository');
const sessionsRepo = require('./db/repositories/sessions.repository');
const schedulesRepo = require('./db/repositories/schedules.repository');
const extractionsRepo = require('./db/repositories/extractions.repository');

// Import routes
const authRoutes = require('./routes/auth.routes');
const calendarRoutes = require('./routes/calendar.routes');
const coursesRoutes = require('./routes/courses.routes');

const app = express();
const upload = multer({
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Middleware
// CORS configuration to allow specific origins
const allowedOrigins = [
  'http://localhost:3002', // Local dev frontend
  process.env.FRONTEND_URL, // Production frontend from Vercel
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null, // Vercel preview deployments
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || 
        process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json());

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/courses', coursesRoutes);

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const dbConnected = await testConnection();
  res.json({ 
    status: 'ok',
    database: dbConnected ? 'connected' : 'disconnected'
  });
});

// Google Sheets sync endpoint
app.post('/api/sync-courses', async (req, res) => {
  try {
    // Validate authorization token
    const authHeader = req.headers.authorization;
    const expectedToken = process.env.SYNC_SECRET_TOKEN || 'your-secret-token-here';
    
    if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { courses } = req.body;
    
    if (!courses || !Array.isArray(courses)) {
      return res.status(400).json({ error: 'Invalid request: courses array is required' });
    }

    // Transform Google Sheets data to match new simplified database schema
    const transformedCourses = courses
      .filter(course => course.courseNo) // Only process rows with course number
      .map(course => ({
        course_no: course.courseNo,
        course_title: course.courseTitle,
        units: course.units || null,
        instructor: course.instructor || null,
        start_date: course.startDate || null,
        end_date: course.endDate || null,
        days: course.days || null,
        time: course.time || null,
        notes: course.notes || null,
        location: course.location || null,
        semester: course.semester || null
      }));

    // Batch upsert courses
    const result = await coursesRepo.batchUpsertCourses(transformedCourses);
    
    if (!result.success) {
      return res.status(500).json({ 
        error: 'Failed to sync courses',
        details: result.error 
      });
    }

    res.json({ 
      success: true,
      message: result.message,
      count: result.count,
      synced_at: new Date().toISOString()
    });

  } catch (err) {
    console.error('Error syncing courses:', err);
    res.status(500).json({ 
      error: 'Failed to sync courses',
      details: err.message 
    });
  }
});

// Main endpoint for table extraction
app.post('/api/extract-table', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    // Debug: Log entire request body to see what's being received
    console.log('Request body keys:', Object.keys(req.body));
    console.log('Request body:', req.body);
    
    // Get user email from request body (optional)
    // Multer parses form fields into req.body when using multipart/form-data
    const userEmail = req.body.email;
    let user = null;
    
    console.log('Extract table request - email:', userEmail || 'not provided');
    if (!userEmail) {
      console.warn('⚠️ Email not provided in request body. FormData keys:', Object.keys(req.body));
    }
    
    // Create or get user if email is provided
    if (userEmail) {
      const userResult = await usersRepo.createOrUpdateUser(userEmail);
      if (!userResult.success) {
        console.error('Failed to create/update user:', userResult.error);
        // Continue without user - don't fail the request
        console.log('Continuing without user association');
      } else {
        user = userResult.data;
        console.log('✓ User found/created:', user.id, userEmail);
      }
    } else {
      console.log('⚠ No email provided - extraction history will not be saved');
    }

    const imageBuffer = req.file.buffer;
    const base64Image = `data:${req.file.mimetype};base64,${imageBuffer.toString('base64')}`;

    const prompt = `
      Extract the table of courses from this schedule image.
      Return a JSON array with fields: courseNo, courseTitle, instructor, days, times.
      Only include actual course rows, skip headers and section titles.
      
      IMPORTANT: Preserve the exact course code format as shown in the image.
      Course codes may appear in various formats (e.g., "MBA296.90T", "MBA210B.1", "MBA212A-2").
      Do NOT modify the course code format - extract it exactly as it appears.
      
      For the days field:
      - Convert abbreviations to full day names
      - M = Monday
      - T = Tuesday
      - W = Wednesday
      - TH = Thursday
      - F = Friday
      - S = Saturday
      - SU = Sunday
      
      Examples of day conversions:
      - "MWF" should be ["Monday", "Wednesday", "Friday"]
      - "TTH" should be ["Tuesday", "Thursday"]
      - "M" should be ["Monday"]
      
      Format the times as a string in 24-hour format (e.g., "14:00-15:30").
      
      Example response format:
      [
        {"courseNo": "MBA296.90T", "courseTitle": "Course Title", "instructor": "Instructor Name", "days": ["Monday", "Wednesday"], "times": "14:00-15:30"},
        {"courseNo": "MBA210B.1", "courseTitle": "Another Course", "instructor": "Another Instructor", "days": ["Tuesday", "Thursday"], "times": "09:00-10:30"}
      ]
    `;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { 
          role: 'system', 
          content: 'You are a helpful assistant that extracts course information from images. Return the data in valid JSON format.' 
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: base64Image } }
          ]
        }
      ],
      max_tokens: 1000,
    });

    // Extract JSON from the response
    const text = response.choices[0].message.content;
    let courses = [];
    let processedCourses = [];
    let matchResult = { success: false, data: { matchCount: 0, unmatchedCount: 0, unmatched: [] } };
    let extractionId = null;
    
    // Save extraction history immediately (before processing) to get extractionId
    if (user) {
      const initialExtractionResult = await extractionsRepo.saveExtraction(
        user.id,
        { rawOpenAIResponse: text }, // Save raw response initially
        'pending', // Status will be updated after processing
        null,
        null
      );
      
      if (initialExtractionResult.success) {
        extractionId = initialExtractionResult.data.id;
        console.log('✓ Saved initial extraction history record:', extractionId);
      } else {
        console.error('Failed to save initial extraction history:', initialExtractionResult.error);
      }
    }
    
    try {
      // Try to parse JSON from the response
      const jsonMatch = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/({[\s\S]*}|\[[\s\S]*\])/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        courses = Array.isArray(parsed) ? parsed : [parsed];
      } else {
        // If no JSON block found, try to parse the entire response
        const parsed = JSON.parse(text);
        courses = Array.isArray(parsed) ? parsed : [parsed];
      }
      
      // Log the parsed courses data
      console.log('Parsed courses data:', JSON.stringify(courses, null, 2));

      // Match extracted courses against database
      const courseNumbers = courses.map(c => c.courseNo).filter(Boolean);
      matchResult = await coursesRepo.matchCoursesByNumbers(courseNumbers);
      
      // Create a map of matched courses for quick lookup (using normalized course_no from DB)
      const matchedCoursesMap = {};
      if (matchResult.success && matchResult.data.matched) {
        matchResult.data.matched.forEach(dbCourse => {
          matchedCoursesMap[dbCourse.course_no] = dbCourse;
        });
      }

      // Helper to normalize course number (convert dots to hyphens for database lookup)
      // Handles various formats from different schedule sources:
      // - "MBA296.90T" -> "MBA296-90T" (non-OLR format with letters after section number)
      // - "MBA210B.1" -> "MBA210B-1" (standard OLR format)
      // - "MBA212A.2" -> "MBA212A-2"
      // This normalizes the format to match our database format (which uses hyphens)
      const normalizeCourseNo = (courseNo) => {
        if (!courseNo) return courseNo;
        // Convert dots to hyphens for section numbers
        // Pattern matches: .digits, .digits+letters (e.g., .90T, .1, .2A)
        // This handles both OLR format (MBA210B.1) and non-OLR formats (MBA296.90T)
        return courseNo.replace(/\.(\d+[A-Z]*)$/, '-$1').trim();
      };

      // Helper to convert day abbreviations to full day names array
      // Handles: M, T, W, Th, F, S, Su, MW, TTH, MWF, etc.
      const convertDaysToArray = (daysStr) => {
        if (!daysStr) return [];
        if (Array.isArray(daysStr)) {
          // Already an array, check if they're full names or abbreviations
          return daysStr.map(day => {
            const dayMap = {
              'M': 'Monday', 'T': 'Tuesday', 'W': 'Wednesday',
              'Th': 'Thursday', 'F': 'Friday', 'S': 'Saturday', 'Su': 'Sunday'
            };
            return dayMap[day] || day;
          });
        }

        // Convert to uppercase for case-insensitive matching
        const daysUpper = daysStr.toString().toUpperCase().trim();

        // Handle common combinations first (case-insensitive)
        const combinations = {
          'MW': ['Monday', 'Wednesday'],
          'TTH': ['Tuesday', 'Thursday'],
          'TT': ['Tuesday', 'Thursday'], // Alternative format
          'MWF': ['Monday', 'Wednesday', 'Friday']
        };

        if (combinations[daysUpper]) {
          return combinations[daysUpper];
        }

        // Handle string abbreviations
        const dayMap = {
          'M': 'Monday',
          'T': 'Tuesday',
          'W': 'Wednesday',
          'TH': 'Thursday',
          'F': 'Friday',
          'S': 'Saturday',
          'SU': 'Sunday'
        };

        // Parse individual characters
        const result = [];
        let i = 0;
        while (i < daysUpper.length) {
          // Check for "TH" first (2 characters)
          if (i + 1 < daysUpper.length && daysUpper.substring(i, i + 2) === 'TH') {
            result.push('Thursday');
            i += 2;
          } else if (i + 1 < daysUpper.length && daysUpper.substring(i, i + 2) === 'SU') {
            result.push('Sunday');
            i += 2;
          } else {
            const char = daysUpper[i];
            if (dayMap[char]) {
              result.push(dayMap[char]);
            }
            i++;
          }
        }

        return result;
      };

      // Process each extracted course and enrich with database data
      for (const course of courses) {
        try {
          // Extract courseNo from either format (string or object)
          const courseNo = typeof course === 'string' ? course : (course.courseNo || course);
          if (!courseNo) continue;
          
          // Normalize the extracted courseNo to match database format (MBA210B.1 -> MBA210B-1)
          const normalizedCourseNo = normalizeCourseNo(courseNo);
          const dbCourse = matchedCoursesMap[normalizedCourseNo];
          
          if (dbCourse) {
            // Convert database days (e.g., "MW") to array of full day names (e.g., ["Monday", "Wednesday"])
            const dbDaysArray = convertDaysToArray(dbCourse.days);
            
            // Course matched - use database data as source of truth
            processedCourses.push({
              courseNo: courseNo, // Keep original format
              matched: true,
              dbCourseId: dbCourse.id,
              // All data comes from database
              courseTitle: dbCourse.course_title,
              location: dbCourse.location || 'Room TBD',
              startDate: dbCourse.start_date,
              endDate: dbCourse.end_date,
              days: dbDaysArray, // Convert DB days to array
              times: dbCourse.time,
              instructor: dbCourse.instructor,
              dbDays: dbCourse.days, // Keep original DB format for reference
              dbTime: dbCourse.time,
              dbInstructor: dbCourse.instructor,
              semester: dbCourse.semester,
              units: dbCourse.units,
              notes: dbCourse.notes
            });
          } else {
            // Course not matched - use extracted data as fallback
            // Convert extracted days to array if needed
            const extractedDays = Array.isArray(course.days) ? course.days : convertDaysToArray(course.days || '');
            
            processedCourses.push({
              courseNo: courseNo, // Keep original format (with dots)
              matched: false,
              dbCourseId: null,
              // Use extracted data as fallback (since course not in database)
              courseTitle: course.courseTitle || null,
              location: course.location || 'Room TBD',
              startDate: course.startDate || null,
              endDate: course.endDate || null,
              days: extractedDays,
              times: course.times || null,
              instructor: course.instructor || null,
              warning: `Course "${courseNo}" not found in database. Showing extracted data from image. Normalized format (${normalizedCourseNo}) may need to be synced from Google Sheets.`
            });
          }
        } catch (courseError) {
          console.error('Error processing course:', courseError);
        }
      }
      
    } catch (parseError) {
      console.error('Failed to parse JSON:', parseError);
      
      // Save failed extraction (only if user is provided)
      if (user) {
        await extractionsRepo.saveExtraction(
          user.id,
          { raw: text },
          'failed',
          parseError.message,
          null
        );
      }
      
      return res.status(500).json({ 
        error: 'Failed to parse the response from OpenAI',
        raw: text 
      });
    }

    // Update extraction history with processed courses (only if user is provided)
    // We save both raw OpenAI extraction and processed courses
    if (user && extractionId) {
      // Update the extraction record with both raw and processed data
      const { error: updateError } = await supabase
        .from('extraction_history')
        .update({
          extraction_status: 'success', // Update status to success
          extracted_data: {
            rawOpenAIResponse: courses, // Raw extraction from OpenAI
            processedCourses: processedCourses, // Processed/enriched courses
            matchStats: matchResult.success ? {
              matched: matchResult.data.matchCount,
              unmatched: matchResult.data.unmatchedCount,
              unmatchedCourses: matchResult.data.unmatched
            } : null
          },
          courses_extracted: processedCourses.length
        })
        .eq('id', extractionId);

      if (updateError) {
        console.error('Failed to update extraction history with processed data:', updateError);
      } else {
        console.log('✓ Updated extraction history with processed courses');
      }
    } else if (user && !extractionId) {
      // Fallback: Save extraction if we didn't save it earlier
      const extractionResult = await extractionsRepo.saveExtraction(
        user.id,
        {
          rawOpenAIResponse: courses,
          processedCourses: processedCourses,
          matchStats: matchResult.success ? {
            matched: matchResult.data.matchCount,
            unmatched: matchResult.data.unmatchedCount,
            unmatchedCourses: matchResult.data.unmatched
          } : null
        },
        'success',
        null,
        null
      );

      if (!extractionResult.success) {
        console.error('Failed to save extraction history:', extractionResult.error);
      } else {
        console.log('✓ Saved extraction history to database');
      }
    }

    // Log the final response being sent to frontend
    console.log('Sending response to frontend:', JSON.stringify({ courses: processedCourses }, null, 2));
    res.json({ 
      courses: processedCourses,
      userId: user ? user.id : null,
      extractionSaved: user !== null,
      matchStats: matchResult.success ? {
        matched: matchResult.data.matchCount,
        unmatched: matchResult.data.unmatchedCount,
        unmatchedCourses: matchResult.data.unmatched
      } : null
    });
  } catch (err) {
    console.error('Error processing request:', err);
    res.status(500).json({ 
      error: 'Failed to extract table',
      details: err.message 
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!',
    details: err.message 
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  
  // Test database connection on startup
  console.log('Testing database connection...');
  const connected = await testConnection();
  if (!connected) {
    console.warn('⚠️  Warning: Database connection failed. Please check your Supabase credentials.');
  }
}); 