-- Nullable for existing accounts: never manufacture historical acceptance.
-- Metadata remains server-owned under the existing users RLS/revocations.
ALTER TABLE public.users
  ADD COLUMN "registrationPolicyVersion" VARCHAR(24),
  ADD COLUMN "termsAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "privacyAcknowledgedAt" TIMESTAMP(3),
  ADD COLUMN "adultDeclaredAt" TIMESTAMP(3);
ALTER TABLE public.users ADD CONSTRAINT users_registration_policy_complete CHECK (
  ("registrationPolicyVersion" IS NULL AND "termsAcceptedAt" IS NULL AND "privacyAcknowledgedAt" IS NULL AND "adultDeclaredAt" IS NULL)
  OR ("registrationPolicyVersion" IS NOT NULL AND "termsAcceptedAt" IS NOT NULL AND "privacyAcknowledgedAt" IS NOT NULL AND "adultDeclaredAt" IS NOT NULL)
);
