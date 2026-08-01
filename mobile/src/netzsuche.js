/**
 * ══════════════════════════════════════════════════════════════════════════
 *  SERVER IM NETZ SUCHEN
 * ══════════════════════════════════════════════════════════════════════════
 *
 * DAS PROBLEM
 * „Ich kann diese URL nicht noch mal über die TV-Fernbedienung eingeben."
 *
 * Völlig berechtigt: „http://192.168.68.157:8484“ über eine Bildschirm-
 * tastatur mit dem Steuerkreuz zu tippen, ist eine Zumutung — jeder Punkt
 * und jeder Doppelpunkt bedeutet Herumnavigieren.
 *
 * DIE LÖSUNG
 * Die App sucht den Server selbst. Im Heimnetz haben alle Geräte dieselben
 * ersten drei Zahlen, es sind also nur 254 Adressen zu prüfen. Ein Aufruf von
 * /api/ping dauert im eigenen Netz wenige Millisekunden; wo nichts antwortet,
 * bricht der kurze Zeitgeber ab. Damit ist ein Netz in ein bis zwei Sekunden
 * durch.
 *
 * WARUM OHNE expo-network
 * Die eigene IP-Adresse ließe sich mit expo-network direkt abfragen. Das wäre
 * aber ein weiteres natives Modul — und genau so ein Modul (expo-asset) hat
 * die Fernseh-App wochenlang beim Start abstürzen lassen, weil es nur
 * mittelbar installiert war. Deshalb geht diese Datei den Weg ohne:
 *
 *   1. Ist bereits eine Adresse bekannt (frühere Verbindung), wird DEREN
 *      Netz zuerst durchsucht. Das ist der Normalfall und dauert ~1 Sekunde.
 *   2. Sonst werden die im Heimgebrauch üblichen Netze der Reihe nach
 *      durchprobiert (Fritzbox, Telekom, Google Nest, Speedport …).
 *
 * Gefunden wird der Server, sobald /api/ping mit app:"ghgflix-server"
 * antwortet — eine Verwechslung mit einem anderen Gerät ist ausgeschlossen.
 */

/**
 * Übliche Heimnetze, nach Verbreitung sortiert.
 *
 * Die Liste ist bewusst länger als „was bei mir läuft": Router vergeben je
 * nach Hersteller sehr unterschiedliche Bereiche, und wer die App weitergibt,
 * sitzt in einem anderen Netz. Wessen Netz hier trotzdem fehlt, gibt es unter
 * „Adresse von Hand" einfach ein — dort genügen schon die ersten drei Zahlen
 * (z. B. „192.168.78"), dann wird genau dieses Netz durchsucht.
 */
const UEBLICHE_NETZE = [
  "192.168.0", "192.168.1", "192.168.178", "192.168.2",
  "192.168.68", "192.168.8", "192.168.10", "192.168.20", "192.168.100",
  "192.168.50", "192.168.3", "192.168.4", "192.168.88",
  "10.0.0", "10.0.1", "10.1.1", "172.16.0", "172.20.10",
];

/** Voreingestellte Gleichzeitigkeit — siehe sucheImNetz(). */
export const GLEICHZEITIG_STANDARD = 40;

/** Ports, auf denen der GHGFlix-Server üblicherweise lauscht. */
export const PORTS = [8484, 8080, 3000];

/** Adresse aufräumen: http:// ergänzen, Schrägstrich am Ende entfernen. */
export function normUrl(u) {
  u = (u || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "http://" + u;
  return u.replace(/\/$/, "");
}

/**
 * Einen Server anpingen.
 * @returns {Promise<object|null>} die Antwort, oder null
 */
export async function ping(basis, ms = 2500) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(`${normUrl(basis)}/api/ping`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.app === "ghgflix-server" ? j : null;
  } catch {
    return null;
  }
}

