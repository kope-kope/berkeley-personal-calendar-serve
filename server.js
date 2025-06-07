const express = require('express');
const multer = require('multer');
const { OpenAI } = require('openai');
const cors = require('cors');
require('dotenv').config();

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
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Main endpoint for table extraction
app.post('/api/extract-table', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
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
      const jsonMatch = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/({[\s\S]*})/);
      if (jsonMatch) {
        courses = JSON.parse(jsonMatch[1]);
      } else {
        // If no JSON block found, try to parse the entire response
        courses = JSON.parse(text);
      }
      
      // Log the parsed courses data
      console.log('Parsed courses data:', JSON.stringify(courses, null, 2));
      
    } catch (parseError) {
      console.error('Failed to parse JSON:', parseError);
      return res.status(500).json({ 
        error: 'Failed to parse the response from OpenAI',
        raw: text 
      });
    }

    // Log the final response being sent to frontend
    console.log('Sending response to frontend:', JSON.stringify({ courses }, null, 2));
    res.json({ courses });
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
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 