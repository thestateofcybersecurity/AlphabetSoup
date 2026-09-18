# Connector spec: AWS

**Status:** draft v0.1 (2026-09-18). Follows the [connector contract](README.md). Catalog rows in [seed.sql](seed.sql).

| Field | Value |
|---|---|
| `id` | `aws` |
| `family` | `cloud` |
| `auth_kind` | `aws-role` (cross-account IAM role, ExternalId) |
| Identity | The customer's AWS account id (or organization id), verified on `complete` |
| Unlocks | Cloud CIS Foundations (AWS), Backup verification, Cloud inventory for the attack surface scanner |

---

## 1. Authentication model

Outpost never holds AWS access keys. The customer creates an IAM role in their account that trusts Outpost's **run-worker role** and requires a per-tenant **ExternalId**. Outpost assumes that role for one run at a time.

- **Two roles, not one.** `OutpostReadOnly` carries the read scope. `OutpostRemediation` carries only the write statements for the playbooks the customer has enabled, is created only when the first write capability is requested, and can be deleted without touching reads.
- **ExternalId** is generated per tenant and per connector (`<slug>-<random>`), shown to the customer in the Hangar, and stored in the secret record. It is the confused-deputy defence: another Outpost tenant cannot name this role and get in.
- **Session identity.** Every `AssumeRole` sets `RoleSessionName = <run id>`, `SourceIdentity = outpost:<tenant slug>`, and session tags `outpost:tenant`, `outpost:run`, `outpost:playbook`. The customer's CloudTrail then shows exactly which sortie made each call. The trust policy requires `sts:TagSession` and `sts:SetSourceIdentity`.
- **Session duration** is 1 hour; the role's `MaxSessionDuration` stays at the default so a stolen session dies quickly.
- **Organizations.** For multi-account customers the same two roles deploy to every member account through a CloudFormation StackSet from the management account; the connector records the organization id and enumerates accounts with `organizations:ListAccounts` from a management-account role that has nothing else. Scope selection is then per account.

### Flow

1. Consultant or customer admin: `POST /connectors {type_id: "aws", requested_scopes: ["read:cloud.aws", "read:cloud.aws.inventory", "read:cloud.aws.backup"]}`. Server generates the ExternalId and the CloudFormation template (§3).
2. **Customer admin** applies the template in their account (console quick-create link or CLI) and copies the created role ARN.
3. Customer admin: `POST /connectors/{id}/complete {role_arn}`.
4. Server assumes the role once with the ExternalId, calls `sts:GetCallerIdentity`, compares the account id to `external_ref.aws_account_id` if the consultant pre-filled it (otherwise records it), runs the health check, and stores `{role_arn, external_id}` envelope-encrypted.
5. A consultant calling `complete` gets `403 customer_must_complete`.

## 2. Capabilities and IAM permissions

