let pending: Promise<unknown> = Promise.resolve();

/** Includes an import's replacement and commit/rollback; other chat writes wait. */
export function serializeConversationWrite<Result>(work: () => Promise<Result>): Promise<Result> {
  const next = pending.catch(() => undefined).then(async (): Promise<Result> => {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    return locks ? await locks.request('civil-ai:conversation-writes', work) : await work();
  });
  pending = next;
  return next;
}
