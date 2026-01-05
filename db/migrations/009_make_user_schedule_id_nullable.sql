-- ============================================
-- Migration: 009_make_user_schedule_id_nullable.sql
-- Description: Make user_schedule_id nullable in calendar_events table
-- Reason: We create calendar events directly without requiring user_schedules
-- ============================================

-- Make user_schedule_id nullable (since we create events directly)
ALTER TABLE calendar_events 
ALTER COLUMN user_schedule_id DROP NOT NULL;

-- Add comment
COMMENT ON COLUMN calendar_events.user_schedule_id IS 'Optional link to user_schedules table (nullable for direct event creation)';

-- ============================================
-- Migration Complete!
-- ============================================

