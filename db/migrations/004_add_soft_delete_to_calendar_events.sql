-- Add deleted_at column to calendar_events table for soft delete functionality
-- This allows us to keep audit trail of deleted events

ALTER TABLE calendar_events 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- Create index on deleted_at for efficient querying
CREATE INDEX IF NOT EXISTS idx_calendar_events_deleted_at 
ON calendar_events(deleted_at) 
WHERE deleted_at IS NULL;

-- Add comment
COMMENT ON COLUMN calendar_events.deleted_at IS 'Timestamp when the event was soft deleted. NULL means event is active.';
