CREATE TABLE sync_encrypted_outbox(command_id TEXT PRIMARY KEY, envelope TEXT NOT NULL);
INSERT INTO schema_version VALUES(3);
