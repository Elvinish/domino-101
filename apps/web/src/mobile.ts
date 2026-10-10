import { useSyncExternalStore } from 'react';

// Phone portrait and short phone landscape; tablets keep the existing table.
export const phoneQuery =
  '(max-width: 640px), (max-width: 1000px) and (max-height: 500px) and (orientation: landscape)';
// Complement of phoneQuery for decorative <picture> sources, including rotation.
export const remoteHandMedia =
  '(min-width: 641px) and (min-height: 501px), (min-width: 1001px)';
function subscribe(notify: () => void) {
  const query = window.matchMedia?.(phoneQuery);
  query?.addEventListener('change', notify);
  return () => query?.removeEventListener('change', notify);
}
export function usePhoneLayout() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(phoneQuery).matches ?? false,
    () => false,
  );
}