/** Aus "http://192.168.68.157:8484" wird "192.168.68". */
export function netzTeil(url) {
  const m = String(url || "").match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

/** Aus einer Adresse den Port lesen, sonst 8484. */
export function portTeil(url) {
  const m = String(url || "").match(/:(\d{2,5})(?:\/|$)/);
  return m ? Number(m[1]) : 8484;
}

/**
 * Eine Aufgabenliste mit begrenzter Gleichzeitigkeit abarbeiten und beim
 * ersten Treffer sofort aufhören.
 *
 * Ohne Begrenzung würden 254 gleichzeitige Verbindungen die Netzwerk-
 * schicht mancher Fernseher überfordern — es kämen dann falsche Fehlschläge
 * heraus und der Server bliebe unentdeckt, obwohl er da ist.
 */
async function ersterTreffer(aufgaben, gleichzeitig, abbruch) {
  let i = 0;
  let treffer = null;
  const arbeiter = Array.from({ length: Math.min(gleichzeitig, aufgaben.length) }, async () => {
    while (treffer == null && i < aufgaben.length) {
      if (abbruch?.()) return;
      const eigene = i++;
      const r = await aufgaben[eigene]();
      if (r != null && treffer == null) treffer = r;
    }
  });
  await Promise.all(arbeiter);
  return treffer;
}

/**
 * Ein einzelnes Netz durchsuchen (z. B. "192.168.68").
 *
 * @param {string}   netz       die ersten drei Zahlen
 * @param {number[]} ports      zu prüfende Ports
 * @param {Function} [fortschritt] (geprüft, gesamt) => void
 * @param {Function} [abbruch]  gibt true zurück, wenn abgebrochen werden soll
 */
/**
 * Eine von Hand eingetippte Angabe verstehen.
 *
 * Erlaubt ist alles, was jemand vernünftigerweise eingeben würde:
 *   "192.168.78.10"        → genau dieses Gerät (Port 8484)
 *   "192.168.78.10:8080"   → genau dieses Gerät auf Port 8080
 *   "http://ghgflix:8484"  → genau diese Adresse
 *   "192.168.78"           → dieses ganze Netz durchsuchen
 *   "192.168.78.x"         → dasselbe, nur anders geschrieben
 *
 * Die letzte Form ist die wichtigste: Man muss nur die drei Zahlen ablesen,
 * die am Router ohnehin überall stehen — die letzte Zahl sucht die App selbst.
 *
 * @returns {{art:"adresse", url:string}|{art:"netz", netz:string, port:number}|null}
 */
export function normAdresse(text) {
  const t = String(text || "").trim();
  if (!t) return null;

  // Ganzes Netz: drei Zahlen, optional mit ".x" oder ".*" am Ende
  const netz = t.replace(/^https?:\/\//i, "").replace(/[/.]$/, "");
  const mNetz = netz.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\.(?:x|\*|0))?(?::(\d{2,5}))?$/i);
  if (mNetz) {
    const teile = [mNetz[1], mNetz[2], mNetz[3]].map(Number);
    if (teile.every((n) => n >= 0 && n <= 255)) {
      return { art: "netz", netz: teile.join("."), port: Number(mNetz[4]) || 8484 };
    }
  }

  /* Sonst als einzelne Adresse behandeln.
     Der Rechnername darf nur aus Buchstaben, Ziffern, Punkt und Bindestrich
     bestehen. Vorher stand hier [^/\s]+ — damit wurde auch reiner Unsinn wie
     "!!!" als gültige Adresse durchgewunken, und die App lief in einen
     Verbindungsversuch, der nie klappen konnte, statt gleich zu sagen, dass
     die Eingabe nicht stimmt. */
  const url = normUrl(t);
  const m = url.match(/^https?:\/\/([A-Za-z0-9][A-Za-z0-9.-]*)(?::(\d{2,5}))?$/);
  if (!m) return null;
  return { art: "adresse", url: m[2] ? url : `${url}:8484` };
}

