CREATE SCHEMA IF NOT EXISTS reporting;

CREATE TABLE IF NOT EXISTS reporting.report_runs (
    report_id TEXT PRIMARY KEY,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    gold_run_id TEXT NOT NULL,
    input_snapshot_id TEXT NOT NULL,
    rule_version TEXT NOT NULL,
    manifest_path TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    manifest JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS reporting.report_rows (
    report_id TEXT NOT NULL REFERENCES reporting.report_runs(report_id),
    household_id TEXT NOT NULL,
    dataset TEXT NOT NULL,
    row_key TEXT NOT NULL,
    payload JSONB NOT NULL,
    PRIMARY KEY (report_id, household_id, dataset, row_key)
);

CREATE INDEX IF NOT EXISTS ix_report_rows_household
    ON reporting.report_rows(household_id, report_id, dataset);
