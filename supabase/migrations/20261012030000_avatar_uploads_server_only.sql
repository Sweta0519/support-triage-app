-- Review of SUP-23 (PR #30): the insert policy let a signed-in user upload
-- straight to the Storage API with their own JWT -- any 512KB "webp", with
-- its metadata, at any size, uncharged -- and then point their profile at
-- it with set_own_avatar(), skipping the server's sharp re-encode and the
-- 'update_avatar' rate limit.
--
-- Uploads now happen only on the server, after the re-encode, with the
-- service role (app/lib/db/avatars.ts builds the path from the verified
-- session). With no insert policy, authenticated can't add objects to the
-- bucket at all. Reads and own-folder deletes are unchanged.

drop policy "ticketing_avatars_insert_own" on storage.objects;
