// Fixture: typed strings (UI.5 builds the real one). Keys live in en.json and km.json.
import en from './en.json';
export type StringKey = keyof typeof en;
export declare function useT(): (key: StringKey, vars?: Record<string, string | number>) => string;
