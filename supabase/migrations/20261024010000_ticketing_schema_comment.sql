-- SUP-79: the schema comment still said this project is shared with
-- notes-collections. That app is retired and the project is now
-- support-triage, so the comment says what is true today.

comment on schema ticketing is
  'Support Ticket / Inbox Triage app. The project is support-triage; public is empty, and the separate RoboMart shop keeps its own robomart schema.';
