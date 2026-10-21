// Call only after the server has confirmed deletion. Retrying this function
// retries browser cleanup, never the destructive server operation.
export async function cleanupDeletedAccount(deps: {
  stopSession: () => void;
  signOut: () => Promise<void>;
  clearStorage: () => void;
}) {
  // Prevent a late sync response from repopulating the cleared cache.
  deps.stopSession();
  let signedOut = false;
  let storageCleared = false;
  // Clear first: successful sign-out unmounts the account UI. If storage is
  // blocked, keep the stopped UI available for cleanup retry before sign-out.
  try { deps.clearStorage(); storageCleared = true; } catch { return { signedOut, storageCleared }; }
  try { await deps.signOut(); signedOut = true; } catch { /* Cache is already cleared. */ }
  return { signedOut, storageCleared };
}
