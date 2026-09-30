-- Rename addresses without changing drafts, published snapshots, or their drawings.
-- Increment revisions so an already-open editor cannot overwrite the renamed address.
UPDATE articles
SET slug = 'prac/' || substr(slug, 15), revision = revision + 1
WHERE slug GLOB 'practicehaven/*';
