export type PhotoExportStatus = 'pending' | 'saved' | 'denied' | 'failed' | 'unavailable' | 'uncertain';
export type ActiveCapture = {
  id: string; fileUri: string; confirmed: boolean; createdAt: number;
  relativePath?: string; sessionId?: string; shotIndex?: number; exportStatus?: PhotoExportStatus;
};
export type ActiveSession = {
  id: string; createdAt: number; targetCount: number; shots: ActiveCapture[]; confirmed: boolean;
  retakes?: ActiveCapture[]; stagedOriginals?: ActiveCapture[]; storageWarning?: 'index-repair-pending' | 'original-commit-pending';
};
export type PhotoLibraryCapability = {
  available: boolean; permission: 'granted' | 'denied' | 'undetermined'; canAskAgain: boolean; writeOnly: true;
};
