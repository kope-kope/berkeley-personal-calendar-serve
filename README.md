# Berkeley Personal Calendar Server

A backend server that converts course schedule images to calendar events using OpenAI's GPT-4 Vision API.

## Features

- Image upload and processing
- Course schedule extraction using GPT-4 Vision
- JSON response with structured course data
- **Supabase database integration** for data persistence
- **Google Sheets auto-sync** for course catalog management
- User tracking and extraction history
- CORS support for frontend integration
- Error handling and validation

## Architecture

- **Backend:** Node.js + Express
- **AI:** OpenAI GPT-4 Vision API
- **Database:** Supabase (PostgreSQL)
- **Storage:** Course catalog, user schedules, extraction history

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file:
   ```bash
   cp env.example .env
   ```
4. Configure environment variables in `.env`:
   ```
   OPENAI_API_KEY=your_openai_api_key_here
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_KEY=your_supabase_service_role_key_here
   SYNC_SECRET_TOKEN=your_secure_random_token_here
   PORT=3001
   ```
   
   Generate a secure token for Google Sheets sync:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

### Database Setup

5. Create a Supabase project at [supabase.com](https://supabase.com)
6. Run the database migrations in the Supabase SQL Editor (in order):
   - See `db/migrations/` folder for all migration files
   - Execute each `.sql` file in numerical order (001 through 007)
7. Verify database connection:
   ```bash
   npm run dev
   curl http://localhost:3001/api/health
   ```

For detailed database setup instructions, see [db/README.md](./db/README.md).

## Running the Server

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

The server will run on port 3001 by default.

## Testing with Postman

A complete Postman collection is available in the `postman/` folder for easy API testing and documentation:

- **Collection:** `postman/Berkeley-Calendar-API.postman_collection.json`
- **Environment:** `postman/Berkeley-Calendar-API.postman_environment.json`

Import these files into Postman to:
- Test all API endpoints
- View example requests and responses
- Generate API documentation
- Share with team members

See [postman/README.md](./postman/README.md) for detailed instructions.

## API Endpoints

### Health Check
```
GET /api/health
```
Returns server and database status.

**Response:**
```json
{
  "status": "ok",
  "database": "connected"
}
```

### Sync Courses from Google Sheets
```
POST /api/sync-courses
```
Synchronize course data from Google Sheets to Supabase database.

**Headers:**
- `Authorization: Bearer YOUR_SYNC_SECRET_TOKEN`
- `Content-Type: application/json`

**Request Body:**
```json
{
  "courses": [
    {
      "courseNo": "MBA201B-1A",
      "courseTitle": "Macroeconomics in the Global Economy",
      "units": "2",
      "instructor": "Tsivanidis, J",
      "startDate": "01/21/2026",
      "endDate": "03/04/2026",
      "days": "MW",
      "time": "9:00 AM - 11:00 AM",
      "location": "N470 Chou",
      "semester": "Spring"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Successfully synced 15 courses",
  "count": 15,
  "synced_at": "2026-01-01T12:00:00.000Z"
}
```

**Setup Guide:** See [GOOGLE_SHEETS_SYNC_SETUP.md](./GOOGLE_SHEETS_SYNC_SETUP.md) for automatic sync configuration.

### Extract Table
```
POST /api/extract-table
```
Upload an image to extract course information.

**Request:**
- Content-Type: multipart/form-data
- Body: 
  - `image` (file): Course schedule image
  - `email` (string): User email address

**Response:**
```json
{
  "courses": [
    {
      "courseNo": "MBA210",
      "courseTitle": "Corporate Finance",
      "instructor": "John Doe",
      "days": ["Monday", "Wednesday", "Friday"],
      "times": "14:00-15:30"
    }
  ],
  "userId": "uuid",
  "extractionSaved": true
}
```

## Error Handling

The server includes comprehensive error handling for:
- Invalid file types
- File size limits (5MB)
- API errors
- JSON parsing errors

## Frontend Integration

The server supports CORS and can be integrated with any frontend application. Example frontend code:

```javascript
const formData = new FormData();
formData.append('image', imageFile);
formData.append('email', 'student@berkeley.edu');

const response = await fetch('http://localhost:3001/api/extract-table', {
  method: 'POST',
  body: formData
});

const data = await response.json();
console.log('Extracted courses:', data.courses);
console.log('User ID:', data.userId);
```

## Database

This application uses Supabase for data persistence. The database stores:

- **Users:** Student information and preferences
- **Courses:** Master course catalog
- **Course Sessions:** Individual class schedules
- **User Schedules:** Enrolled courses per student
- **Extraction History:** AI processing tracking and analytics
- **Calendar Events:** Event metadata (for future calendar integration)
- **Donation Tracking:** Campaign effectiveness metrics

See [db/README.md](./db/README.md) for detailed database documentation.

## Google Sheets Auto-Sync

This server can automatically sync course data from Google Sheets to Supabase! 🎉

**Your Spreadsheet:** https://docs.google.com/spreadsheets/d/1B43IeniQtYNFBbqbTgA4lkrsxlASCXaSBEJLBeatN9o/edit

### Quick Setup

1. **Copy the Google Apps Script** from `google-sheets-sync.gs`
2. **Paste into your spreadsheet**: Extensions → Apps Script
3. **Configure** the 3 values at the top (API_URL, SECRET_TOKEN, SHEET_NAME)
4. **Add trigger**: Clock icon → + Add Trigger → onEdit → Save
5. **Test**: Click "📚 Course Sync" → "🔄 Sync Now" in your spreadsheet

### Features

- ✅ **Automatic sync** - Updates database whenever you edit the spreadsheet
- ✅ **Upsert logic** - Creates new courses or updates existing ones
- ✅ **Academic year detection** - Automatically calculates from start dates
- ✅ **Manual sync** - Custom menu for on-demand syncing
- ✅ **Status notifications** - Toast messages show sync results

### Documentation

- 📖 **Full Setup Guide:** [GOOGLE_SHEETS_SYNC_SETUP.md](./GOOGLE_SHEETS_SYNC_SETUP.md)
- 🚀 **Quick Reference:** [QUICK_SYNC_REFERENCE.md](./QUICK_SYNC_REFERENCE.md)
- 💻 **Apps Script:** [google-sheets-sync.gs](./google-sheets-sync.gs)

## Project Structure

```
berkeley-personal-calender-server/
├── db/
│   ├── client.js                    # Supabase client initialization
│   ├── migrations/                  # SQL migration files
│   │   ├── 001_create_users_table.sql
│   │   ├── 002_create_courses_table.sql
│   │   └── ... (7 total)
│   ├── repositories/                # Data access layer
│   │   ├── users.repository.js
│   │   ├── courses.repository.js   # Now with batch upsert!
│   │   ├── sessions.repository.js
│   │   ├── schedules.repository.js
│   │   └── extractions.repository.js
│   └── README.md                    # Database documentation
├── postman/                         # API testing collection
│   ├── Berkeley-Calendar-API.postman_collection.json
│   ├── Berkeley-Calendar-API.postman_environment.json
│   └── README.md
├── server.js                        # Main application server
├── google-sheets-sync.gs            # Google Apps Script for auto-sync
├── GOOGLE_SHEETS_SYNC_SETUP.md      # Detailed sync setup guide
├── QUICK_SYNC_REFERENCE.md          # Quick reference card
├── package.json
├── env.example                      # Environment variables template
└── README.md
```

## Contributing

This is a project for Haas MBA students to easily add their class schedules to their calendars.

**Goals:**
1. Enable seamless calendar integration for Haas MBA students
2. Support donations for [Kwara Education Trust Fund](https://kwaraetf.org/donations/kwaraetf/)

## Roadmap

- [x] AI-powered course extraction
- [x] Database integration
- [x] User tracking
- [x] Extraction history
- [x] **Google Sheets auto-sync for course catalog**
- [ ] Course sessions import from Google Sheets
- [ ] Google Calendar API integration
- [ ] Outlook Calendar API integration
- [ ] Donation email automation
- [ ] Mobile optimization
- [ ] 99.99% uptime deployment 