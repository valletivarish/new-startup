# ADR-009 — Administrators manage custom roles

**Status:** ACCEPTED — founder instruction, 2026-10-01 ("permissions configurable at admin level")
**Date:** 2026-10-01
**Amends:** `11_PERMISSION_MATRIX.md`. The `roles.manage` row changes for Administrators (ADM `·` → ✅). The "Custom organization-defined roles" bullet under "Deliberately out of scope for MVP" no longer applies. The matrix document keeps its 2026-08-16 table and carries a dated change note that points here. ADR-004 is unchanged.
**Relates to:** ADR-004 (permission model), ADR-008 (Java backend; custom roles), migrations `0024_custom_role_permissions.sql` and `0028_administrator_manages_roles.sql`

---

## Context

Custom organization-defined roles now exist. Migration 0024 lets the application write grants, but only for the current company's own custom roles. The accepted matrix kept `roles.manage` Owner-only, so an Administrator, the role that runs the team day to day, got `403` in the role editor. The founder asked for permissions to be configurable at admin level.

## Decision

Administrators hold `roles.manage` (and `roles.read`, which they already had). Migration `0028_administrator_manages_roles.sql` adds the grant. The other rules stay exactly as they are and are enforced in the API, not the UI:

1. **You can only grant what you hold.** An Administrator holds every permission except `organization.delete` and `billing.manage`, so a role an Administrator creates or edits can never contain those two.
2. **You cannot edit, delete or assign a role with more access than you hold.** A custom role an Owner built with `billing.manage` stays out of an Administrator's reach.
3. **Only an Owner grants or revokes Owner,** and an Administrator cannot modify an Owner's membership (matrix structural invariants 2 and 3).
4. **No self-lockout.** You cannot remove your own `roles.manage`, `roles.assign` or `users.deactivate` through a role you hold.
5. **Built-in roles are read-only,** and a role cannot be deleted while members or pending invites use it.
6. Every create, edit and delete is audited (`role.created`, `role.updated`, `role.deleted`). Permission edits apply on the affected members' next request.

## Consequences

- **Administrators can build and assign roles up to their own power without involving an Owner.** Owner-only power stays with Owners.
- **The Nest permission package now lags the database.** `packages/permissions/src/roles.ts` (`ADMINISTRATOR_PERMISSIONS`) still omits `roles.manage`. That package was out of bounds for this change, so the Nest test `schema-drift.test.ts › role administrator holds exactly its declared permissions` fails until it gets the same one-line addition. The Java API's matrix (`Permissions.SYSTEM_ROLES`) is updated, and its structural test passes.
- **Evidence:** `TeamOnboardingTest.administratorsManageCustomRolesWithinTheirOwnPower` covers create, edit and delete, and refusals for Owner-only grants, Owner-built roles, Owner assignment and Owner invites.

## Rollback

A new migration deletes the Administrator → `roles.manage` grant. No data migration is needed: existing custom roles stay valid, and only who can edit them changes.
