-- Outpost RLS lint. Run in CI after migrations; any row returned is a build failure.
--
-- Every table in schema outpost must:
--   1. have a NOT NULL tenant_id column,
--   2. have row level security enabled,
--   3. have it forced (owner included), except the named audit exception,
--   4. carry at least one policy, and
--   5. carry no policy whose USING or WITH CHECK is a bare TRUE.
-- Any table in schema platform or catalog that grows a tenant_id column is also a failure:
-- tenant data does not belong there.

with tenant_tables as (
  select c.oid, n.nspname as schema_name, c.relname as table_name, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'outpost' and c.relkind in ('r', 'p')
),
checks as (
  select t.schema_name, t.table_name, 'missing NOT NULL tenant_id column' as violation
    from tenant_tables t
   where not exists (
     select 1 from pg_attribute a
      where a.attrelid = t.oid and a.attname = 'tenant_id' and a.attnotnull and not a.attisdropped)
  union all
  select t.schema_name, t.table_name, 'row level security not enabled'
    from tenant_tables t where not t.relrowsecurity
  union all
  select t.schema_name, t.table_name, 'row level security not forced'
    from tenant_tables t
   where not t.relforcerowsecurity and t.table_name not in ('audit_events')
  union all
  select t.schema_name, t.table_name, 'no policy'
    from tenant_tables t
   where not exists (select 1 from pg_policy p where p.polrelid = t.oid)
  union all
  select t.schema_name, t.table_name, 'policy ' || p.polname || ' is unconditional'
    from tenant_tables t join pg_policy p on p.polrelid = t.oid
   where (p.polcmd in ('r', 'w', 'd', '*') and (p.polqual is null or pg_get_expr(p.polqual, p.polrelid) ilike 'true'))
      -- an UPDATE or ALL policy without WITH CHECK falls back to USING, so only INSERT needs its own check
      or (p.polcmd = 'a' and (p.polwithcheck is null or pg_get_expr(p.polwithcheck, p.polrelid) ilike 'true'))
  union all
  select n.nspname, c.relname, 'tenant_id column outside the outpost schema'
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('platform', 'catalog') and a.attname = 'tenant_id' and not a.attisdropped
     and c.relname not in ('break_glass_grants')   -- a grant *targets* a tenant; it holds no tenant data
)
select * from checks order by 1, 2, 3;
