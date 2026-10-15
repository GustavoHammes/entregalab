ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
ALTER TABLE notification_preferences ADD COLUMN email_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE gmail_connection (
  id integer PRIMARY KEY CHECK (id = 1),
  sender citext NOT NULL,
  refresh_token_encrypted text NOT NULL,
  connected_by uuid REFERENCES users(id) ON DELETE SET NULL,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE gmail_oauth_flows (
  state_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verifier_encrypted text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
);
CREATE TABLE email_verifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email citext NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour',
  used_at timestamptz
);
CREATE INDEX idx_email_verifications_user ON email_verifications(user_id, created_at DESC);
CREATE TABLE email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id uuid UNIQUE REFERENCES notifications(id) ON DELETE CASCADE,
  verification_id uuid UNIQUE REFERENCES email_verifications(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  last_error text,
  provider_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CHECK ((notification_id IS NOT NULL)::int + (verification_id IS NOT NULL)::int = 1)
);
CREATE INDEX idx_email_outbox_pending ON email_outbox(next_attempt_at) WHERE status IN ('pending', 'processing');
CREATE TABLE email_daily_usage (
  day date PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0
);

CREATE FUNCTION enqueue_notification_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO email_outbox (user_id, notification_id)
    SELECT NEW.user_id, NEW.id FROM users u
    JOIN notification_preferences pref ON pref.user_id = u.id
    JOIN projects p ON p.id = NEW.project_id
    WHERE u.id = NEW.user_id AND NOT u.is_demo AND NOT p.is_demo
      AND u.email_verified_at IS NOT NULL AND pref.email_enabled;
  RETURN NEW;
END;
$$;
CREATE TRIGGER notification_email AFTER INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION enqueue_notification_email();
