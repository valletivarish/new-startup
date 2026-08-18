-- ---------------------------------------------------------------------------
-- Phase 3 knowledge tables: row-level security, privileges, and vector index.
--
-- Organization knowledge is potentially confidential (`02_BRD` §7), so the
-- posture is unchanged from Phases 1 and 2: ENABLE + FORCE on every table,
-- USING and WITH CHECK both on current_org_id(), runtime role holds DML only.
--
-- `knowledge_chunks` carries organization_id DIRECTLY rather than reaching it
-- through the document. That matters for vector search specifically: the
-- tenant predicate must sit on the same table the similarity scan reads, so
-- it cannot be reordered behind a join.
-- ---------------------------------------------------------------------------

ALTER TABLE "knowledge_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_sources" FORCE ROW LEVEL SECURITY;
CREATE POLICY "knowledge_sources_tenant_isolation" ON "knowledge_sources"
  FOR ALL
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());

ALTER TABLE "knowledge_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY "knowledge_documents_tenant_isolation" ON "knowledge_documents"
  FOR ALL
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());

ALTER TABLE "knowledge_chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_chunks" FORCE ROW LEVEL SECURITY;
CREATE POLICY "knowledge_chunks_tenant_isolation" ON "knowledge_chunks"
  FOR ALL
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());

ALTER TABLE "agent_knowledge_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_knowledge_sources" FORCE ROW LEVEL SECURITY;
CREATE POLICY "agent_knowledge_sources_tenant_isolation" ON "agent_knowledge_sources"
  FOR ALL
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());

-- Processing runs are an append-only observability record: written by the
-- worker, read by operators, never edited.
ALTER TABLE "knowledge_processing_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_processing_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "knowledge_runs_select" ON "knowledge_processing_runs"
  FOR SELECT USING ("organization_id" = current_org_id());
CREATE POLICY "knowledge_runs_insert" ON "knowledge_processing_runs"
  FOR INSERT WITH CHECK ("organization_id" = current_org_id());
CREATE POLICY "knowledge_runs_update" ON "knowledge_processing_runs"
  FOR UPDATE
  USING ("organization_id" = current_org_id())
  WITH CHECK ("organization_id" = current_org_id());

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON "knowledge_sources" TO platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "knowledge_documents" TO platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "knowledge_chunks" TO platform_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "agent_knowledge_sources" TO platform_app;
GRANT SELECT, INSERT, UPDATE ON "knowledge_processing_runs" TO platform_app;
REVOKE DELETE ON "knowledge_processing_runs" FROM platform_app;

-- The agent_id FK is added here because agent_knowledge_sources is defined in
-- the knowledge schema file while `agents` belongs to Phase 2.
ALTER TABLE "agent_knowledge_sources"
  ADD CONSTRAINT "agent_knowledge_sources_agent_id_fk"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- Vector index.
--
-- HNSW with cosine distance. Built AFTER the policies so the planner has the
-- tenant predicate available; RLS still applies to every scan that uses it —
-- an index never bypasses a policy.
--
-- The index is deliberately modest: at Phase 3 volumes an exact scan would
-- also work, and premature tuning without representative data would be
-- guesswork. Revisit with real corpus sizes.
-- ---------------------------------------------------------------------------

CREATE INDEX "knowledge_chunks_embedding_hnsw"
  ON "knowledge_chunks"
  USING hnsw ("embedding" vector_cosine_ops);

-- Partial index for the hot retrieval path: live chunks of ready documents.
CREATE INDEX "knowledge_chunks_live_idx"
  ON "knowledge_chunks" ("organization_id", "document_id", "document_version");