/**
 * @param {number} [gleichzeitig] wie viele Adressen zugleich geprüft werden.
 *   Mehr ist schneller, aber die Netzwerkschicht mancher Fernseher kommt bei
 *   zu vielen offenen Verbindungen durcheinander und meldet Fehlschläge, wo
 *   in Wahrheit ein Server steht. Deshalb einstellbar: bei Problemen kleiner
 *   drehen (5–10), auf einem kräftigen Handy ruhig größer.
 */
export async function sucheImNetz(netz, ports = [8484], fortschritt, abbruch, gleichzeitig = GLEICHZEITIG_STANDARD) {
  const adressen = [];
  // Router und Server stehen meist auf niedrigen Nummern — die zuerst.
  const reihenfolge = [
    ...Array.from({ length: 30 }, (_, i) => i + 1),
    ...Array.from({ length: 224 }, (_, i) => i + 31),
  ];
  for (const p of ports) for (const n of reihenfolge) adressen.push(`http://${netz}.${n}:${p}`);

  let fertig = 0;
  const gesamt = adressen.length;
  const aufgaben = adressen.map((adr) => async () => {
    const r = await ping(adr, 1200);
    fertig++;
    if (fertig % 12 === 0) fortschritt?.(fertig, gesamt);
    return r ? { url: adr, info: r } : null;
  });

  return ersterTreffer(aufgaben, Math.max(1, Math.min(128, gleichzeitig | 0)), abbruch);
}

/**
 * Den Server vollständig suchen: erst im bekannten Netz, dann in den üblichen.
 *
 * @param {string[]} bekannteAdressen  bisher gespeicherte Adressen
 * @param {Function} [melde]           (text: string) => void, für die Anzeige
 * @param {Function} [abbruch]
 * @returns {Promise<{url:string, info:object}|null>}
 */
export async function sucheServer(bekannteAdressen = [], melde, abbruch, opt = {}) {
  const gleichzeitig = opt.gleichzeitig || GLEICHZEITIG_STANDARD;
  /* Von Hand angegebene Netze/Adressen kommen ZUERST dran — wer etwas
     eintippt, weiß in aller Regel besser Bescheid als unsere Ratereihenfolge. */
  const zuerst = (opt.zusatz || []).map(normAdresse).filter(Boolean);

  for (const z of zuerst) {
    if (abbruch?.()) return null;
    if (z.art === "adresse") {
      melde?.(`Prüfe ${z.url} …`);
      const r = await ping(z.url, 3000);
      if (r) return { url: z.url, info: r };
    }
  }

  // 0) Antwortet eine bereits bekannte Adresse? Das ist der Normalfall.
  for (const a of bekannteAdressen.filter(Boolean)) {
    if (abbruch?.()) return null;
    melde?.("Prüfe gespeicherte Adresse …");
    const r = await ping(a, 2500);
    if (r) return { url: normUrl(a), info: r };
  }

  // 1) Netze sammeln: von Hand angegebene, dann die der bekannten Adressen,
  //    dann die üblichen Heimnetze.
  const netze = [];
  const dazu = (n) => { if (n && !netze.includes(n)) netze.push(n); };
  for (const z of zuerst) if (z.art === "netz") dazu(z.netz);
  for (const a of bekannteAdressen) dazu(netzTeil(a));
  for (const n of UEBLICHE_NETZE) dazu(n);

  for (const netz of netze) {
    if (abbruch?.()) return null;
    const ports = [...new Set([
      ...zuerst.filter((z) => z.art === "netz").map((z) => z.port),
      ...bekannteAdressen.map(portTeil),
      8484,
    ])].filter(Boolean);
    melde?.(`Durchsuche ${netz}.1 – ${netz}.254 …`);
    const t = await sucheImNetz(netz, ports, (fertig, gesamt) => {
      melde?.(`Durchsuche ${netz}.x  (${Math.round((fertig / gesamt) * 100)} %)`);
    }, abbruch, gleichzeitig);
    if (t) return { url: normUrl(t.url), info: t.info };
  }
  return null;
}
