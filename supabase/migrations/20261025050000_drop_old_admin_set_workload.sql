-- SUP-87: drop the old three-argument admin_set_workload().
--
-- 20261025010000_working_hours.sql (SUP-85) added the six-argument version
-- and kept this one so the build then deployed could still save Admin >
-- Workload. PR #90 is merged and deployed, and nothing calls the old
-- version any more: the app and the tests always pass all six arguments.
drop function ticketing.admin_set_workload(uuid, integer, text);
