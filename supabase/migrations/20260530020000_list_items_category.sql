-- Owner asked to add a `category` field to list_items alongside notes (which
-- has been there since Phase 1). Two uses:
--   1. General organization on any list (a "call dentist" todo can be tagged
--      "medical"; helps when scanning a long list).
--   2. Routing on grocery checkoff — when an item gets checked off and we
--      want to update inventory, the category tells us where in inventory
--      to look (matches inventory_categories.name when set).
--
-- Plain text (not FK) so the same field works for both inventory-linked
-- grocery items AND general categorisation that doesn't have an inventory
-- counterpart.

set search_path = public;

alter table list_items
  add column if not exists category text;

create index if not exists list_items_category_idx on list_items(family_id, category)
  where category is not null;