| Capability | Granted through | Unlocks |
|---|---|---|
| `read:cloud.aws` | AWS managed `SecurityAudit` + `ViewOnlyAccess` (job function) | Cloud CIS Foundations (AWS) |
| `read:cloud.aws.inventory` | Statement: `ec2:DescribeAddresses`, `ec2:DescribeInstances`, `ec2:DescribeNetworkInterfaces`, `elasticloadbalancing:DescribeLoadBalancers`, `route53:ListHostedZones`, `route53:ListResourceRecordSets`, `cloudfront:ListDistributions`, `apigateway:GET`, `s3:GetBucketWebsite`, `globalaccelerator:ListAccelerators` (most already in ViewOnlyAccess; listed so the capability survives a policy change) | Public hostnames and IPs feed `scan_assets` as verified, `source: aws-inventory` |
| `read:cloud.aws.backup` | Statement: `backup:ListBackupVaults`, `backup:DescribeBackupVault`, `backup:ListBackupPlans`, `backup:GetBackupPlan`, `backup:ListRecoveryPointsByBackupVault`, `backup:ListRestoreJobs`, `rds:DescribeDBSnapshots`, `ec2:DescribeSnapshots`, `s3:GetBucketVersioning`, `s3:GetBucketObjectLockConfiguration` | Backup verification |
| `write:cloud.aws.s3-public-access` | `s3:GetBucketPublicAccessBlock`, `s3:PutBucketPublicAccessBlock`, `s3:GetAccountPublicAccessBlock`, `s3:PutAccountPublicAccessBlock` | `cloud.block-public-storage` |
| `write:cloud.aws.cloudtrail` | `cloudtrail:CreateTrail`, `cloudtrail:UpdateTrail`, `cloudtrail:StartLogging`, `cloudtrail:PutEventSelectors`, `s3:CreateBucket`, `s3:PutBucketPolicy`, `s3:PutBucketPublicAccessBlock` (on `arn:aws:s3:::outpost-cloudtrail-*` only), `kms:CreateKey` optional | `cloud.enable-cloudtrail-all-regions` |
| `write:cloud.aws.iam-keys` | `iam:ListAccessKeys`, `iam:GetAccessKeyLastUsed`, `iam:UpdateAccessKey` (never `DeleteAccessKey`) | `cloud.deactivate-stale-access-keys` |
| `write:cloud.aws.password-policy` | `iam:UpdateAccountPasswordPolicy`, `iam:GetAccountPasswordPolicy` | `cloud.set-password-policy` |
| `write:cloud.aws.security-groups` | `ec2:RevokeSecurityGroupIngress`, `ec2:AuthorizeSecurityGroupIngress` (rollback only) | `cloud.close-open-admin-ports` |
| `write:cloud.aws.guardduty` | `guardduty:CreateDetector`, `guardduty:UpdateDetector`, `guardduty:ListDetectors`, `iam:CreateServiceLinkedRole` for `guardduty.amazonaws.com` | `cloud.enable-guardduty` |
| `write:cloud.aws.ebs-encryption` | `ec2:EnableEbsEncryptionByDefault`, `ec2:DisableEbsEncryptionByDefault` (rollback only), `ec2:GetEbsEncryptionByDefault` | `cloud.enable-ebs-default-encryption` |

`OutpostRemediation` carries a **permissions boundary** that denies `iam:*` except the two key and password-policy actions above, denies `organizations:*`, `account:*`, `sts:AssumeRole`, and anything on `arn:aws:iam::*:role/Outpost*`, so a playbook can never widen its own access.

## 3. Trust instructions shown in the Hangar

> **Connect AWS (read only).**
> 1. Open the quick-create link below in the AWS account you want assessed. It creates one IAM role, `OutpostReadOnly`, with the AWS-managed `SecurityAudit` and `ViewOnlyAccess` policies and a small read statement for backups and public inventory.
> 2. The role trusts only Outpost's run-worker role and only with your ExternalId, shown below. Do not share the ExternalId.
> 3. Copy the role ARN from the stack outputs and paste it here. Outpost assumes the role once to verify the account id and check permissions.
>
> Nothing in this step can change your account. Write permissions live in a separate role that is only created when you enable a playbook that needs it.

CloudFormation template for the read role (the write role template is generated per enabled playbook from the statements in §2):

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Description: Outpost read-only assessment role
Parameters:
  OutpostRunWorkerRoleArn: { Type: String }
  ExternalId: { Type: String, NoEcho: true }
Resources:
  OutpostReadOnly:
    Type: AWS::IAM::Role
    Properties:
      RoleName: OutpostReadOnly
      MaxSessionDuration: 3600
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Principal: { AWS: !Ref OutpostRunWorkerRoleArn }
            Action: [ "sts:AssumeRole", "sts:TagSession", "sts:SetSourceIdentity" ]
            Condition:
              StringEquals: { "sts:ExternalId": !Ref ExternalId }
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/SecurityAudit
        - arn:aws:iam::aws:policy/job-function/ViewOnlyAccess
      Policies:
        - PolicyName: OutpostSupplementalRead
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Effect: Allow
                Action:
                  - backup:ListBackupVaults
                  - backup:DescribeBackupVault
                  - backup:ListBackupPlans
                  - backup:GetBackupPlan
                  - backup:ListRecoveryPointsByBackupVault
                  - backup:ListRestoreJobs
                  - s3:GetBucketVersioning
                  - s3:GetBucketObjectLockConfiguration
                  - s3:GetBucketWebsite
                  - route53:ListHostedZones
                  - route53:ListResourceRecordSets
                  - cloudfront:ListDistributions
                  - globalaccelerator:ListAccelerators
                Resource: "*"
