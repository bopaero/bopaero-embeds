-- bop Aero embed telemetry — AGGREGATE COUNTERS ONLY.
--
-- There is deliberately no table with one row per visit. Every beacon is folded
-- into counters on arrival and the payload is discarded, so the database cannot
-- describe an individual visit even in principle. That is what lets this sit
-- inside the "usage data / network activity" the existing privacy notice
-- already covers, and it is the distinction from the inherited session-replay
-- tracker this replaces.

CREATE TABLE IF NOT EXISTS metrics (        -- scalar counts
  day   TEXT NOT NULL,                      -- YYYY-MM-DD (UTC)
  path  TEXT NOT NULL,
  view  TEXT NOT NULL,                      -- 'phone' | 'desktop'
  name  TEXT NOT NULL,                      -- visits | scroll_25 | calc_run | ...
  n     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path, view, name)
);

CREATE TABLE IF NOT EXISTS bins (           -- click density, 20 x 40 grid
  day  TEXT NOT NULL,
  path TEXT NOT NULL,
  view TEXT NOT NULL,
  x    INTEGER NOT NULL,
  y    INTEGER NOT NULL,
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path, view, x, y)
);

CREATE TABLE IF NOT EXISTS controls (       -- clicks per named control
  day  TEXT NOT NULL,
  path TEXT NOT NULL,
  view TEXT NOT NULL,
  el   TEXT NOT NULL,
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path, view, el)
);

CREATE INDEX IF NOT EXISTS metrics_day  ON metrics(day);
CREATE INDEX IF NOT EXISTS bins_day     ON bins(day);
CREATE INDEX IF NOT EXISTS controls_day ON controls(day);
