-- Security scan 2026-10-11, M-1: the share table's INSERT grant covered
-- every column (`grant select, insert, update (revoked)` -- each privilege
-- takes its own column list, so only UPDATE was narrowed). A staff session
-- calling the Data API directly could choose the public token, set
-- expires_at years ahead (defeating the 30-day expiry) or backdate
-- created_at.
--
-- The app only ever inserts these five columns (app/lib/db/shares.ts);
-- id, token, revoked, created_at and expires_at always take their
-- defaults now.
revoke insert on ticketing.shared_ticket_summaries from authenticated;
grant insert (ticket_id, published_by, subject, status, summary)
  on ticketing.shared_ticket_summaries to authenticated;
