PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  category TEXT NOT NULL,
  year INTEGER NOT NULL CHECK (year BETWEEN 1900 AND 2200),
  description TEXT NOT NULL DEFAULT '',
  art_key TEXT,
  cover_path TEXT,
  is_published INTEGER NOT NULL DEFAULT 1 CHECK (is_published IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_featured INTEGER NOT NULL DEFAULT 0 CHECK (is_featured IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS projects_public_order_idx
  ON projects (is_published, sort_order, created_at);
CREATE INDEX IF NOT EXISTS projects_category_idx
  ON projects (category);

CREATE TABLE IF NOT EXISTS portfolio_disciplines (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  parent_id TEXT REFERENCES portfolio_disciplines(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS portfolio_disciplines_name_lower_idx
  ON portfolio_disciplines (name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS portfolio_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  portrait_path TEXT,
  hero_cover_path TEXT,
  show_all_work INTEGER NOT NULL DEFAULT 1 CHECK (show_all_work IN (0, 1)),
  site_content TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO portfolio_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS portfolio_admins (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  firebase_uid TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_media (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('gallery', 'model')),
  blob_url TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS project_media_project_order_idx
  ON project_media (project_id, kind, sort_order, created_at);
