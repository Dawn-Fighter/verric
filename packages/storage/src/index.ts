// Public surface of @verric/storage.

export { openDatabase, closeDatabase } from "./sqlite";
export type { Database, OpenDatabaseOptions } from "./sqlite";

export { migrate, readSchemaVersion, SCHEMA_VERSION } from "./schema";

export {
  createProject,
  getProject,
  findOrCreateProject,
  recordRun,
  listRuns,
  getRun,
  deleteRun,
  // Async pipeline (queue + events)
  createPendingRun,
  markRunRunning,
  completeRunSuccess,
  completeRunFailure,
  appendRunEvent,
  listRunEvents,
  // Editor (versioned reports + audit log)
  appendReportVersion,
  getReportVersion,
  listReportVersions,
  recordClaimEdit,
  listClaimEdits,
  // Finding library
  upsertFindingLibraryEntry,
  getFindingLibraryEntry,
  listFindingLibrary,
  deleteFindingLibraryEntry,
  // Branded report templates
  upsertBranding,
  getBranding,
  listBranding,
  getDefaultBranding,
  deleteBranding,
  // Template marketplace
  upsertTemplateRegistryEntry,
  listTemplateRegistry,
  deleteTemplateRegistryEntry
} from "./repository";
export type {
  ProjectRow,
  RunRow,
  RunStatus,
  RunWithReport,
  RunEventRow,
  CreateProjectInput,
  RecordRunInput,
  CreatePendingRunInput,
  CompleteRunSuccessInput,
  CompleteRunFailureInput,
  ReportVersionRow,
  ClaimEditRow,
  ClaimEditAction,
  AppendReportVersionInput,
  RecordClaimEditInput,
  FindingLibraryEntry,
  UpsertFindingLibraryEntryInput,
  ReportBrandingRow,
  UpsertBrandingInput,
  TemplateRegistryEntry,
  UpsertTemplateInput
} from "./repository";
