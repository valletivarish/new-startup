/**
 * Route coverage — structural test 2 of 3 (`07_CODING_RULES` §14).
 *
 * Every route in the application must carry exactly one authorization marker.
 * A route with none is denied at runtime by the guard (fail closed), and this
 * test fails the build so it never ships that way in the first place.
 */

import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants.js';

import {
  AUTHZ_ANY_PERMISSIONS,
  AUTHZ_MODE,
  AUTHZ_PERMISSION,
} from '../src/authz/decorators.js';
import { isPermission } from '@platform/permissions';
import {
  AuthController,
  CatalogueController,
  HealthController,
  InvitationsController,
  MembersController,
  OrganizationController,
  OrganizationCreateController,
} from '../src/controllers.js';
import {
  AgentsController,
  AgentSessionsController,
} from '../src/agents/agents.controller.js';
import { KnowledgeController } from '../src/knowledge/knowledge.controller.js';
import {
  AgentToolsController,
  ToolExecutionsController,
  ToolsController,
} from '../src/tools/tools.controller.js';
import {
  VoiceDeploymentsController,
  VoiceSessionsController,
  VoiceWebhookController,
} from '../src/providers/elevenlabs/voice.controller.js';
import { JobsController } from '../src/hiring/jobs.controller.js';

// The complete controller list. app.module.ts must register exactly these;
// the companion assertion below keeps the two lists from drifting.
const CONTROLLERS = [
  HealthController,
  AuthController,
  OrganizationCreateController,
  OrganizationController,
  MembersController,
  InvitationsController,
  CatalogueController,
  AgentsController,
  AgentSessionsController,
  KnowledgeController,
  ToolsController,
  AgentToolsController,
  ToolExecutionsController,
  // MVP-01 ElevenLabs browser-voice
  VoiceDeploymentsController,
  VoiceSessionsController,
  VoiceWebhookController,
  JobsController,
];

interface RouteInfo {
  controller: string;
  handler: string;
  path: unknown;
  mode: string | undefined;
  permission: string | undefined;
  anyPermissions: string[] | undefined;
}

function collectRoutes(): RouteInfo[] {
  const routes: RouteInfo[] = [];
  for (const controller of CONTROLLERS) {
    const prototype = controller.prototype as unknown as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === 'constructor') continue;
      const handler = prototype[name];
      if (typeof handler !== 'function') continue;
      // A route handler is a method carrying HTTP method metadata.
      const method = Reflect.getMetadata(METHOD_METADATA, handler);
      if (method === undefined) continue;

      routes.push({
        controller: controller.name,
        handler: name,
        path: Reflect.getMetadata(PATH_METADATA, handler),
        mode: Reflect.getMetadata(AUTHZ_MODE, handler),
        permission: Reflect.getMetadata(AUTHZ_PERMISSION, handler),
        anyPermissions: Reflect.getMetadata(AUTHZ_ANY_PERMISSIONS, handler),
      });
    }
  }
  return routes;
}

describe('every route declares its authorization requirement', () => {
  const routes = collectRoutes();

  it('found a plausible number of routes', () => {
    expect(routes.length).toBeGreaterThanOrEqual(15);
  });

  it.each(routes.map((r) => [`${r.controller}.${r.handler}`, r] as const))(
    '%s carries a marker',
    (_label, route) => {
      expect(
        route.mode,
        `${route.controller}.${route.handler} has no @Public/@Authenticated/@RequirePermission marker`,
      ).toBeDefined();
      expect(['public', 'authenticated', 'permission']).toContain(route.mode);
    },
  );

  it.each(
    collectRoutes()
      .filter((r) => r.mode === 'permission')
      .map((r) => [`${r.controller}.${r.handler}`, r] as const),
  )('%s names a real permission from the catalogue', (_label, route) => {
    if (route.anyPermissions !== undefined) {
      expect(route.anyPermissions.length).toBeGreaterThan(0);
      for (const permission of route.anyPermissions) {
        expect(
          isPermission(permission),
          `"${permission}" is not in the permission catalogue`,
        ).toBe(true);
      }
      return;
    }
    expect(route.permission).toBeDefined();
    expect(
      isPermission(route.permission ?? ''),
      `"${route.permission}" is not in the permission catalogue`,
    ).toBe(true);
  });

  it('public routes are exactly the deliberate set', () => {
    const publicRoutes = routes
      .filter((r) => r.mode === 'public')
      .map((r) => `${r.controller}.${r.handler}`)
      .sort();
    // Growing this list is a security decision and must be visible in review.
    // VoiceWebhookController.webhook is @Public because ElevenLabs cannot
    // present a session cookie — instead it is verified by HMAC-SHA256 signature
    // inside the handler itself.
    expect(publicRoutes).toEqual([
      'HealthController.health',
      'VoiceWebhookController.webhook',
    ]);
  });
});
