-- Backfill default lists for families that already exist (those created
-- before the seed was added to create_family).

insert into lists (family_id, name, kind, sort_order)
select f.id, 'Groceries', 'grocery', 0 from families f
where not exists (select 1 from lists l where l.family_id = f.id and l.kind = 'grocery');

insert into lists (family_id, name, kind, sort_order)
select f.id, 'To-do', 'todo', 1 from families f
where not exists (select 1 from lists l where l.family_id = f.id and l.kind = 'todo');
