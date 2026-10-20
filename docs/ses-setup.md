# Amazon SES setup (ADR-0027)

AWS side, in order. Use one region everywhere (`AWS_REGION`).

1. **Verify the sending domain.** SES > Identities > Create identity > Domain. Enable Easy DKIM and publish the three CNAME records. Optionally set a custom MAIL FROM domain (SPF alignment) and a DMARC record.
2. **Create the SNS topic** (standard), for example `creatucurso-ses-events`. Access policy so SES can publish (replace region, account id and topic):
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Principal": { "Service": "ses.amazonaws.com" },
       "Action": "sns:Publish",
       "Resource": "arn:aws:sns:REGION:ACCOUNT_ID:creatucurso-ses-events",
       "Condition": { "StringEquals": { "AWS:SourceAccount": "ACCOUNT_ID" } }
     }]
   }
   ```
3. **Subscribe the webhook.** SNS > Subscriptions > Create: protocol HTTPS, endpoint `https://app.<domain>/api/webhooks/ses`. The app confirms the subscription by itself (needs `SES_SNS_TOPIC_ARN` set and the app running). Leave raw message delivery off.
4. **IAM user** for the app, with this policy, and an access key:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": [
         "ses:SendEmail",
         "ses:CreateConfigurationSet",
         "ses:CreateConfigurationSetEventDestination",
         "ses:PutConfigurationSetSendingOptions",
         "ses:GetConfigurationSet"
       ],
       "Resource": "*"
     }]
   }
   ```
   `ses:SendEmail` is also checked against the identity and configuration set ARNs; `*` is simplest, or list `arn:aws:ses:REGION:ACCOUNT_ID:identity/<domain>` and `configuration-set/*`.
5. **Environment** (see `.env.example`): `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `SES_FROM_EMAIL` (or `EMAIL_FROM`) on a verified domain, `SES_SNS_TOPIC_ARN`, optional `SES_PLATFORM_CONFIGURATION_SET`, `PLATFORM_ADMIN_EMAIL`.
6. **Provision existing academies:** `node scripts/provision-ses-tenants.ts` (new academies are provisioned automatically). Resume a paused academy: `node scripts/resume-ses-tenant.ts <organizationId>`.
7. **PENDING: request production access (sandbox exit).** SES > Account dashboard > Request production access. Mail type: Transactional. Website: the platform URL. Write: the platform lets course creators send automated emails to their own students (enrollment and course completion), plus account verification and password reset; recipients are people who enrolled or signed up; every message has a one-click unsubscribe link and `List-Unsubscribe` header; hard bounces and complaints are received through SNS, suppressed globally, and an academy is paused automatically above 5% hard bounces or 0.1% complaints; each academy has its own configuration set; expected volume (state a daily/monthly number). Until approved, SES only delivers to verified addresses.
