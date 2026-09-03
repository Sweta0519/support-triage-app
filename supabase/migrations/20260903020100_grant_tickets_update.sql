-- The previous migration added the tickets_update_staff RLS policy but
-- forgot the matching table-level grant -- Postgres requires both a GRANT
-- and a passing policy for an UPDATE to succeed, so every staff update was
-- failing with "permission denied for table tickets" regardless of RLS.
grant update on ticketing.tickets to authenticated;
