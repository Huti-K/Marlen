import { isLanguage, type Language } from "@marlen/shared";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import de from "@/locales/de.json";
import en from "@/locales/en.json";

const STORAGE_KEY = "marlen-language";

/**
 * Language for the first paint: the last server-confirmed choice (mirrored in
 * localStorage), falling back to German — the app's default language. The
 * server setting is the source of truth — App syncs against it on load.
 */
function detectInitialLanguage(): Language {
  const saved = localStorage.getItem(STORAGE_KEY);
  return isLanguage(saved) ? saved : "de";
}

/** Mirror the server-confirmed language so the next load paints correctly right away. */
export function rememberLanguage(language: Language): void {
  localStorage.setItem(STORAGE_KEY, language);
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, de: { translation: de } },
  lng: detectInitialLanguage(),
  fallbackLng: "de",
  interpolation: { escapeValue: false }, // React already escapes
});

i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
});
document.documentElement.lang = i18n.language;

export default i18n;
