/** Shared by ProfileManager and ProfileLifecycleManager's own bulk* methods
 * — kept in its own file (not defined in either class's own module) so
 * neither has to import the other just for this one type. */
export interface BulkResult {
  succeeded: string[];
  failed: Array<{ id: string; message: string }>;
}
