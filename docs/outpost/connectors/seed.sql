-- Catalog seed for the first two connectors, v0.1 (2026-09-18).
-- Loads into the catalog schema from ../schema.sql. Idempotent (upserts on id).
-- Run: psql -v ON_ERROR_STOP=1 -f seed.sql   then   psql -f check_catalog.sql  (expect zero rows)

\set ON_ERROR_STOP on
set role outpost_provisioner;

-- ---------------------------------------------------------------------------
-- Connector types
-- ---------------------------------------------------------------------------
insert into catalog.connector_types (id, family, display_name, auth_kind, capabilities, trust_template, docs_url, version) values
('entra-id', 'identity', 'Microsoft Entra ID', 'oauth', $$[
  {"id":"read:identity","kind":"read","permissions":["User.Read.All","Group.Read.All","Directory.Read.All","UserAuthenticationMethod.Read.All","Reports.Read.All"]},
  {"id":"read:identity.signin","kind":"read","permissions":["AuditLog.Read.All"],"requires_licence":"P1"},
  {"id":"read:identity.policy","kind":"read","permissions":["Policy.Read.All"]},
  {"id":"read:identity.privileged","kind":"read","permissions":["RoleManagement.Read.Directory","RoleEligibilitySchedule.Read.Directory","RoleAssignmentSchedule.Read.Directory"],"requires_licence":"P2 for PIM"},
  {"id":"read:identity.apps","kind":"read","permissions":["Application.Read.All","DelegatedPermissionGrant.Read.All"]},
  {"id":"write:identity.user-state","kind":"write","permissions":["User.EnableDisable.All","User.RevokeSessions.All"],"playbooks":["identity.disable-stale-accounts"]},
  {"id":"write:identity.auth-methods-policy","kind":"write","permissions":["Policy.ReadWrite.AuthenticationMethod"],"playbooks":["identity.mfa-registration-campaign"]},
  {"id":"write:identity.ca-policy","kind":"write","permissions":["Policy.ReadWrite.ConditionalAccess","Application.Read.All"],"playbooks":["identity.block-legacy-auth"]},
  {"id":"write:identity.role-assignments","kind":"write","permissions":["RoleManagement.ReadWrite.Directory"],"playbooks":["identity.remove-unused-privileged-roles"]},
  {"id":"write:identity.app-grants","kind":"write","permissions":["DelegatedPermissionGrant.ReadWrite.All","AppRoleAssignment.ReadWrite.All"],"playbooks":["identity.revoke-risky-app-grant"]}
]$$::jsonb, $$
{"kind":"oauth","consent_url_template":"https://login.microsoftonline.com/organizations/v2.0/adminconsent?client_id={client_id}&scope=https://graph.microsoft.com/.default&redirect_uri={callback}&state={state}","completed_by":"customer_admin","alternative":"byo-app-registration"}
$$::jsonb, 'https://learn.microsoft.com/graph/permissions-reference', 1),
('aws', 'cloud', 'AWS', 'aws-role', $$[
  {"id":"read:cloud.aws","kind":"read","permissions":["arn:aws:iam::aws:policy/SecurityAudit","arn:aws:iam::aws:policy/job-function/ViewOnlyAccess"]},
  {"id":"read:cloud.aws.inventory","kind":"read","permissions":["ec2:DescribeAddresses","ec2:DescribeInstances","ec2:DescribeNetworkInterfaces","elasticloadbalancing:DescribeLoadBalancers","route53:ListHostedZones","route53:ListResourceRecordSets","cloudfront:ListDistributions","apigateway:GET","s3:GetBucketWebsite","globalaccelerator:ListAccelerators"]},
  {"id":"read:cloud.aws.backup","kind":"read","permissions":["backup:ListBackupVaults","backup:DescribeBackupVault","backup:ListBackupPlans","backup:GetBackupPlan","backup:ListRecoveryPointsByBackupVault","backup:ListRestoreJobs","rds:DescribeDBSnapshots","ec2:DescribeSnapshots","s3:GetBucketVersioning","s3:GetBucketObjectLockConfiguration"]},
  {"id":"write:cloud.aws.s3-public-access","kind":"write","permissions":["s3:GetBucketPublicAccessBlock","s3:PutBucketPublicAccessBlock","s3:GetAccountPublicAccessBlock","s3:PutAccountPublicAccessBlock"],"playbooks":["cloud.block-public-storage"]},
  {"id":"write:cloud.aws.cloudtrail","kind":"write","permissions":["cloudtrail:CreateTrail","cloudtrail:UpdateTrail","cloudtrail:StartLogging","cloudtrail:PutEventSelectors","s3:CreateBucket","s3:PutBucketPolicy","s3:PutBucketPublicAccessBlock"],"playbooks":["cloud.enable-cloudtrail-all-regions"]},
  {"id":"write:cloud.aws.iam-keys","kind":"write","permissions":["iam:ListAccessKeys","iam:GetAccessKeyLastUsed","iam:UpdateAccessKey"],"playbooks":["cloud.deactivate-stale-access-keys"]},
  {"id":"write:cloud.aws.password-policy","kind":"write","permissions":["iam:UpdateAccountPasswordPolicy","iam:GetAccountPasswordPolicy"],"playbooks":["cloud.set-password-policy"]},
  {"id":"write:cloud.aws.security-groups","kind":"write","permissions":["ec2:RevokeSecurityGroupIngress","ec2:AuthorizeSecurityGroupIngress"],"playbooks":["cloud.close-open-admin-ports"]},
  {"id":"write:cloud.aws.guardduty","kind":"write","permissions":["guardduty:CreateDetector","guardduty:UpdateDetector","guardduty:ListDetectors","iam:CreateServiceLinkedRole"],"playbooks":["cloud.enable-guardduty"]},
  {"id":"write:cloud.aws.ebs-encryption","kind":"write","permissions":["ec2:EnableEbsEncryptionByDefault","ec2:DisableEbsEncryptionByDefault","ec2:GetEbsEncryptionByDefault"],"playbooks":["cloud.enable-ebs-default-encryption"]}
]$$::jsonb, $$
{"kind":"aws-role","read_role":"OutpostReadOnly","write_role":"OutpostRemediation","template":"cloudformation","external_id_format":"{slug}-{random}","completed_by":"customer_admin","session":{"duration_seconds":3600,"source_identity":"outpost:{slug}","tags":["outpost:tenant","outpost:run","outpost:playbook"]}}
$$::jsonb, 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_common-scenarios_third-party.html', 1)
on conflict (id) do update set family = excluded.family, display_name = excluded.display_name, auth_kind = excluded.auth_kind,
  capabilities = excluded.capabilities, trust_template = excluded.trust_template, docs_url = excluded.docs_url, version = excluded.version;

-- ---------------------------------------------------------------------------
-- MCP servers and agents
-- ---------------------------------------------------------------------------
insert into catalog.mcp_servers (id, name, origin, image_digest, review_status, reviewed_by, reviewed_at, tools) values
('graph-mcp', 'Microsoft Graph MCP', 'first-party', 'sha256:0000000000000000000000000000000000000000000000000000000000000001', 'pending', null, null, $$[
  {"id":"graph.users.disable","writes":true,"params_schema":{"type":"object","required":["user_id"],"properties":{"user_id":{"type":"string"}}}},
  {"id":"graph.users.enable","writes":true,"params_schema":{"type":"object","required":["user_id"],"properties":{"user_id":{"type":"string"}}}},
  {"id":"graph.users.revoke_sessions","writes":true,"params_schema":{"type":"object","required":["user_id"],"properties":{"user_id":{"type":"string"}}}},
  {"id":"graph.auth_methods_policy.set_registration_campaign","writes":true,"params_schema":{"type":"object","required":["state","snooze_days"],"properties":{"state":{"enum":["enabled","disabled"]},"snooze_days":{"type":"integer","minimum":0,"maximum":14}}}},
  {"id":"graph.ca_policies.create","writes":true,"params_schema":{"type":"object","required":["display_name","state","policy"],"properties":{"display_name":{"type":"string"},"state":{"enum":["enabledForReportingButNotEnforced","enabled","disabled"]},"policy":{"type":"object"}}}},
  {"id":"graph.ca_policies.set_state","writes":true,"params_schema":{"type":"object","required":["policy_id","state"],"properties":{"policy_id":{"type":"string"},"state":{"enum":["enabledForReportingButNotEnforced","enabled","disabled"]}}}},
  {"id":"graph.role_assignments.remove","writes":true,"params_schema":{"type":"object","required":["assignment_id"],"properties":{"assignment_id":{"type":"string"}}}},
  {"id":"graph.role_assignments.create","writes":true,"params_schema":{"type":"object","required":["role_id","principal_id"],"properties":{"role_id":{"type":"string"},"principal_id":{"type":"string"}}}},
  {"id":"graph.oauth_grants.revoke","writes":true,"params_schema":{"type":"object","required":["grant_id"],"properties":{"grant_id":{"type":"string"}}}},
  {"id":"graph.oauth_grants.create","writes":true,"params_schema":{"type":"object","required":["client_id","resource_id","scope"],"properties":{"client_id":{"type":"string"},"resource_id":{"type":"string"},"scope":{"type":"string"}}}},
  {"id":"graph.collect","writes":false,"params_schema":{"type":"object","required":["collector"],"properties":{"collector":{"type":"string"},"scope":{"type":"object"}}}}
]$$::jsonb),
('aws-mcp', 'AWS MCP', 'first-party', 'sha256:0000000000000000000000000000000000000000000000000000000000000002', 'pending', null, null, $$[
  {"id":"s3.put_public_access_block","writes":true,"params_schema":{"type":"object","required":["bucket","config"],"properties":{"bucket":{"type":"string"},"config":{"type":"object"}}}},
  {"id":"s3.put_account_public_access_block","writes":true,"params_schema":{"type":"object","required":["config"],"properties":{"config":{"type":"object"}}}},
  {"id":"cloudtrail.create_multi_region_trail","writes":true,"params_schema":{"type":"object","required":["name","bucket"],"properties":{"name":{"type":"string"},"bucket":{"type":"string","pattern":"^outpost-cloudtrail-"}}}},
  {"id":"cloudtrail.stop_logging","writes":true,"params_schema":{"type":"object","required":["name"],"properties":{"name":{"type":"string"}}}},
  {"id":"iam.update_access_key","writes":true,"params_schema":{"type":"object","required":["user","access_key_id","status"],"properties":{"user":{"type":"string"},"access_key_id":{"type":"string"},"status":{"enum":["Active","Inactive"]}}}},
  {"id":"iam.update_account_password_policy","writes":true,"params_schema":{"type":"object","required":["policy"],"properties":{"policy":{"type":"object"}}}},
  {"id":"ec2.revoke_security_group_ingress","writes":true,"params_schema":{"type":"object","required":["group_id","region","rule"],"properties":{"group_id":{"type":"string"},"region":{"type":"string"},"rule":{"type":"object"}}}},
  {"id":"ec2.authorize_security_group_ingress","writes":true,"params_schema":{"type":"object","required":["group_id","region","rule"],"properties":{"group_id":{"type":"string"},"region":{"type":"string"},"rule":{"type":"object"}}}},
  {"id":"guardduty.create_detector","writes":true,"params_schema":{"type":"object","required":["region"],"properties":{"region":{"type":"string"}}}},
  {"id":"guardduty.disable_detector","writes":true,"params_schema":{"type":"object","required":["region","detector_id"],"properties":{"region":{"type":"string"},"detector_id":{"type":"string"}}}},
  {"id":"ec2.set_ebs_encryption_by_default","writes":true,"params_schema":{"type":"object","required":["region","enabled"],"properties":{"region":{"type":"string"},"enabled":{"type":"boolean"}}}},
  {"id":"aws.collect","writes":false,"params_schema":{"type":"object","required":["collector"],"properties":{"collector":{"type":"string"},"scope":{"type":"object"}}}}
]$$::jsonb)
on conflict (id) do update set name = excluded.name, origin = excluded.origin, image_digest = excluded.image_digest, review_status = excluded.review_status, tools = excluded.tools;

insert into catalog.agents (id, name, model_tier, tools, risk_tier, threat_model_ref, version) values
('assessor', 'Assessor', 'sonnet', '{graph.collect,aws.collect}', 'medium', 'ai-threat-model:outpost-assessor', 1),
('identity-remediator', 'Identity remediator', 'opus', '{graph.users.disable,graph.users.enable,graph.users.revoke_sessions,graph.auth_methods_policy.set_registration_campaign,graph.ca_policies.create,graph.ca_policies.set_state,graph.role_assignments.remove,graph.role_assignments.create,graph.oauth_grants.revoke,graph.oauth_grants.create,graph.collect}', 'high', 'ai-threat-model:outpost-identity-remediator', 1),
('cloud-remediator', 'Cloud remediator', 'opus', '{s3.put_public_access_block,s3.put_account_public_access_block,cloudtrail.create_multi_region_trail,cloudtrail.stop_logging,iam.update_access_key,iam.update_account_password_policy,ec2.revoke_security_group_ingress,ec2.authorize_security_group_ingress,guardduty.create_detector,guardduty.disable_detector,ec2.set_ebs_encryption_by_default,aws.collect}', 'high', 'ai-threat-model:outpost-cloud-remediator', 1)
on conflict (id) do update set name = excluded.name, model_tier = excluded.model_tier, tools = excluded.tools, risk_tier = excluded.risk_tier, threat_model_ref = excluded.threat_model_ref, version = excluded.version;

-- ---------------------------------------------------------------------------
-- Missions
-- ---------------------------------------------------------------------------
insert into catalog.missions (id, domain, title, summary, tool, required_capabilities, seed_dataset, questionnaire, checks, version) values
('identity-baseline', 'identity', 'Identity baseline', 'MFA coverage, conditional access, legacy authentication, stale and guest accounts, and app consent in Microsoft Entra ID.', 'assessment.identity_baseline',
 '{read:identity,read:identity.policy}', null, $$[
  {"id":"q-stale","for_check":"entra-stale-accounts","text":"Are enabled accounts with no sign-in in 90 days reviewed and disabled monthly?"},
  {"id":"q-pim","for_check":"entra-pim-eligible-not-permanent","text":"Are privileged roles activated just in time rather than permanently assigned?"}
 ]$$::jsonb, $$[
  {"id":"entra-mfa-admin-phishing-resistant","title":"Every privileged role member has a phishing-resistant method registered","severity":"critical","refs":[{"framework":"cis","ref":"6.5"},{"framework":"csf","ref":"PR.AA-03"}],"evidence":{"connector_type":"entra-id","capability":"read:identity","collector":"auth_methods.by_role"},"resolved_by":[]},
  {"id":"entra-mfa-registration-coverage","title":"MFA registered for at least 95% of enabled users","severity":"high","refs":[{"framework":"cis","ref":"6.3"},{"framework":"csf","ref":"PR.AA-03"}],"evidence":{"connector_type":"entra-id","capability":"read:identity","collector":"auth_methods.registration_report"},"resolved_by":["identity.mfa-registration-campaign"]},
  {"id":"entra-legacy-auth-blocked","title":"Legacy authentication is blocked by conditional access or security defaults","severity":"critical","refs":[{"framework":"csf","ref":"PR.AA-05"}],"evidence":{"connector_type":"entra-id","capability":"read:identity.policy","collector":"policy.legacy_auth"},"resolved_by":["identity.block-legacy-auth"]},
  {"id":"entra-ca-mfa-all-users","title":"Conditional access requires MFA for all users","severity":"critical","refs":[{"framework":"cis","ref":"6.3"}],"evidence":{"connector_type":"entra-id","capability":"read:identity.policy","collector":"policy.ca_mfa"},"resolved_by":[]},
  {"id":"entra-ca-mfa-admins","title":"Conditional access requires phishing-resistant MFA for admins","severity":"high","refs":[{"framework":"cis","ref":"6.5"}],"evidence":{"connector_type":"entra-id","capability":"read:identity.policy","collector":"policy.ca_admin_strength"},"resolved_by":[]},
  {"id":"entra-security-defaults-or-ca","title":"Security defaults are on, or at least one enabled conditional access policy exists","severity":"critical","refs":[{"framework":"cis","ref":"6.3"}],"evidence":{"connector_type":"entra-id","capability":"read:identity.policy","collector":"policy.baseline_present"},"resolved_by":[]},
  {"id":"entra-stale-accounts","title":"No enabled accounts without a sign-in in 90 days","severity":"high","refs":[{"framework":"cis","ref":"5.3"},{"framework":"csf","ref":"PR.AA-01"}],"evidence":{"connector_type":"entra-id","capability":"read:identity.signin","collector":"signin.stale"},"resolved_by":["identity.disable-stale-accounts"],"question":"q-stale"},
  {"id":"entra-guest-review","title":"Guest accounts are fewer than 10% of users or reviewed in the last 90 days","severity":"medium","refs":[{"framework":"cis","ref":"5.3"}],"evidence":{"connector_type":"entra-id","capability":"read:identity","collector":"users.guests"},"resolved_by":[]},
  {"id":"entra-break-glass-exists","title":"At least two emergency access accounts exist and are excluded from conditional access","severity":"medium","refs":[],"evidence":{"connector_type":"entra-id","capability":"read:identity.policy","collector":"users.break_glass"},"resolved_by":[]},
  {"id":"entra-app-consent-restricted","title":"Users cannot consent to apps, or only to verified publishers for low-risk permissions","severity":"high","refs":[{"framework":"owasp-llm","ref":"LLM06"}],"evidence":{"connector_type":"entra-id","capability":"read:identity.policy","collector":"policy.app_consent"},"resolved_by":[]},
  {"id":"entra-password-never-expires-admins","title":"No admin account has password expiration disabled without a phishing-resistant method","severity":"medium","refs":[{"framework":"cis","ref":"5.2"}],"evidence":{"connector_type":"entra-id","capability":"read:identity","collector":"users.admin_password_policy"},"resolved_by":[]},
  {"id":"entra-sspr-enabled","title":"Self-service password reset is enabled for all users","severity":"low","refs":[{"framework":"cis","ref":"5.2"}],"evidence":{"connector_type":"entra-id","capability":"read:identity.policy","collector":"policy.sspr"},"resolved_by":[]}
 ]$$::jsonb, 1),
('privileged-access-review', 'identity', 'Privileged access review', 'How many people hold privileged directory roles, whether they are eligible or permanent, cloud-only, and used.', 'assessment.privileged_access',
 '{read:identity.privileged}', null, null, $$[
  {"id":"entra-global-admin-count","title":"Between 2 and 5 Global Administrators","severity":"high","refs":[{"framework":"cis","ref":"5.4"}],"evidence":{"connector_type":"entra-id","capability":"read:identity.privileged","collector":"roles.global_admins"},"resolved_by":["identity.remove-unused-privileged-roles"]},
  {"id":"entra-pim-eligible-not-permanent","title":"Privileged roles are PIM-eligible, not permanently active","severity":"high","refs":[{"framework":"cis","ref":"5.4"}],"evidence":{"connector_type":"entra-id","capability":"read:identity.privileged","collector":"roles.pim_assignments"},"resolved_by":[]},
  {"id":"entra-privileged-cloud-only","title":"Privileged accounts are cloud-only, not synced from on-premises","severity":"medium","refs":[],"evidence":{"connector_type":"entra-id","capability":"read:identity.privileged","collector":"roles.synced_admins"},"resolved_by":[]},
  {"id":"entra-privileged-unused","title":"No privileged role assignment unused for 60 days","severity":"medium","refs":[{"framework":"cis","ref":"5.4"}],"evidence":{"connector_type":"entra-id","capability":"read:identity.privileged","collector":"roles.unused"},"resolved_by":["identity.remove-unused-privileged-roles"]}
 ]$$::jsonb, 1),
('app-consent-inventory', 'identity', 'App consent and shadow AI inventory', 'Third-party OAuth grants, unverified publishers, and AI apps with user consent, feeding the AI use-case register.', 'assessment.app_consent',
 '{read:identity.apps}', 'ai-risk-tiering.json', null, $$[
  {"id":"entra-oauth-high-privilege-grants","title":"No third-party app holds high-privilege permissions without a documented owner","severity":"high","refs":[{"framework":"cis","ref":"5.4"}],"evidence":{"connector_type":"entra-id","capability":"read:identity.apps","collector":"apps.high_privilege"},"resolved_by":["identity.revoke-risky-app-grant"]},
  {"id":"entra-oauth-unverified-publishers","title":"No grants to unverified publishers","severity":"medium","refs":[],"evidence":{"connector_type":"entra-id","capability":"read:identity.apps","collector":"apps.unverified"},"resolved_by":["identity.revoke-risky-app-grant"]},
  {"id":"entra-shadow-ai-apps","title":"AI assistants and model providers with user consent are inventoried and tiered","severity":"medium","refs":[{"framework":"ai-rmf","ref":"MAP 1.1"}],"evidence":{"connector_type":"entra-id","capability":"read:identity.apps","collector":"apps.ai_inventory"},"resolved_by":[]}
 ]$$::jsonb, 1),
('cloud-cis-foundations-aws', 'cloud', 'Cloud CIS Foundations (AWS)', 'The twenty AWS controls from the site cloud baseline, evidenced from the account rather than answered by hand.', 'assessment.cloud_baseline',
 '{read:cloud.aws}', 'cloud-baseline.json', null, $$[
  {"id":"aws-identity-root-mfa","title":"MFA on the root user","severity":"critical","refs":[{"framework":"cis-aws","ref":"1.5"}],"evidence":{"connector_type":"aws","capability":"read:cloud.aws","collector":"iam.account_summary"},"seed":{"dataset":"cloud-baseline.json","id":"aws-identity-root-mfa"},"resolved_by":[]},
  {"id":"aws-identity-remove-root-keys","title":"No root access keys","severity":"critical","refs":[{"framework":"cis-aws","ref":"1.4"}],"evidence":{"connector_type":"aws","capability":"read:cloud.aws","collector":"iam.account_summary"},"seed":{"dataset":"cloud-baseline.json","id":"aws-identity-remove-root-keys"},"resolved_by":[]},
  {"id":"aws-identity-password-policy","title":"Strong IAM password policy","severity":"high","refs":[{"framework":"cis-aws","ref":"1.8"}],"evidence":{"connector_type":"aws","capability":"read:cloud.aws","collector":"iam.password_policy"},"seed":{"dataset":"cloud-baseline.json","id":"aws-identity-password-policy"},"resolved_by":["cloud.set-password-policy"]},
  {"id":"aws-identity-mfa-all-users","title":"MFA for all IAM console users","severity":"critical","refs":[{"framework":"cis-aws","ref":"1.10"}],"evidence":{"connector_type":"aws","capability":"read:cloud.aws","collector":"iam.credential_report"},"seed":{"dataset":"cloud-baseline.json","id":"aws-identity-mfa-all-users"},"resolved_by":[]},
  {"id":"aws-identity-sso-identity-center","title":"Human access through IAM Identity Center","severity":"high","refs":[{"framework":"cis-aws","ref":"1.x"}],"evidence":{"connector_type":"aws","capability":"read:cloud.aws","collector":"sso.instances"},"seed":{"dataset":"cloud-baseline.json","id":"aws-identity-sso-identity-center"},"resolved_by":[]},
  {"id":"aws-identity-least-privilege-keys","title":"No stale or unrotated access keys","severity":"high","refs":[{"framework":"cis-aws","ref":"1.14"}],"evidence":{"connector_type":"aws","capability":"read:cloud.aws","collector":"iam.credential_report"},"seed":{"dataset":"cloud-baseline.json","id":"aws-identity-least-privilege-keys"},"resolved_by":["cloud.deactivate-stale-access-keys"]},
  {"id":"aws-logging-cloudtrail-all-regions","title":"Multi-region CloudTrail with log validation","severity":"critical","refs":[{"framework":"cis-aws","ref":"3.1"}],"evidence":{"connector_type":"aws","capability":"read:cloud.aws","collector":"cloudtrail.trails"},"seed":{"dataset":"cloud-baseline.json","id":"aws-logging-cloudtrail-all-regions"},"resolved_by":["cloud.enable-cloudtrail-all-regions"]},
  {"id":"aws-logging-config-enabled","title":"AWS Config recording in all regions","severity":"high","refs":[{"framework":"cis-aws","ref":"3.5"}],"evidence":{"connector_type":"aws","capability":"read:cloud.aws","collector":"config.recorders"},"seed":{"dataset":"cloud-baseline.json","id":"aws-logging-config-enabled"},"resolved_by":[]},
  {"id":"aws-logging-central-log-integrity","title":"Log archive is separate, restricted, and immutable","severity":"high","refs":[{"framework":"cis-aws","ref":"3.3"}],"evidence":{"connector_type":"aws","capability":"read:cloud.aws","collector":"s3.object_lock"},"seed":{"dataset":"cloud-baseline.json","id":"aws-logging-central-log-integrity"},"resolved_by":[]},
  {"id":"aws-logging-guardduty","title":"GuardDuty enabled in every active region","severity":"high","refs":[{"framework":"cis-aws","ref":"3.x"}],"evidence":{"connector_type":"aws","capability":"read:cloud.aws","collector":"guardduty.detectors"},"seed":{"dataset":"cloud-baseline.json","id":"aws-logging-guardduty"},"resolved_by":["cloud.enable-guardduty"]},
  {"id":"aws-network-restrict-sensitive-ports","title":"No 0.0.0.0/0 ingress to admin or database ports","severity":"critical","refs":[{"framework":"cis-aws","ref":"5.2"}],"evidence":{"connector_type":"aws","capability":"read:cloud.aws","collector":"ec2.security_groups"},"seed":{"dataset":"cloud-baseline.json","id":"aws-network-restrict-sensitive-ports"},"resolved_by":["cloud.close-open-admin-ports"]},
  {"id":"aws-network-default-sg-hygiene","title":"Default security groups deny all","severity":"medium","refs":[{"framework":"cis-aws","ref":"5.4"}],"evidence":{"connector_type":"aws","capability":"read:cloud.aws","collector":"ec2.security_groups"},"seed":{"dataset":"cloud-baseline.json","id":"aws-network-default-sg-hygiene"},"resolved_by":[]},
  {"id":"aws-network-vpc-flow-logs","title":"VPC Flow Logs on all VPCs","severity":"high","refs":[{"framework":"cis-aws","ref":"3.7"}],"evidence":{"connector_type":"aws","capability":"read:cloud.aws","collector":"ec2.flow_logs"},"seed":{"dataset":"cloud-baseline.json","id":"aws-network-vpc-flow-logs"},"resolved_by":[]},
  {"id":"aws-network-private-subnets","title":"Databases in private subnets","severity":"high","refs":[{"framework":"cis-aws","ref":"5.x"}],"evidence":{"connector_type":"aws","capability":"read:cloud.aws","collector":"rds.instances"},"seed":{"dataset":"cloud-baseline.json","id":"aws-network-private-subnets"},"resolved_by":[]},
  {"id":"aws-workload-imdsv2","title":"IMDSv2 required on all instances","severity":"high","refs":[{"framework":"cis-aws","ref":"5.6"}],"evidence":{"connector_type":"aws","capability":"read:cloud.aws","collector":"ec2.instances"},"seed":{"dataset":"cloud-baseline.json","id":"aws-workload-imdsv2"},"resolved_by":[]},
  {"id":"aws-workload-ssm-patching","title":"Patching and access through Systems Manager","severity":"high","refs":[{"framework":"cis-aws","ref":"4.x"}],"evidence":{"connector_type":"aws","capability":"read:cloud.aws","collector":"ssm.managed_instances"},"seed":{"dataset":"cloud-baseline.json","id":"aws-workload-ssm-patching"},"resolved_by":[]},
  {"id":"aws-workload-ecr-image-scanning","title":"ECR scan on push and encryption","severity":"medium","refs":[{"framework":"cis-aws","ref":"4.x"}],"evidence":{"connector_type":"aws","capability":"read:cloud.aws","collector":"ecr.repositories"},"seed":{"dataset":"cloud-baseline.json","id":"aws-workload-ecr-image-scanning"},"resolved_by":[]},
  {"id":"aws-data-s3-block-public-access","title":"S3 Block Public Access at account and bucket level","severity":"critical","refs":[{"framework":"cis-aws","ref":"2.1.5"},{"framework":"csf","ref":"PR.DS-01"}],"evidence":{"connector_type":"aws","capability":"read:cloud.aws","collector":"s3.public_access"},"seed":{"dataset":"cloud-baseline.json","id":"aws-data-s3-block-public-access"},"resolved_by":["cloud.block-public-storage"]},
  {"id":"aws-data-default-encryption-kms","title":"Default encryption at rest on S3, EBS, RDS","severity":"high","refs":[{"framework":"cis-aws","ref":"2.1.1"}],"evidence":{"connector_type":"aws","capability":"read:cloud.aws","collector":"ec2.ebs_default_encryption"},"seed":{"dataset":"cloud-baseline.json","id":"aws-data-default-encryption-kms"},"resolved_by":["cloud.enable-ebs-default-encryption"]},
  {"id":"aws-data-backup-recovery","title":"AWS Backup with immutable copies and tested restores","severity":"high","refs":[{"framework":"cis-aws","ref":"2.x"}],"evidence":{"connector_type":"aws","capability":"read:cloud.aws","collector":"backup.vaults"},"seed":{"dataset":"cloud-baseline.json","id":"aws-data-backup-recovery"},"resolved_by":[]}
 ]$$::jsonb, 1),
('backup-verification-aws', 'data', 'Backup verification (AWS)', 'Whether critical data is backed up daily, immutable, copied elsewhere, encrypted, and restore-tested. Auto-answers two ransomware readiness questions.', 'assessment.backup_verification',
 '{read:cloud.aws.backup}', 'assessment.json', $$[
  {"id":"DB:B.Q01","for_check":"aws-backup-plan-covers-critical","text":"Are important systems and data backed up daily to an offsite location with the ability to restore multiple versions?"},
  {"id":"DB:B.Q02","for_check":"aws-backup-restore-tested","text":"Are data backups tested annually?"}
 ]$$::jsonb, $$[
  {"id":"aws-backup-plan-covers-critical","title":"Every RDS instance and tagged-critical volume is in a daily backup plan","severity":"high","refs":[{"framework":"csf","ref":"PR.DS-11"}],"evidence":{"connector_type":"aws","capability":"read:cloud.aws.backup","collector":"backup.plans"},"resolved_by":[],"question":"DB:B.Q01"},
  {"id":"aws-backup-vault-locked","title":"Backup vault lock or Object Lock on the copy destination","severity":"high","refs":[{"framework":"csf","ref":"PR.DS-11"}],"evidence":{"connector_type":"aws","capability":"read:cloud.aws.backup","collector":"backup.vaults"},"resolved_by":[]},
  {"id":"aws-backup-cross-account-copy","title":"Copies to another account or region","severity":"medium","refs":[{"framework":"csf","ref":"PR.DS-11"}],"evidence":{"connector_type":"aws","capability":"read:cloud.aws.backup","collector":"backup.plans"},"resolved_by":[]},
  {"id":"aws-backup-restore-tested","title":"A completed restore job in the last 365 days","severity":"high","refs":[{"framework":"csf","ref":"RC.RP-01"}],"evidence":{"connector_type":"aws","capability":"read:cloud.aws.backup","collector":"backup.restore_jobs"},"resolved_by":[],"question":"DB:B.Q02"},
  {"id":"aws-backup-encrypted","title":"Backup vaults use a KMS key","severity":"medium","refs":[{"framework":"csf","ref":"PR.DS-01"}],"evidence":{"connector_type":"aws","capability":"read:cloud.aws.backup","collector":"backup.vaults"},"resolved_by":[]}
 ]$$::jsonb, 1),
('cloud-inventory-aws', 'network', 'Cloud inventory (AWS)', 'Public hostnames and addresses from the connected account, written to the attack surface asset list as verified.', 'inventory.aws_public',
 '{read:cloud.aws.inventory}', null, null, $$[
  {"id":"aws-inventory-public-assets","title":"Public assets discovered and reconciled with the scan asset list","severity":"info","refs":[{"framework":"csf","ref":"ID.AM-01"}],"evidence":{"connector_type":"aws","capability":"read:cloud.aws.inventory","collector":"inventory.public"},"resolved_by":[]}
 ]$$::jsonb, 1)
on conflict (id) do update set domain = excluded.domain, title = excluded.title, summary = excluded.summary, tool = excluded.tool,
  required_capabilities = excluded.required_capabilities, seed_dataset = excluded.seed_dataset, questionnaire = excluded.questionnaire, checks = excluded.checks, version = excluded.version;

-- ---------------------------------------------------------------------------
-- Playbooks
-- ---------------------------------------------------------------------------
insert into catalog.playbooks (id, domain, title, summary, agent_id, mcp_server_ids, blast_radius, reversible, mode_ceiling, required_capabilities, resolves_checks, call_schema, verification, rollback, default_cadence, version) values
('identity.disable-stale-accounts', 'identity', 'Disable stale accounts', 'Disable enabled accounts with no sign-in in 90 days and revoke their sessions. Never a break-glass account.', 'identity-remediator', '{graph-mcp}', 'low', true, 'autopilot',
 '{write:identity.user-state}', '{entra-stale-accounts}',
 $${"tools":["graph.users.disable","graph.users.revoke_sessions"],"constraints":{"user_id":"in_finding_assets","exclude_tags":["break-glass"],"max_targets":{"autopilot":50}}}$$::jsonb,
 $${"collector":"signin.stale","expect":"pass","on_assets":"same"}$$::jsonb,
 $${"tools":["graph.users.enable"],"restore":"same_user_ids"}$$::jsonb, '0 2 * * 6', 1),
('identity.mfa-registration-campaign', 'identity', 'MFA registration campaign', 'Turn on the registration campaign so users without a strong method are prompted to register at sign-in.', 'identity-remediator', '{graph-mcp}', 'low', true, 'autopilot',
 '{write:identity.auth-methods-policy}', '{entra-mfa-registration-coverage}',
 $${"tools":["graph.auth_methods_policy.set_registration_campaign"],"constraints":{"state":["enabled"],"snooze_days":{"max":14}}}$$::jsonb,
 $${"collector":"auth_methods.registration_report","expect":"trend_up","after_days":14}$$::jsonb,
 $${"tools":["graph.auth_methods_policy.set_registration_campaign"],"restore":"saved_settings"}$$::jsonb, 'on-finding', 1),
('identity.block-legacy-auth', 'identity', 'Block legacy authentication', 'Create a conditional access policy that blocks legacy protocols, first in report-only mode, then enforced in a second sortie.', 'identity-remediator', '{graph-mcp}', 'medium', true, 'clearance',
 '{write:identity.ca-policy}', '{entra-legacy-auth-blocked}',
 $${"tools":["graph.ca_policies.create","graph.ca_policies.set_state"],"constraints":{"state":["enabledForReportingButNotEnforced","enabled"],"policy.grantControls":["block"],"policy.conditions.clientAppTypes":["exchangeActiveSync","other"]}}$$::jsonb,
 $${"collector":"policy.legacy_auth","expect":"pass"}$$::jsonb,
 $${"tools":["graph.ca_policies.set_state"],"restore":"state=disabled"}$$::jsonb, 'on-finding', 1),
('identity.remove-unused-privileged-roles', 'identity', 'Remove unused privileged role assignments', 'Remove privileged role assignments not used in 60 days, keeping at least two Global Administrators.', 'identity-remediator', '{graph-mcp}', 'high', true, 'clearance',
 '{write:identity.role-assignments}', '{entra-global-admin-count,entra-privileged-unused}',
 $${"tools":["graph.role_assignments.remove"],"constraints":{"assignment_id":"in_finding_assets","keep_min_global_admins":2,"exclude_tags":["break-glass"]}}$$::jsonb,
 $${"collector":"roles.unused","expect":"pass"}$$::jsonb,
 $${"tools":["graph.role_assignments.create"],"restore":"saved_role_and_principal"}$$::jsonb, 'on-finding', 1),
('identity.revoke-risky-app-grant', 'identity', 'Revoke a risky OAuth grant', 'Revoke a third-party app grant with high-privilege permissions or an unverified publisher.', 'identity-remediator', '{graph-mcp}', 'medium', true, 'clearance',
 '{write:identity.app-grants}', '{entra-oauth-high-privilege-grants,entra-oauth-unverified-publishers}',
 $${"tools":["graph.oauth_grants.revoke"],"constraints":{"grant_id":"in_finding_assets"}}$$::jsonb,
 $${"collector":"apps.high_privilege","expect":"pass"}$$::jsonb,
 $${"tools":["graph.oauth_grants.create"],"restore":"saved_scopes"}$$::jsonb, 'on-finding', 1),
('cloud.block-public-storage', 'cloud', 'Block public S3 buckets', 'Turn on Block Public Access for buckets that allow public ACLs or policies. Buckets with a static website configuration are skipped and listed.', 'cloud-remediator', '{aws-mcp}', 'low', true, 'autopilot',
 '{write:cloud.aws.s3-public-access}', '{aws-data-s3-block-public-access}',
 $${"tools":["s3.put_public_access_block","s3.put_account_public_access_block"],"constraints":{"bucket":"in_finding_assets","skip_when":"website_config_present","max_targets":{"autopilot":25}}}$$::jsonb,
 $${"collector":"s3.public_access","expect":"pass","on_assets":"same"}$$::jsonb,
 $${"tools":["s3.put_public_access_block"],"restore":"saved_config"}$$::jsonb, 'on-finding', 1),
('cloud.enable-cloudtrail-all-regions', 'cloud', 'Enable multi-region CloudTrail', 'Create a multi-region trail with log file validation into a new locked bucket.', 'cloud-remediator', '{aws-mcp}', 'medium', false, 'clearance',
 '{write:cloud.aws.cloudtrail}', '{aws-logging-cloudtrail-all-regions}',
 $${"tools":["cloudtrail.create_multi_region_trail"],"constraints":{"bucket":"^outpost-cloudtrail-","name":"^outpost-"}}$$::jsonb,
 $${"collector":"cloudtrail.trails","expect":"pass"}$$::jsonb,
 null, 'on-finding', 1),
('cloud.deactivate-stale-access-keys', 'cloud', 'Deactivate stale access keys', 'Set access keys unused for 90 days to Inactive. Never deletes, never touches the root user or a key used in the last 30 days.', 'cloud-remediator', '{aws-mcp}', 'medium', true, 'clearance',
 '{write:cloud.aws.iam-keys}', '{aws-identity-least-privilege-keys}',
 $${"tools":["iam.update_access_key"],"constraints":{"access_key_id":"in_finding_assets","status":["Inactive"],"exclude_users":["root"],"min_unused_days":30}}$$::jsonb,
 $${"collector":"iam.credential_report","expect":"pass","on_assets":"same"}$$::jsonb,
 $${"tools":["iam.update_access_key"],"restore":"status=Active"}$$::jsonb, 'on-finding', 1),
('cloud.set-password-policy', 'cloud', 'Set IAM password policy', 'Apply the CIS password policy: 14 characters, 24 reuse prevention, expiration on.', 'cloud-remediator', '{aws-mcp}', 'low', true, 'autopilot',
 '{write:cloud.aws.password-policy}', '{aws-identity-password-policy}',
 $${"tools":["iam.update_account_password_policy"],"constraints":{"policy.MinimumPasswordLength":{"min":14},"policy.PasswordReusePrevention":{"min":24}}}$$::jsonb,
 $${"collector":"iam.password_policy","expect":"pass"}$$::jsonb,
 $${"tools":["iam.update_account_password_policy"],"restore":"saved_policy"}$$::jsonb, 'on-finding', 1),
('cloud.close-open-admin-ports', 'cloud', 'Close open admin ports', 'Revoke 0.0.0.0/0 and ::/0 ingress to SSH, RDP, and database ports. Refuses groups attached to load balancers.', 'cloud-remediator', '{aws-mcp}', 'high', true, 'clearance',
 '{write:cloud.aws.security-groups}', '{aws-network-restrict-sensitive-ports}',
 $${"tools":["ec2.revoke_security_group_ingress"],"constraints":{"group_id":"in_finding_assets","region":"in_mission_scope","rule.ports":[22,3389,1433,3306,5432,6379,27017],"skip_when":"attached_to_load_balancer"}}$$::jsonb,
 $${"collector":"ec2.security_groups","expect":"pass","on_assets":"same"}$$::jsonb,
 $${"tools":["ec2.authorize_security_group_ingress"],"restore":"exact_rule"}$$::jsonb, 'on-finding', 1),
('cloud.enable-guardduty', 'cloud', 'Enable GuardDuty', 'Create a GuardDuty detector in every opted-in region without one.', 'cloud-remediator', '{aws-mcp}', 'low', true, 'autopilot',
 '{write:cloud.aws.guardduty}', '{aws-logging-guardduty}',
 $${"tools":["guardduty.create_detector"],"constraints":{"region":"in_mission_scope","max_targets":{"autopilot":10}}}$$::jsonb,
 $${"collector":"guardduty.detectors","expect":"pass"}$$::jsonb,
 $${"tools":["guardduty.disable_detector"],"restore":"created_detectors"}$$::jsonb, 'on-finding', 1),
('cloud.enable-ebs-default-encryption', 'cloud', 'Enable EBS default encryption', 'Turn on EBS encryption by default in every opted-in region. Existing volumes are unaffected.', 'cloud-remediator', '{aws-mcp}', 'low', true, 'autopilot',
 '{write:cloud.aws.ebs-encryption}', '{aws-data-default-encryption-kms}',
 $${"tools":["ec2.set_ebs_encryption_by_default"],"constraints":{"region":"in_mission_scope","enabled":[true],"max_targets":{"autopilot":10}}}$$::jsonb,
 $${"collector":"ec2.ebs_default_encryption","expect":"pass"}$$::jsonb,
 $${"tools":["ec2.set_ebs_encryption_by_default"],"restore":"enabled=false"}$$::jsonb, 'on-finding', 1)
on conflict (id) do update set domain = excluded.domain, title = excluded.title, summary = excluded.summary, agent_id = excluded.agent_id,
  mcp_server_ids = excluded.mcp_server_ids, blast_radius = excluded.blast_radius, reversible = excluded.reversible, mode_ceiling = excluded.mode_ceiling,
  required_capabilities = excluded.required_capabilities, resolves_checks = excluded.resolves_checks, call_schema = excluded.call_schema,
  verification = excluded.verification, rollback = excluded.rollback, default_cadence = excluded.default_cadence, version = excluded.version;

reset role;
