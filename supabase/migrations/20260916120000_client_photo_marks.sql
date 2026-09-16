-- Client photo marks — "keep", "publish", "delete".
--
-- What a client says they want done with each photograph in their gallery.
-- Nothing acts on these: no file is moved, nothing is published, nothing is
-- deleted. They are a request from the client to the photographer, and every
-- one of them is carried out by hand afterwards. That is deliberate — a client
-- tapping the wrong button on a phone must not be able to destroy a negative.
--
-- Columns on `photos` rather than a join table because a client gallery has
-- exactly one client. There is no second opinion to store, no per-viewer row,
-- and a column means the mark travels with the photograph through every query
-- that already selects from photos.
--
-- Album photographs simply never get one: nothing on a public album page can
-- write here, and the API route that does write refuses any photo whose gallery
-- is not the one the caller unlocked.

alter table public.photos
  add column if not exists client_mark text,
  add column if not exists client_marked_at timestamptz;

-- Three values or null. Null is not "no opinion recorded yet" as distinct from
-- "cleared" — the client can un-mark, and both land here. A CHECK rather than
-- an enum: adding a fourth mark later is an ALTER on this constraint instead of
-- a type migration, and nothing in the app pattern-matches exhaustively on it.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'photos_client_mark_check'
  ) then
    alter table public.photos
      add constraint photos_client_mark_check
      check (client_mark is null or client_mark in ('keep', 'publish', 'delete'));
  end if;
end $$;

-- The filter above the grid counts each mark on every render, and the
-- photographer's own review query is "everything marked for deletion in this
-- gallery". Partial, because the overwhelming majority of rows are null and
-- indexing those is paying for the album library to support a client feature.
create index if not exists photos_client_mark_idx
  on public.photos (gallery_id, client_mark)
  where client_mark is not null;

comment on column public.photos.client_mark is
  'Client request: keep | publish | delete | null. Advisory only — nothing in the app acts on it. "publish" is PERMISSION to use the photo publicly, not publication.';
comment on column public.photos.client_marked_at is
  'When the mark was last changed. Lets the photographer see whether a gallery has been reviewed at all.';

-- Review queries for the photographer.
--
--   select storage_path, client_mark, client_marked_at
--     from photos p join galleries g on g.id = p.gallery_id
--    where g.slug = '<slug>' and p.client_mark is not null
--    order by p.client_mark, p.sort_order;
--
--   -- has this client been through their gallery at all?
--   select g.slug,
--          count(*) filter (where p.client_mark is not null) as marked,
--          count(*) as total,
--          max(p.client_marked_at) as last_touched
--     from galleries g join photos p on p.gallery_id = g.id
--    where g.kind = 'client'
--    group by g.slug;
