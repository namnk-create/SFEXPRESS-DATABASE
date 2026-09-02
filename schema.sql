-- SFEXPRESS DATABASE — Cloudflare D1 schema (v5)
-- Chạy: wrangler d1 execute sfexpress-db --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,   -- 'warehouses' | 'reportCategories' | 'config' | 'sgnss'
  value TEXT NOT NULL       -- JSON blob
);

CREATE TABLE IF NOT EXISTS employees (
  empId     TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  role      TEXT NOT NULL,     -- WA | SSM | VAN | BA
  warehouse TEXT,
  password  TEXT DEFAULT '',
  status    TEXT DEFAULT 'active',
  startDate TEXT,
  leaveDate TEXT DEFAULT '',
  zone      TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS records (
  id              TEXT PRIMARY KEY,
  date            TEXT NOT NULL,
  warehouse       TEXT NOT NULL,
  category        TEXT NOT NULL,   -- PU | DE | TC
  reportType      TEXT NOT NULL,
  empId           TEXT NOT NULL,
  empName         TEXT NOT NULL,
  values_json     TEXT NOT NULL,   -- JSON array of strings
  status          TEXT DEFAULT 'Đã nộp',
  submittedAt     TEXT NOT NULL,   -- ISO datetime, dùng để sort + cursor phân trang
  adjustments_json TEXT DEFAULT '[]',
  edits_json      TEXT DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_records_wh            ON records(warehouse);
CREATE INDEX IF NOT EXISTS idx_records_wh_rt          ON records(warehouse, reportType);
CREATE INDEX IF NOT EXISTS idx_records_submittedAt    ON records(submittedAt);

CREATE TABLE IF NOT EXISTS staff_log (
  id      TEXT PRIMARY KEY,  -- format: {warehouseCode}_{yyyy-mm-dd}
  ssm     INTEGER DEFAULT 0,
  wa      INTEGER DEFAULT 0,
  van     INTEGER DEFAULT 0,
  ba      INTEGER DEFAULT 0,
  leave   TEXT DEFAULT '',
  anomaly TEXT DEFAULT ''
);
