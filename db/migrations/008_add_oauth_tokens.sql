-- ============================================
-- Migration: 008_add_oauth_tokens.sql
-- Description: Add Google OAuth tokens to users table for Calendar API integration
-- ============================================

-- Add OAuth token columns to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS google_access_token TEXT,
ADD COLUMN IF NOT EXISTS google_refresh_token TEXT,
ADD COLUMN IF NOT EXISTS google_token_expiry TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS google_calendar_connected BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS google_calendar_connected_at TIMESTAMP WITH TIME ZONE;

-- Create index for quick lookup of connected users
CREATE INDEX IF NOT EXISTS idx_users_calendar_connected ON users(google_calendar_connected);

-- Add comments for documentation
COMMENT ON COLUMN users.google_access_token IS 'Google OAuth2 access token for Calendar API';
COMMENT ON COLUMN users.google_refresh_token IS 'Google OAuth2 refresh token for token renewal';
COMMENT ON COLUMN users.google_token_expiry IS 'Expiration timestamp of the access token';
COMMENT ON COLUMN users.google_calendar_connected IS 'Whether user has connected their Google Calendar';
COMMENT ON COLUMN users.google_calendar_connected_at IS 'Timestamp when calendar was first connected';

-- ============================================
-- Migration Complete!
-- ============================================




