/**
 * IPC channel names shared by main and (duplicated in) preload.
 * The sandboxed preload cannot `require` local modules, so it keeps its
 * own copy of these string literals; keep both in sync.
 */
export const IPC = {
  openExternal: 'lunex:open-external',
  installUpdate: 'lunex:install-update',
  getUpdateStatus: 'lunex:get-update-status',
  updateStatus: 'lunex:update-status',
} as const;
