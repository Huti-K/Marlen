import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { isLanguage, type Language } from "@trailin/shared";
import en from "@/locales/en.json";
import de from "@/locales/de.json";

const STORAGE_KEY = "trailin-language";

/**
 * Language for the first paint: the last server-confirmed choice (mirrored in
 * localStorage), falling back to the browser locale. The server setting is the
 * source of truth — App syncs against it on load.
 */
export function detectInitialLanguage(): Language {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (isLanguage(saved)) return saved;
  const browser = navigator.language.slice(0, 2).toLowerCase();
  return isLanguage(browser) ? browser : "en";
}

/** Mirror the server-confirmed language so the next load paints correctly right away. */
export function rememberLanguage(language: Language): void {
  localStorage.setItem(STORAGE_KEY, language);
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, de: { translation: de } },
  lng: detectInitialLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false }, // React already escapes
});

i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
});
document.documentElement.lang = i18n.language;

export default i18n;
