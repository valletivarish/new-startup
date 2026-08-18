/**
 * Knowledge endpoints.
 *
 * Every route declares one permission; a foreign id is a 404. The retrieval
 * route deserves particular attention: its organization context is built
 * ENTIRELY from `actorOf(req)` — the request body carries a query and
 * optional narrowing ids, never a tenant.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import type { KnowledgeRetriever } from '@platform/providers';

import { RequirePermission } from '../authz/decorators.js';
import { requireOrganization } from '../authz/auth-context.js';
import type { RequestWithAuth } from '../authz/authz.guard.js';
import { ApiError } from '../errors.js';
import { parse } from '../validate.js';
import { KNOWLEDGE_SERVICE, KNOWLEDGE_RETRIEVER } from '../tokens.more.js';
import type { KnowledgeService } from './knowledge.service.js';
import { MAX_DOCUMENT_BYTES } from './formats.js';

function actorOf(req: RequestWithAuth) {
  const ctx = requireOrganization(
    req.authContext ??
      (() => {
        throw ApiError.unauthorized();
      })(),
  );
  return {
    organizationId: ctx.organization.organizationId,
    userId: ctx.userId,
  };
}

const Uuid = z.string().uuid();

const CreateSource = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional(),
  type: z.enum(['file', 'text', 'faq', 'url_reference']).optional(),
});

const UpdateSource = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(2000).optional(),
});

const CreateDocument = z.object({
  sourceId: z.string().uuid(),
  name: z.string().trim().min(1).max(255),
  // Accept any declared type here so `validateUpload` can explain the
  // rejection in business language ("convert it to .txt or .md") rather than
  // surfacing a schema enum, which tells a user nothing actionable.
  contentType: z.string().trim().min(1).max(160),
  // Bounded here as well as in validateUpload: reject an oversized body
  // before it is decoded rather than after.
  content: z.string().min(1).max(MAX_DOCUMENT_BYTES),
});

/**
 * Retrieval input.
 *
 * Note what this schema does NOT contain: any organization field. There is
 * deliberately no way to express one, so a forged tenant cannot even be
 * parsed, let alone honoured.
 */
const SearchInput = z.object({
  query: z.string().trim().min(1).max(2000),
  topK: z.number().int().min(1).max(50).optional(),
  minSimilarity: z.number().min(0).max(1).optional(),
  sourceIds: z.array(z.string().uuid()).max(50).optional(),
  documentIds: z.array(z.string().uuid()).max(50).optional(),
});

@Controller('knowledge')
export class KnowledgeController {
  constructor(
    @Inject(KNOWLEDGE_SERVICE) private readonly knowledge: KnowledgeService,
    @Inject(KNOWLEDGE_RETRIEVER) private readonly retriever: KnowledgeRetriever,
  ) {}

  // ---- Sources ------------------------------------------------------------

  @RequirePermission('knowledge.read')
  @Get('sources')
  async listSources(@Req() req: RequestWithAuth) {
    return { sources: await this.knowledge.listSources(actorOf(req)) };
  }

  @RequirePermission('knowledge.create')
  @Post('sources')
  async createSource(@Req() req: RequestWithAuth, @Body() body: unknown) {
    return this.knowledge.createSource(actorOf(req), parse(CreateSource, body));
  }

  @RequirePermission('knowledge.read')
  @Get('sources/:id')
  async getSource(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.knowledge.getSource(actorOf(req), parse(Uuid, id));
  }

  @RequirePermission('knowledge.update')
  @Patch('sources/:id')
  async updateSource(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.knowledge.updateSource(
      actorOf(req),
      parse(Uuid, id),
      parse(UpdateSource, body),
    );
    return { updated: true };
  }

  @RequirePermission('knowledge.delete')
  @Delete('sources/:id')
  async deleteSource(@Req() req: RequestWithAuth, @Param('id') id: string) {
    await this.knowledge.deleteSource(actorOf(req), parse(Uuid, id));
    return { deleted: true };
  }

  // ---- Documents ----------------------------------------------------------

  @RequirePermission('knowledge.read')
  @Get('documents')
  async listDocuments(
    @Req() req: RequestWithAuth,
    @Query('sourceId') sourceId?: string,
  ) {
    const filter = sourceId ? parse(Uuid, sourceId) : undefined;
    return { documents: await this.knowledge.listDocuments(actorOf(req), filter) };
  }

  @RequirePermission('knowledge.create')
  @Post('documents')
  async createDocument(@Req() req: RequestWithAuth, @Body() body: unknown) {
    return this.knowledge.createDocument(actorOf(req), parse(CreateDocument, body));
  }

  @RequirePermission('knowledge.read')
  @Get('documents/:id')
  async getDocument(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.knowledge.getDocument(actorOf(req), parse(Uuid, id));
  }

  @RequirePermission('knowledge.delete')
  @Delete('documents/:id')
  async deleteDocument(@Req() req: RequestWithAuth, @Param('id') id: string) {
    await this.knowledge.deleteDocument(actorOf(req), parse(Uuid, id));
    return { deleted: true };
  }

  /** Re-indexing is `knowledge.reindex` — distinct from editing content. */
  @RequirePermission('knowledge.reindex')
  @Post('documents/:id/reindex')
  async reindex(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.knowledge.reindexDocument(actorOf(req), parse(Uuid, id));
  }

  // ---- Retrieval ----------------------------------------------------------

  /**
   * Search the organization's knowledge.
   *
   * The retrieval context is assembled from the session only. Narrowing ids
   * are passed through, and a foreign id simply matches nothing because RLS
   * and the explicit tenant filter both still apply.
   */
  @RequirePermission('knowledge.read')
  @Post('search')
  async search(@Req() req: RequestWithAuth, @Body() body: unknown) {
    const actor = actorOf(req);
    const input = parse(SearchInput, body);

    const result = await this.retriever.retrieve(
      input.query,
      {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        ...(input.sourceIds ? { sourceIds: input.sourceIds } : {}),
        ...(input.documentIds ? { documentIds: input.documentIds } : {}),
      },
      {
        ...(input.topK !== undefined ? { topK: input.topK } : {}),
        ...(input.minSimilarity !== undefined
          ? { minSimilarity: input.minSimilarity }
          : {}),
      },
    );

    return {
      outcome: result.outcome,
      chunks: result.chunks,
      ...(result.error ? { error: result.error } : {}),
    };
  }
}
