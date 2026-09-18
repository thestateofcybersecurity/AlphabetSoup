-- Catalog consistency lint. Any row returned is a seed bug.
with caps as (
  select ct.id as connector_type, c ->> 'id' as capability, c ->> 'kind' as kind,
         coalesce(c -> 'playbooks', '[]'::jsonb) as playbooks
    from catalog.connector_types ct, jsonb_array_elements(ct.capabilities) c
),
checks as (
  select m.id as mission_id, ch ->> 'id' as check_id, ch -> 'evidence' ->> 'connector_type' as connector_type,
         ch -> 'evidence' ->> 'capability' as capability, ch -> 'resolved_by' as resolved_by, ch ->> 'question' as question,
         m.questionnaire
    from catalog.missions m, jsonb_array_elements(m.checks) ch
),
tools as (
  select s.id as mcp_server_id, t ->> 'id' as tool from catalog.mcp_servers s, jsonb_array_elements(s.tools) t
),
problems as (
  -- 1. every capability a mission requires is declared by some connector type
  select 'mission ' || m.id as subject, 'requires undeclared capability ' || rc as problem
    from catalog.missions m, unnest(m.required_capabilities) rc
   where not exists (select 1 from caps where caps.capability = rc)
  union all
  -- 2. every check evidences through a declared capability of the named connector type
  select 'check ' || c.check_id, 'evidence capability ' || c.capability || ' not declared by ' || c.connector_type
    from checks c
   where not exists (select 1 from caps where caps.connector_type = c.connector_type and caps.capability = c.capability)
  union all
  -- 3. a check's evidence capability must be one the mission requires (or a documented optional one on the same connector)
  select 'check ' || c.check_id, 'evidence capability ' || c.capability || ' is not in the mission required list and not optional-on-connector'
    from checks c join catalog.missions m on m.id = c.mission_id
   where not (c.capability = any (m.required_capabilities))
     and not exists (select 1 from caps where caps.connector_type = c.connector_type and caps.capability = c.capability and caps.kind = 'read')
  union all
  -- 4. check ids are globally unique
  select 'check ' || check_id, 'duplicate check id across missions'
    from checks group by check_id having count(*) > 1
  union all
  -- 5. every resolved_by names a real playbook that lists this check in resolves_checks
  select 'check ' || c.check_id, 'resolved_by ' || rb || ' is not a playbook resolving this check'
    from checks c, jsonb_array_elements_text(c.resolved_by) rb
   where not exists (select 1 from catalog.playbooks p where p.id = rb and c.check_id = any (p.resolves_checks))
  union all
  -- 6. every playbook resolves_checks names a real check that lists the playbook back
  select 'playbook ' || p.id, 'resolves unknown or non-reciprocal check ' || rc
    from catalog.playbooks p, unnest(p.resolves_checks) rc
   where not exists (select 1 from checks c where c.check_id = rc and c.resolved_by ? p.id)
  union all
  -- 7. playbook write capabilities are declared, are writes, and list the playbook
  select 'playbook ' || p.id, 'capability ' || rc || ' missing, not a write, or does not list the playbook'
    from catalog.playbooks p, unnest(p.required_capabilities) rc
   where not exists (select 1 from caps where caps.capability = rc and caps.kind = 'write' and caps.playbooks ? p.id)
  union all
  -- 8. every write capability's playbook list names real playbooks
  select 'capability ' || caps.capability, 'lists unknown playbook ' || pb
    from caps, jsonb_array_elements_text(caps.playbooks) pb
   where not exists (select 1 from catalog.playbooks p where p.id = pb)
  union all
  -- 9. playbook mcp servers exist and every tool in call_schema, verification, rollback exists on one of them
  select 'playbook ' || p.id, 'unknown mcp server ' || s
    from catalog.playbooks p, unnest(p.mcp_server_ids) s
   where not exists (select 1 from catalog.mcp_servers m where m.id = s)
  union all
  select 'playbook ' || p.id, 'call tool ' || t || ' not on its mcp servers'
    from catalog.playbooks p, jsonb_array_elements_text(p.call_schema -> 'tools') t
   where not exists (select 1 from tools where tools.tool = t and tools.mcp_server_id = any (p.mcp_server_ids))
  union all
  select 'playbook ' || p.id, 'rollback tool ' || t || ' not on its mcp servers'
    from catalog.playbooks p, jsonb_array_elements_text(p.rollback -> 'tools') t
   where p.rollback is not null
     and not exists (select 1 from tools where tools.tool = t and tools.mcp_server_id = any (p.mcp_server_ids))
  union all
  -- 10. the agent may call every tool the playbook uses
  select 'playbook ' || p.id, 'agent ' || p.agent_id || ' lacks tool ' || t
    from catalog.playbooks p join catalog.agents a on a.id = p.agent_id,
         jsonb_array_elements_text(p.call_schema -> 'tools' || coalesce(p.rollback -> 'tools', '[]'::jsonb)) t
   where not (t = any (a.tools))
  union all
  -- 11. autopilot ceiling only for low blast radius, reversible, with a rollback and a bounded target count
  select 'playbook ' || p.id, 'autopilot ceiling without low blast radius, reversibility, rollback, and max_targets.autopilot'
    from catalog.playbooks p
   where p.mode_ceiling = 'autopilot'
     and not (p.blast_radius = 'low' and p.reversible and p.rollback is not null and (p.call_schema -> 'constraints' -> 'max_targets' ? 'autopilot'))
  union all
  -- 12. any write-capable agent is high risk tier (from the AI risk tiering rule: autonomous production writes force High)
  select 'agent ' || a.id, 'has write tools but risk_tier is ' || a.risk_tier
    from catalog.agents a
   where a.risk_tier <> 'high' and exists (
     select 1 from catalog.mcp_servers s, jsonb_array_elements(s.tools) t
      where (t ->> 'writes')::boolean and (t ->> 'id') = any (a.tools))
  union all
  -- 13. a check that names a questionnaire fallback must find it in the mission's questionnaire
  select 'check ' || c.check_id, 'question ' || c.question || ' not in mission questionnaire'
    from checks c
   where c.question is not null
     and not exists (select 1 from jsonb_array_elements(coalesce(c.questionnaire, '[]'::jsonb)) q where q ->> 'id' = c.question and q ->> 'for_check' = c.check_id)
)
select * from problems order by 1, 2;
