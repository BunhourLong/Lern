import { createContext, useContext } from 'react';
import en from './en.json';
import km from './km.json';

export type Language = 'en' | 'km';
export type StringKey = keyof typeof en;

const strings: Record<Language, Record<StringKey, string>> = { en, km };

export function languageOf(tag: string): Language {
  return tag.split(/[-_]/)[0].toLowerCase() === 'km' ? 'km' : 'en';
}

export function translate(
  language: Language,
  key: StringKey,
  vars?: Record<string, string | number>,
): string {
  const text = strings[language][key];
  if (!vars) return text;
  return text.replace(/\{([^{}]+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : placeholder,
  );
}

const translators = {
  en: translate.bind(undefined, 'en'),
  km: translate.bind(undefined, 'km'),
};

export const LanguageContext = createContext<Language>('en');

export function useT() {
  return translators[useContext(LanguageContext)];
}
