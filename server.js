const express = require('express');
const multer = require('multer');
const { OpenAI } = require('openai');
const cors = require('cors');
require('dotenv').config();

// Import database repositories
const { testConnection } = require('./db/client');
const usersRepo = require('./db/repositories/users.repository');
const coursesRepo = require('./db/repositories/courses.repository');
const sessionsRepo = require('./db/repositories/sessions.repository');
const schedulesRepo = require('./db/repositories/schedules.repository');
const extractionsRepo = require('./db/repositories/extractions.repository');

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
app.use(cors());
app.use(express.json());

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

    // Get user email from request body (optional)
    const userEmail = req.body.email;
    let user = null;
    
    // Create or get user if email is provided
    if (userEmail) {
      const userResult = await usersRepo.createOrUpdateUser(userEmail);
      if (!userResult.success) {
        console.error('Failed to create/update user:', userResult.error);
        // Continue without user - don't fail the request
        console.log('Continuing without user association');
      } else {
        user = userResult.data;
      }
    }

    const imageBuffer = req.file.buffer;
    const base64Image = `data:${req.file.mimetype};base64,${imageBuffer.toString('base64')}`;

    const prompt = `
      Extract the table of courses from this image. 
      Return a JSON array with fields: courseNo, courseTitle, instructor, days, times.
      Only include actual course rows, skip headers and section titles.
      
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
      
      // Save extraction to database (only if user is provided)
      if (user) {
        const extractionResult = await extractionsRepo.saveExtraction(
          user.id,
          courses,
          'success',
          null,
          null
        );

        if (!extractionResult.success) {
          console.error('Failed to save extraction history:', extractionResult.error);
        }
      } else {
        console.log('Skipping extraction history save - no user provided');
      }

      // Process each extracted course and add to user schedule
      const processedCourses = [];
      for (const course of courses) {
        try {
          // For now, we'll just return the extracted data
          // In the future, we can match against existing courses in the database
          processedCourses.push({
            ...course,
            matched: false, // Will be true when we implement course matching
            scheduleId: null // Will contain schedule ID when matched and added
          });
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

    // Log the final response being sent to frontend
    console.log('Sending response to frontend:', JSON.stringify({ courses }, null, 2));
    res.json({ 
      courses,
      userId: user ? user.id : null,
      extractionSaved: user !== null
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