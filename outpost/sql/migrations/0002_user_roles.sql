-- Home-tenant role for every user. Consultants carry their firm-level default here; an
-- engagement assignment's role (lead, analyst) overrides it while acting in a customer tenant.
set role outpost_migrate;
alter table platform.users
  add column if not exists role text not null default 'customer_viewer'
  check (role in ('platform_admin', 'firm_admin', 'consultant_lead', 'consultant_analyst',
                  'customer_admin', 'customer_operator', 'customer_viewer', 'auditor'));
reset role;
