-- ============================================
-- COMBINED MIGRATION: All Tables
-- Berkeley Personal Calendar Database Schema
-- ============================================
-- Run this entire file in Supabase SQL Editor
-- ============================================

-- Migration: 001_create_users_table.sql
-- Description: Create users table to store student information and preferences

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  timezone VARCHAR(50) DEFAULT 'America/Los_Angeles',
  notification_preference BOOLEAN DEFAULT true,
  donation_email_sent BOOLEAN DEFAULT false,
  donation_email_sent_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

-- Add comments for documentation
COMMENT ON TABLE users IS 'Stores Haas MBA student information and preferences';
COMMENT ON COLUMN users.email IS 'Student email address (unique identifier)';
COMMENT ON COLUMN users.timezone IS 'User timezone preference (default: Pacific Time)';
COMMENT ON COLUMN users.notification_preference IS 'Whether user wants to receive notifications';
COMMENT ON COLUMN users.donation_email_sent IS 'Whether donation request email has been sent';

-- ============================================

-- Migration: 002_create_courses_table.sql
-- Description: Create courses table to store Haas MBA course catalog

CREATE TABLE IF NOT EXISTS courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_code VARCHAR(50) NOT NULL,
  course_title TEXT NOT NULL,
  department VARCHAR(100),
  credits INTEGER,
  is_core BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  academic_year VARCHAR(20),
  semester VARCHAR(20),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure unique courses per academic term
  CONSTRAINT unique_course_per_term UNIQUE(course_code, academic_year, semester)
);

-- Create indexes for fast lookups and filtering
CREATE INDEX IF NOT EXISTS idx_courses_code ON courses(course_code);
CREATE INDEX IF NOT EXISTS idx_courses_year_semester ON courses(academic_year, semester);
CREATE INDEX IF NOT EXISTS idx_courses_department ON courses(department);
CREATE INDEX IF NOT EXISTS idx_courses_is_active ON courses(is_active);

-- Add comments for documentation
COMMENT ON TABLE courses IS 'Master catalog of all Haas MBA courses';
COMMENT ON COLUMN courses.course_code IS 'Course code (e.g., MBA210, EWMBA211)';
COMMENT ON COLUMN courses.is_core IS 'Whether this is a core required course';
COMMENT ON COLUMN courses.is_active IS 'Whether course is currently offered';
COMMENT ON COLUMN courses.academic_year IS 'Academic year (e.g., 2025-2026)';
COMMENT ON COLUMN courses.semester IS 'Semester (e.g., Spring, Fall)';

-- ============================================

-- Migration: 003_create_course_sessions_table.sql
-- Description: Create course_sessions table to store individual class meeting schedules

CREATE TABLE IF NOT EXISTS course_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  instructor VARCHAR(255),
  days_of_week TEXT[] NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  location VARCHAR(255),
  section VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure end time is after start time
  CONSTRAINT valid_time_range CHECK (end_time > start_time),
  -- Ensure end date is after start date
  CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_course_sessions_course ON course_sessions(course_id);
CREATE INDEX IF NOT EXISTS idx_course_sessions_instructor ON course_sessions(instructor);
CREATE INDEX IF NOT EXISTS idx_course_sessions_dates ON course_sessions(start_date, end_date);

-- Add comments for documentation
COMMENT ON TABLE course_sessions IS 'Individual class sessions with meeting times and locations';
COMMENT ON COLUMN course_sessions.days_of_week IS 'Array of day names (e.g., [''Monday'', ''Wednesday'', ''Friday''])';
COMMENT ON COLUMN course_sessions.start_time IS 'Class start time in 24-hour format';
COMMENT ON COLUMN course_sessions.end_time IS 'Class end time in 24-hour format';
COMMENT ON COLUMN course_sessions.start_date IS 'First day of class for the semester';
COMMENT ON COLUMN course_sessions.end_date IS 'Last day of class for the semester';
COMMENT ON COLUMN course_sessions.section IS 'Section identifier if multiple sections exist';

-- ============================================

-- Migration: 004_create_user_schedules_table.sql
-- Description: Create user_schedules table to link students with their enrolled courses

CREATE TABLE IF NOT EXISTS user_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES course_sessions(id) ON DELETE CASCADE,
  added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  calendar_synced BOOLEAN DEFAULT false,
  calendar_synced_at TIMESTAMP WITH TIME ZONE,
  
  -- Prevent duplicate enrollments
  CONSTRAINT unique_user_session UNIQUE(user_id, session_id)
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_schedules_user ON user_schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_user_schedules_course ON user_schedules(course_id);
CREATE INDEX IF NOT EXISTS idx_user_schedules_session ON user_schedules(session_id);
CREATE INDEX IF NOT EXISTS idx_user_schedules_synced ON user_schedules(calendar_synced);

-- Add comments for documentation
COMMENT ON TABLE user_schedules IS 'Junction table linking students to their enrolled course sessions';
COMMENT ON COLUMN user_schedules.calendar_synced IS 'Whether this course has been synced to user''s calendar';
COMMENT ON COLUMN user_schedules.calendar_synced_at IS 'Timestamp when calendar sync occurred';

