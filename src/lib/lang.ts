const NAMES: Record<string, string> = {
  en: "Englisch", eng: "Englisch",
  de: "Deutsch", ger: "Deutsch", deu: "Deutsch",
  fr: "Französisch", fre: "Französisch", fra: "Französisch",
  es: "Spanisch", spa: "Spanisch",
  it: "Italienisch", ita: "Italienisch",
  ja: "Japanisch", jpn: "Japanisch",
  ko: "Koreanisch", kor: "Koreanisch",
  zh: "Chinesisch", chi: "Chinesisch", zho: "Chinesisch",
  ru: "Russisch", rus: "Russisch",
  pt: "Portugiesisch", por: "Portugiesisch",
  nl: "Niederländisch", dut: "Niederländisch", nld: "Niederländisch",
  pl: "Polnisch", pol: "Polnisch",
  tr: "Türkisch", tur: "Türkisch",
  ar: "Arabisch", ara: "Arabisch",
  sv: "Schwedisch", swe: "Schwedisch",
  da: "Dänisch", dan: "Dänisch",
  no: "Norwegisch", nor: "Norwegisch",
  fi: "Finnisch", fin: "Finnisch",
  cs: "Tschechisch", cze: "Tschechisch", ces: "Tschechisch",
  hu: "Ungarisch", hun: "Ungarisch",
  el: "Griechisch", gre: "Griechisch", ell: "Griechisch",
  he: "Hebräisch", heb: "Hebräisch",
  hi: "Hindi", hin: "Hindi",
  th: "Thai", tha: "Thai",
  uk: "Ukrainisch", ukr: "Ukrainisch",
  ro: "Rumänisch", rum: "Rumänisch", ron: "Rumänisch",
};

export const ENGLISH = ["en", "eng", "english"];
export const GERMAN = ["de", "deu", "ger", "german"];

export function langName(code?: string | null): string | null {
  if (!code) return null;
  const c = code.toLowerCase();
  return NAMES[c] ?? code.toUpperCase();
}
