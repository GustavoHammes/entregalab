ALTER TABLE users ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN demo_expires_at timestamptz;
ALTER TABLE users ADD COLUMN demo_owner_id uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE projects ADD COLUMN is_demo boolean NOT NULL DEFAULT false;

CREATE TABLE notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  project_updates boolean NOT NULL DEFAULT true,
  task_changes boolean NOT NULL DEFAULT true,
  due_reminders boolean NOT NULL DEFAULT true
);
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('project', 'task', 'due')),
  title varchar(200) NOT NULL,
  body text NOT NULL,
  dedupe_key text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_project ON notifications(project_id);
CREATE INDEX idx_users_demo_expiry ON users(demo_expires_at) WHERE is_demo;
