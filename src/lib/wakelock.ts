let sentinel: WakeLockSentinel | null = null;
let wanted = 0;

async function acquire() {
  try {
    if ('wakeLock' in navigator && wanted > 0 && !sentinel) {
      sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener('release', () => {
        sentinel = null;
      });
    }
  } catch {
    /* thiết bị không hỗ trợ */
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void acquire();
  });
}

export function holdWakeLock() {
  wanted++;
  void acquire();
}

export function releaseWakeLock() {
  wanted = Math.max(0, wanted - 1);
  if (wanted === 0 && sentinel) {
    void sentinel.release().catch(() => undefined);
    sentinel = null;
  }
}
