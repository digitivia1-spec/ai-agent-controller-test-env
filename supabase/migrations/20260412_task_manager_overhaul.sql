-- ============================================================
-- Task Manager Overhaul: New columns + tables
-- Run this in your Supabase SQL Editor
-- ============================================================

-- 1. New columns on tasks table
DO $$
BEGIN
    -- Sub-tasks
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'parent_task_id') THEN
        ALTER TABLE tasks ADD COLUMN parent_task_id UUID REFERENCES tasks(id) ON DELETE CASCADE;
    END IF;

    -- My Day
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'is_my_day') THEN
        ALTER TABLE tasks ADD COLUMN is_my_day BOOLEAN DEFAULT false;
        ALTER TABLE tasks ADD COLUMN my_day_user_id UUID;
        ALTER TABLE tasks ADD COLUMN my_day_date DATE;
    END IF;

    -- Recurring
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'recurrence') THEN
        ALTER TABLE tasks ADD COLUMN recurrence TEXT;  -- daily, weekdays, weekly, monthly, yearly, custom
    END IF;

    -- Category (color-coded)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'category') THEN
        ALTER TABLE tasks ADD COLUMN category TEXT;
        ALTER TABLE tasks ADD COLUMN category_color TEXT DEFAULT '#3b82f6';
    END IF;

    -- Notes (dedicated, separate from comments)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'notes') THEN
        ALTER TABLE tasks ADD COLUMN notes TEXT;
    END IF;

    -- Reminder
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'remind_at') THEN
        ALTER TABLE tasks ADD COLUMN remind_at TIMESTAMPTZ;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_my_day ON tasks(my_day_user_id, my_day_date) WHERE is_my_day = true;

-- 2. Task attachments
CREATE TABLE IF NOT EXISTS task_attachments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE NOT NULL,
    org_id UUID NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER,
    mime_type TEXT,
    uploaded_by UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id);

ALTER TABLE task_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their org's task attachments"
    ON task_attachments FOR ALL
    USING (org_id IN (SELECT org_id FROM organization_members WHERE user_id = auth.uid()));

-- 3. Storage bucket for task files
INSERT INTO storage.buckets (id, name, public)
VALUES ('task_attachments', 'task_attachments', false)
ON CONFLICT (id) DO NOTHING;

-- 4. Task categories predefined
CREATE TABLE IF NOT EXISTS task_categories (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    org_id UUID NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#3b82f6',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(org_id, name)
);

ALTER TABLE task_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their org's task categories"
    ON task_categories FOR ALL
    USING (org_id IN (SELECT org_id FROM organization_members WHERE user_id = auth.uid()));

-- Seed default categories
-- (will be created per-org on first use via JS)
