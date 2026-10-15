CREATE TABLE project_progress_daily (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  day date NOT NULL,
  total integer NOT NULL CHECK (total >= 0),
  completed integer NOT NULL CHECK (completed >= 0 AND completed <= total),
  PRIMARY KEY (project_id, day)
);

CREATE FUNCTION snapshot_project_progress(target uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO project_progress_daily (project_id, day, total, completed)
    SELECT p.id, (now() AT TIME ZONE 'America/Sao_Paulo')::date,
      count(t.id)::int, count(t.id) FILTER (WHERE t.status = 'done')::int
    FROM projects p LEFT JOIN tasks t ON t.project_id = p.id WHERE p.id = target GROUP BY p.id
  ON CONFLICT (project_id, day) DO UPDATE SET total = excluded.total, completed = excluded.completed;
$$;
CREATE FUNCTION update_project_progress() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'projects' THEN
    PERFORM snapshot_project_progress(NEW.id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM snapshot_project_progress(OLD.project_id);
  ELSE
    PERFORM snapshot_project_progress(NEW.project_id);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER project_progress_initial AFTER INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION update_project_progress();
CREATE TRIGGER project_progress_tasks AFTER INSERT OR DELETE OR UPDATE OF status ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_project_progress();

INSERT INTO project_progress_daily (project_id, day, total, completed)
  SELECT p.id, (now() AT TIME ZONE 'America/Sao_Paulo')::date,
    count(t.id)::int, count(t.id) FILTER (WHERE t.status = 'done')::int
  FROM projects p LEFT JOIN tasks t ON t.project_id = p.id GROUP BY p.id;
