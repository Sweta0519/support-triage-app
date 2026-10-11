-- Review of SUP-23 (PR #30), second half: the select policy let any
-- authenticated user -- including notes-collections accounts, which share
-- auth.users -- list the whole bucket (every user id with a picture) and
-- download every picture straight from the Storage API.
--
-- The bucket now has no client policies at all. Only the server touches
-- it, with the service role: it uploads re-encoded pictures, deletes the
-- ones a profile stops pointing at, and serves them through
-- /avatar/<owner>/<file> to signed-in users of this app.

drop policy "ticketing_avatars_select" on storage.objects;
drop policy "ticketing_avatars_delete_own" on storage.objects;
