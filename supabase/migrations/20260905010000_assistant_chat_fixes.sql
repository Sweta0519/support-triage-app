-- Two fixes to 20260905000000_assistant_chat.sql, found by review before
-- merge (same kind of grant gap the tickets table hit once before, fixed
-- there by 20260903020100_grant_tickets_update.sql):
--
-- 1. appendMessage() touches assistant_conversations.updated_at with an
--    UPDATE, but authenticated was only ever granted select/insert on it --
--    the update silently no-ops under RLS's own grant check, so "most
--    recently updated" ordering never reflected real activity.
-- 2. getOrCreateActiveConversation() was select-then-insert with no unique
--    constraint backing "one conversation per owner" -- two concurrent
--    requests from the same staff member could each create their own row,
--    splitting that person's history in two. A unique constraint makes the
--    insert-first/fall-back-to-select-on-conflict pattern in
--    app/lib/db/assistant.ts safe, and makes the ordering index from the
--    first migration redundant (there is now always exactly one row).

grant update on ticketing.assistant_conversations to authenticated;

drop index if exists ticketing.assistant_conversations_owner_id_idx;

alter table ticketing.assistant_conversations
  add constraint assistant_conversations_owner_id_key unique (owner_id);