-- ============================================

-- Migration: 005_create_extraction_history_table.sql
-- Description: Create extraction_history table to track image uploads and AI extraction attempts

CREATE TABLE IF NOT EXISTS extraction_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_url TEXT,
  extracted_data JSONB,
  extraction_status VARCHAR(50) DEFAULT 'pending',
  error_message TEXT,
  courses_extracted INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure valid status values
  CONSTRAINT valid_extraction_status CHECK (extraction_status IN ('pending', 'success', 'failed', 'partial'))
);

-- Create indexes for fast lookups and filtering
CREATE INDEX IF NOT EXISTS idx_extraction_user ON extraction_history(user_id);
CREATE INDEX IF NOT EXISTS idx_extraction_status ON extraction_history(extraction_status);
CREATE INDEX IF NOT EXISTS idx_extraction_created ON extraction_history(created_at DESC);

-- Create GIN index for JSONB data queries
CREATE INDEX IF NOT EXISTS idx_extraction_data ON extraction_history USING GIN (extracted_data);

-- Add comments for documentation
COMMENT ON TABLE extraction_history IS 'Tracks all image upload and course extraction attempts';
COMMENT ON COLUMN extraction_history.extracted_data IS 'Raw JSON data extracted from the image by GPT-4 Vision';
COMMENT ON COLUMN extraction_history.extraction_status IS 'Status: pending, success, failed, or partial';
COMMENT ON COLUMN extraction_history.courses_extracted IS 'Number of courses successfully extracted';
COMMENT ON COLUMN extraction_history.error_message IS 'Error details if extraction failed';

-- ============================================

-- Migration: 006_create_calendar_events_table.sql
-- Description: Create calendar_events table to track calendar event creation (for future calendar integration)

CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_schedule_id UUID NOT NULL REFERENCES user_schedules(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id VARCHAR(255),
  calendar_provider VARCHAR(50) NOT NULL,
  event_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  synced_at TIMESTAMP WITH TIME ZONE,
  
  -- Ensure valid calendar provider values
  CONSTRAINT valid_calendar_provider CHECK (calendar_provider IN ('google', 'outlook', 'apple', 'ics_download'))
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_calendar_events_user ON calendar_events(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_schedule ON calendar_events(user_schedule_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_provider ON calendar_events(calendar_provider);
CREATE INDEX IF NOT EXISTS idx_calendar_events_created ON calendar_events(created_at DESC);

-- Create GIN index for JSONB data queries
CREATE INDEX IF NOT EXISTS idx_calendar_event_data ON calendar_events USING GIN (event_data);

-- Add comments for documentation
COMMENT ON TABLE calendar_events IS 'Tracks calendar events created for each user schedule (prepares for Google/Outlook integration)';
COMMENT ON COLUMN calendar_events.event_id IS 'External calendar event ID from provider (Google/Outlook)';
COMMENT ON COLUMN calendar_events.calendar_provider IS 'Calendar provider: google, outlook, apple, or ics_download';
COMMENT ON COLUMN calendar_events.event_data IS 'Full event details in JSON format';
COMMENT ON COLUMN calendar_events.synced_at IS 'Timestamp when event was successfully synced';

-- ============================================

-- Migration: 007_create_donation_tracking_table.sql
-- Description: Create donation_tracking table to track donation campaign effectiveness

CREATE TABLE IF NOT EXISTS donation_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  email_opened BOOLEAN DEFAULT false,
  email_opened_at TIMESTAMP WITH TIME ZONE,
  donation_clicked BOOLEAN DEFAULT false,
  donation_clicked_at TIMESTAMP WITH TIME ZONE,
  donation_amount DECIMAL(10, 2),
  donation_completed BOOLEAN DEFAULT false,
  donation_completed_at TIMESTAMP WITH TIME ZONE,
  campaign_id VARCHAR(100),
  tracking_token UUID DEFAULT gen_random_uuid()
);

-- Create indexes for analytics and tracking
CREATE INDEX IF NOT EXISTS idx_donation_user ON donation_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_donation_tracking_token ON donation_tracking(tracking_token);
CREATE INDEX IF NOT EXISTS idx_donation_sent_at ON donation_tracking(email_sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_donation_completed ON donation_tracking(donation_completed, donation_completed_at);

-- Add comments for documentation
COMMENT ON TABLE donation_tracking IS 'Tracks donation email campaigns and user engagement for Kwara Education Trust Fund';
COMMENT ON COLUMN donation_tracking.tracking_token IS 'Unique token for tracking email opens and clicks';
COMMENT ON COLUMN donation_tracking.email_opened IS 'Whether user opened the donation email';
COMMENT ON COLUMN donation_tracking.donation_clicked IS 'Whether user clicked the donation link';
COMMENT ON COLUMN donation_tracking.donation_completed IS 'Whether user completed a donation';
COMMENT ON COLUMN donation_tracking.donation_amount IS 'Amount donated (if completed)';
COMMENT ON COLUMN donation_tracking.campaign_id IS 'Campaign identifier for A/B testing';

-- ============================================
-- Migration Complete!
-- All 7 tables have been created successfully
-- ============================================

