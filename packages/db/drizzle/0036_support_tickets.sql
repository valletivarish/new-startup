-- ---------------------------------------------------------------------------
-- Support tickets: one inbox for dashboard, live chat, email, API and MCP.
--
-- support_tickets   organization_id is NULLABLE. NULL = a platform-level
--                   ticket from someone with no account (website chat, email
--                   from an unknown sender). No tenant can ever see one:
--                   the tenant policy is `organization_id = current_org_id()`
--                   and NULL never equals anything. The platform admin
--                   (app.platform_admin = 'on', set by the API after it checks
--                   PLATFORM_ADMIN_EMAILS) sees and writes every ticket, and is
--                   the only one who can link an unassigned ticket to a company.
--
--                   A one-table design was chosen over a separate platform
--                   table so one inbox, one thread model and one set of
--                   policies serve both; the NULL org is the fail-closed case.
--
-- Pre-tenant lookups (logged-out visitor polling by token, inbound email by
-- ticket ref, the 5-minute unanswered-chat job) set a transaction-local
-- setting; SELECT-only policies expose exactly the matching ticket. Writes
-- through a lookup are allowed only on unassigned tickets; replies on a
-- company ticket are written under that company's tenant context.
--
-- support_messages  carries no organization_id: every policy delegates to the
--                   ticket's visibility (the EXISTS subquery is itself RLS
--                   filtered), so a message is visible exactly when its ticket
--                   is. Messages are append-only (no UPDATE/DELETE grant).
--
-- Also: the `support.use` permission, held by every system role (anyone in a
-- company may ask for help), and the `support` API key scope maps onto it.
-- ---------------------------------------------------------------------------

CREATE TABLE "support_tickets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,
  "ref" text NOT NULL UNIQUE CHECK ("ref" ~ '^[a-z0-9]{12}$'),
  "visitor_token_hash" text UNIQUE,
  "subject" text NOT NULL CHECK (length("subject") BETWEEN 1 AND 200),
  "status" text NOT NULL DEFAULT 'open'
    CHECK ("status" IN ('open', 'waiting_on_us', 'waiting_on_customer', 'solved')),
  "channel" text NOT NULL CHECK ("channel" IN ('dashboard', 'chat', 'email', 'api', 'mcp')),
  "job_id" uuid,
  "candidate_id" uuid,
  "call_id" uuid,
  "requester_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "requester_email" text NOT NULL,
  "requester_name" text,
  "context" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "support_tickets_org_idx" ON "support_tickets" ("organization_id", "last_message_at");
--> statement-breakpoint
CREATE INDEX "support_tickets_status_idx" ON "support_tickets" ("status", "last_message_at");
--> statement-breakpoint

CREATE TABLE "support_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ticket_id" uuid NOT NULL REFERENCES "support_tickets"("id") ON DELETE CASCADE,
  "author_kind" text NOT NULL CHECK ("author_kind" IN ('customer', 'staff', 'system')),
  "author_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "author_email" text,
  "body" text NOT NULL CHECK (length("body") BETWEEN 1 AND 20000),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "support_messages_ticket_idx" ON "support_messages" ("ticket_id", "created_at");
--> statement-breakpoint

ALTER TABLE "support_tickets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "support_tickets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "support_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "support_messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "support_tickets_tenant_isolation" ON "support_tickets" FOR ALL
  USING ("organization_id" = current_org_id()) WITH CHECK ("organization_id" = current_org_id());
--> statement-breakpoint
CREATE POLICY "support_tickets_platform_admin" ON "support_tickets" FOR ALL
  USING (is_platform_admin()) WITH CHECK (is_platform_admin());
--> statement-breakpoint
CREATE POLICY "support_tickets_lookup" ON "support_tickets" FOR SELECT
  USING (
    "ref" = NULLIF(current_setting('app.support_ticket_ref', true), '')
    OR "visitor_token_hash" = NULLIF(current_setting('app.support_visitor_token_hash', true), '')
  );
--> statement-breakpoint
-- A visitor or an inbound email may open an unassigned ticket, and only the one it names.
CREATE POLICY "support_tickets_lookup_insert" ON "support_tickets" FOR INSERT
  WITH CHECK (
    "organization_id" IS NULL
    AND "ref" = NULLIF(current_setting('app.support_ticket_ref', true), '')
  );
--> statement-breakpoint
CREATE POLICY "support_tickets_lookup_update" ON "support_tickets" FOR UPDATE
  USING (
    "organization_id" IS NULL AND (
      "ref" = NULLIF(current_setting('app.support_ticket_ref', true), '')
      OR "visitor_token_hash" = NULLIF(current_setting('app.support_visitor_token_hash', true), '')
    )
  )
  WITH CHECK (
    "organization_id" IS NULL AND (
      "ref" = NULLIF(current_setting('app.support_ticket_ref', true), '')
      OR "visitor_token_hash" = NULLIF(current_setting('app.support_visitor_token_hash', true), '')
    )
  );
--> statement-breakpoint
CREATE POLICY "support_messages_via_ticket" ON "support_messages" FOR ALL
  USING (EXISTS (SELECT 1 FROM "support_tickets" t WHERE t."id" = "ticket_id"))
  WITH CHECK (EXISTS (SELECT 1 FROM "support_tickets" t WHERE t."id" = "ticket_id"));
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON "support_tickets" TO platform_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "support_messages" TO platform_app;
--> statement-breakpoint
-- Default privileges hand the app role everything; tickets are never deleted
-- (a company's deletion cascades) and messages are append-only.
REVOKE DELETE, TRUNCATE ON "support_tickets" FROM platform_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "support_messages" FROM platform_app;
--> statement-breakpoint

INSERT INTO "permissions" ("key", "resource", "action", "description", "is_sensitive") VALUES
  ('support.use', 'support', 'use', 'use on support', false)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r CROSS JOIN "permissions" p
WHERE r."organization_id" IS NULL AND r."is_system" AND p."key" = 'support.use'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
