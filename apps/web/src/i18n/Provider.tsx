import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { I18nContext, languageKey, readLocale, translate } from './index';
import type { Locale, MessageKey } from './index';
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState(readLocale);
  const setLocale = useCallback((value: Locale) => {
    updateLocale(value);
    try {
      localStorage.setItem(languageKey, value);
    } catch {
      /* In-memory preference remains usable. */
    }
  }, []);
  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t: (key: MessageKey, params?: Record<string, string | number>) =>
        translate(locale, key, params),
    }),
    [locale, setLocale],
  );
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return <I18nContext value={value}>{children}</I18nContext>;
}
