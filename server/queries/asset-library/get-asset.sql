select a.id,
       a.type,
       COALESCE(
         (SELECT row_to_json(sub) FROM (SELECT av.id, av.name, av.owner, av.created_at FROM avatars av WHERE lower(av.owner) = lower(a.author) LIMIT 1) sub),
         to_json(a.author)
       )       as author,
       a.name,
       a.description,
       category,
       content, public, views, a.created_at, a.updated_at, image_url, has_script, has_unsafe_script
from
    asset_library a
where
    a.id = $1