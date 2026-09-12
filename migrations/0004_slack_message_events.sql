CREATE TABLE slack_message_events (
  team_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_ts TEXT NOT NULL,
  event_ts TEXT,
  subtype TEXT,
  user_id TEXT,
  text TEXT,
  payload TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, event_id)
);
CREATE INDEX slack_message_events_message ON slack_message_events(team_id, channel_id, message_ts);
CREATE INDEX slack_message_events_received ON slack_message_events(team_id, received_at);
