// Abort cancels only this request. Never steal another tab's lock.
// Stop the writer synchronously before resolving the lock callback.
export async function holdStudyLock(
  locks: Pick<LockManager, 'request'>,
  uid: string,
  signal: AbortSignal,
  open: () => () => void,
) {
  await locks.request(`moa-study-cloud-${uid}`, { mode: 'exclusive', signal }, async () => {
    if (signal.aborted) return;
    const close = open();
    let closed = false;
    const stop = () => { if (!closed) { closed = true; close(); } };
    try {
      await new Promise<void>(resolve => {
        const abort = () => { try { stop(); } finally { resolve(); } };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    } finally { stop(); }
  });
}
