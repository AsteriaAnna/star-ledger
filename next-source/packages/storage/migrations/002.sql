ALTER TABLE transactions ADD COLUMN posting_plan TEXT;
INSERT INTO schema_version VALUES(2);
