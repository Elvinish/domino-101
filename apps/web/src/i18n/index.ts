import { createContext, useContext } from 'react';
import { en } from './en';
import type { MessageKey } from './en';
import { ru } from './ru';
import { az } from './az';

export type Locale = 'en' | 'ru' | 'az';
export type { MessageKey } from './en';
export const resources = { en, ru, az };
export const languageKey = 'domino101.language';
export const locales = { en: 'English', ru: 'Русский', az: 'Azərbaycanca' };
export const isLocale = (value: unknown): value is Locale =>
  value === 'en' || value === 'ru' || value === 'az';
export function readLocale(): Locale {
  try {
    const value = localStorage.getItem(languageKey);
    if (isLocale(value)) return value;
  } catch {
    /* Preferences are optional; no credentials or errors are logged. */
  }
  return 'en';
}
export function translate(
  locale: Locale,
  key: MessageKey,
  params: Record<string, string | number> = {},
): string {
  const message = Object.hasOwn(resources[locale], key)
    ? resources[locale][key]
    : resources[locale]['errors.INTERNAL_ERROR'];
  return message.replace(/\{(\w+)\}/g, (_, name: string) =>
    String(params[name] ?? ''),
  );
}
export interface I18n {
  locale: Locale;
  setLocale: (value: Locale) => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}
export const I18nContext = createContext<I18n>({
  locale: 'en',
  setLocale: () => {},
  t: (key, params) => translate('en', key, params),
});
export const useI18n = () => useContext(I18nContext);
