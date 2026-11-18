import { createStore } from 'zustand/vanilla';
import { languageOf, type Language } from '../i18n';
import type { KeyValueStore } from '../services/storage.service';

const LANGUAGE_KEY = 'language';

type LanguageState = {
  language: Language;
  override: Language | null;
  setOverride(override: Language | null): void;
  refreshDevice(): void;
};

export function createLanguageStore(
  kv: KeyValueStore,
  deviceTag: () => string,
) {
  const stored = kv.get(LANGUAGE_KEY);
  const override = stored === 'en' || stored === 'km' ? stored : null;
  const deviceLanguage = () => languageOf(deviceTag());

  return createStore<LanguageState>()(set => ({
    language: override ?? deviceLanguage(),
    override,
    setOverride: next => {
      const language = next ?? deviceLanguage();
      if (next === null) kv.remove(LANGUAGE_KEY);
      else kv.set(LANGUAGE_KEY, next);
      set({ override: next, language });
    },
    refreshDevice: () => {
      const language = deviceLanguage();
      set(state => ({ language: state.override ?? language }));
    },
  }));
}