Outputs:
  RoleArn: { Value: !GetAtt OutpostReadOnly.Arn }
```

## 4. Health check

1. `AssumeRole` with the ExternalId, source identity, and tags. A failure here is `trust_not_completed`.
2. `sts:GetCallerIdentity`; compare the account to `external_ref` (`identity_mismatch` on difference).
3. `iam:SimulatePrincipalPolicy` for one representative action per capability (`cloudtrail:DescribeTrails`, `backup:ListBackupVaults`, `route53:ListHostedZones`, and each enabled write action) to derive capabilities without making real calls.
4. `ec2:DescribeRegions` with `AllRegions=false` to record the opted-in regions; regions not opted in are listed as a warning.
5. `organizations:DescribeOrganization` (ignore `AccessDenied`) to record whether this is a management account.

## 5. Scope model

`scope = { accounts: [...], regions: [...] }`. Default is the connected account and every opted-in region. The call wrapper stamps the region on every client and refuses a call whose target ARN names an account outside scope. Global services (IAM, S3 listing, Route 53, CloudFront) are evaluated once per account.

## 6. Missions

### `cloud-cis-foundations-aws` (quarterly; requires `read:cloud.aws`)

Twenty checks, one per AWS control in the site's `cloud-baseline.json`, so the plain-English rationale, priority, and framework mapping come from the dataset. `severity` follows the dataset's `priority` (critical, high, standard becomes medium).

| Check id (dataset id) | Severity | Collector and evidence |
|---|---|---|
| `aws-identity-root-mfa` | critical | `iam.account_summary`: `AccountMFAEnabled` |
| `aws-identity-remove-root-keys` | critical | `iam.account_summary`: `AccountAccessKeysPresent` |
| `aws-identity-password-policy` | high | `iam.password_policy`: length ≥ 14, reuse prevention ≥ 24 |
| `aws-identity-mfa-all-users` | critical | `iam.credential_report`: console users without MFA |
| `aws-identity-sso-identity-center` | high | `sso.instances` and `iam.credential_report`: human console users outside Identity Center |
| `aws-identity-least-privilege-keys` | high | `iam.credential_report`: keys unused or unrotated for 90 days |
| `aws-logging-cloudtrail-all-regions` | critical | `cloudtrail.trails`: a multi-region trail, logging, log file validation on |
| `aws-logging-config-enabled` | high | `config.recorders` per region |
| `aws-logging-central-log-integrity` | high | `cloudtrail.trails` bucket + `s3.object_lock` + `s3.versioning` + bucket policy public check |
| `aws-logging-guardduty` | high | `guardduty.detectors` per region, enabled |
| `aws-network-restrict-sensitive-ports` | critical | `ec2.security_groups`: 0.0.0.0/0 or ::/0 to 22, 3389, 1433, 3306, 5432, 6379, 27017 |
| `aws-network-default-sg-hygiene` | medium | `ec2.security_groups`: default groups with any rule |
| `aws-network-vpc-flow-logs` | high | `ec2.flow_logs` per VPC |
| `aws-network-private-subnets` | high | `rds.instances` + `ec2.subnets`: databases in subnets with a route to an internet gateway |
| `aws-workload-imdsv2` | high | `ec2.instances` + `ec2.launch_templates`: `HttpTokens` not `required` |
| `aws-workload-ssm-patching` | high | `ssm.managed_instances` vs `ec2.instances`; `ec2.key_pairs` in use |
| `aws-workload-ecr-image-scanning` | medium | `ecr.repositories`: scan on push, encryption |
| `aws-data-s3-block-public-access` | critical | `s3.public_access`: account block + per-bucket block |
| `aws-data-default-encryption-kms` | high | `s3.default_encryption`, `ec2.ebs_default_encryption`, `rds.instances` storage encryption |
| `aws-data-backup-recovery` | high | `backup.vaults` (lock), `backup.plans`, `backup.restore_jobs` in 365 days |

### `backup-verification-aws` (monthly; requires `read:cloud.aws.backup`)

Seeded from the Ransomware readiness questions `DB:B.Q01` (daily offsite backups with multiple versions) and `DB:B.Q02` (restores tested annually), plus the dataset control `aws-data-backup-recovery`, so this mission can auto-answer those two questionnaire items.

| Check id | Severity | Collector |
|---|---|---|
| `aws-backup-plan-covers-critical` | high | `backup.plans`: every RDS instance and tagged-critical EC2 volume is in a plan with daily frequency |
| `aws-backup-vault-locked` | high | `backup.vaults`: vault lock in compliance mode, or S3 Object Lock on the copy destination |
| `aws-backup-cross-account-copy` | medium | `backup.plans`: a copy action to another account or region |
| `aws-backup-restore-tested` | high | `backup.restore_jobs`: at least one completed restore job in 365 days |
| `aws-backup-encrypted` | medium | `backup.vaults`: KMS key set |

### `cloud-inventory-aws` (weekly; requires `read:cloud.aws.inventory`)

Not a scored mission. Produces verified `scan_assets` (`kind: host | domain`, `source: aws-inventory`) from elastic IPs, public instance addresses, public load balancers, CloudFront distributions, Route 53 public zones, and S3 website endpoints, and retires assets that disappear. This is what lets the attack surface scanner probe without a DNS challenge for cloud-hosted assets.

## 7. Playbooks

| Playbook | Write capability | Blast radius | Reversible | Mode ceiling | Preview shows | Verify | Rollback |
|---|---|---|---|---|---|---|---|
| `cloud.block-public-storage` | `write:cloud.aws.s3-public-access` | low | yes | autopilot | Each bucket, current block settings, target settings; skips buckets with a static website config and lists them for a human | `s3.public_access` on the same buckets | `PutBucketPublicAccessBlock` with the saved settings |
| `cloud.enable-cloudtrail-all-regions` | `write:cloud.aws.cloudtrail` | medium | partly | clearance | Trail name, bucket name and policy, regions, log validation | `cloudtrail.trails` | Stop logging and leave the trail for a human to delete |
| `cloud.deactivate-stale-access-keys` | `write:cloud.aws.iam-keys` | medium | yes | clearance | Each key id, user, last used date; never the root user; never a key used in 30 days | `iam.credential_report` | `UpdateAccessKey` status `Active` |
| `cloud.set-password-policy` | `write:cloud.aws.password-policy` | low | yes | autopilot | Current and target policy diff | `iam.password_policy` | Restore saved policy |
| `cloud.close-open-admin-ports` | `write:cloud.aws.security-groups` | high | yes | clearance | Each group, rule, attached instances; refuses groups attached to load balancers | `ec2.security_groups` | Re-authorize the exact rule |
| `cloud.enable-guardduty` | `write:cloud.aws.guardduty` | low | yes | autopilot | Regions where a detector will be created | `guardduty.detectors` | Disable the created detectors |
| `cloud.enable-ebs-default-encryption` | `write:cloud.aws.ebs-encryption` | low | yes | autopilot | Regions, note that existing volumes are unaffected | `ec2.ebs_default_encryption` | Disable in the same regions |

Constraints in `call_schema`: every `bucket`, `access_key_id`, `group_id`, or region must appear in the resolving finding's assets; Autopilot sorties cap at 25 buckets or 10 regions per run; a write in a region outside mission scope is refused by the wrapper.

## 8. Failure modes

| Condition | Handling |
|---|---|
| Role deleted or trust edited | `AssumeRole` fails; connector `expired`; customer notified with the template to re-apply |
| An SCP denies an action | `AccessDenied` on a collector is `unknown` evidence with the denied action named; on a write, the sortie fails closed and the Briefing names the SCP |
| Regions not opted in | Skipped with a health warning; the mission scope excludes them |
| Throttling | Backoff per service; `DescribeInstances` and similar are paginated with filters per region |
| Management account without member roles | Organization recorded; missions run on the management account only until the StackSet is deployed; Hangar shows "12 of 14 accounts connected" |
| Customer rotates the ExternalId | Old sessions die within the hour; customer re-runs `complete`; audited |
