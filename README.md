# Berkeley Personal Calendar Server

A backend server that converts course schedule images to calendar events using OpenAI's GPT-4 Vision API.

## Features

- Image upload and processing
- Course schedule extraction using GPT-4 Vision
- JSON response with structured course data
- CORS support for frontend integration
- Error handling and validation

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file:
   ```bash
   cp .env.example .env
   ```
4. Add your OpenAI API key to the `.env` file:
   ```
   OPENAI_API_KEY=your_api_key_here
   ```

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

## API Endpoints

### Health Check
```
GET /api/health
```
Returns server status.

### Extract Table
```
POST /api/extract-table
```
Upload an image to extract course information.

**Request:**
- Content-Type: multipart/form-data
- Body: image file with key 'image'

**Response:**
```json
{
  "courses": [
    {
      "courseNo": "CS61A",
      "courseTitle": "Structure and Interpretation of Computer Programs",
      "instructor": "John Doe",
      "days": ["Mon", "Wed"],
      "times": "14:00-15:30"
    }
  ]
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

const response = await fetch('http://localhost:3001/api/extract-table', {
  method: 'POST',
  body: formData
});

const data = await response.json();
``` 