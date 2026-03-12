"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { Language, t as translate, getSectionName as getSectionNameI18n } from "@/lib/i18n";

interface LanguageContextValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string, params?: Record<string, string>) => string;
  getSectionName: (sectionId: string) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: "en",
  setLang: () => {},
  t: (key) => key,
  getSectionName: (id) => id,
});

const STORAGE_KEY = "ui_language";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>("en");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "zh") {
        setLangState(stored);
      }
    } catch {
      // localStorage unavailable
    }
  }, []);

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage unavailable
    }
    document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string>) => translate(lang, key, params),
    [lang],
  );

  const getSectionName = useCallback(
    (sectionId: string) => getSectionNameI18n(lang, sectionId),
    [lang],
  );

  return (
    <LanguageContext.Provider value={{ lang, setLang, t, getSectionName }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
