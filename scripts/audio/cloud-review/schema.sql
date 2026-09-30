CREATE TABLE IF NOT EXISTS review_batches (
  plan_hash TEXT PRIMARY KEY,
  chapter TEXT NOT NULL,
  scene TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  published_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE INDEX IF NOT EXISTS review_batches_active
  ON review_batches(active, published_at, chapter, scene);

CREATE TABLE IF NOT EXISTS review_decisions (
  decision_id TEXT PRIMARY KEY,
  plan_hash TEXT NOT NULL,
  review_key TEXT NOT NULL,
  target_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approve', 'rerecord')),
  note TEXT NOT NULL DEFAULT '',
  reviewer TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  FOREIGN KEY (plan_hash) REFERENCES review_batches(plan_hash)
);

CREATE INDEX IF NOT EXISTS review_decisions_batch
  ON review_decisions(plan_hash, decided_at, decision_id);

CREATE INDEX IF NOT EXISTS review_decisions_target
  ON review_decisions(plan_hash, review_key, decided_at, decision_id);
