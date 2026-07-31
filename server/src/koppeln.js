/**
 * ══════════════════════════════════════════════════════════════════════════
 *  KOPPLUNG — Zugang ohne Tippen am Fernseher
 * ══════════════════════════════════════════════════════════════════════════
 *
 * DAS PROBLEM
 * Der Fernseher findet den Server inzwischen selbst (netzsuche in der App).
 * Was er noch braucht, ist das Server-Passwort — und genau das über eine
 * Bildschirmtastatur mit dem Steuerkreuz einzugeben ist mühsam und
 * fehleranfällig.
 *
 * DER ABLAUF
 *   1. Der Fernseher fordert einen Kopplungscode an   → POST /api/pair/start
 *   2. Er zeigt ihn als QR-Code an, der auf
 *      http://<server>/koppeln?code=XXXXXX zeigt
 *   3. Das Handy scannt den Code, öffnet die Seite und gibt dort das
 *      Passwort ein (auf einer richtigen Tastatur, in Sekunden)
 *   4. Der Fernseher fragt regelmäßig nach                → /api/pair/check
 *      und bekommt sein Zugangs-Token
 *
 * SICHERHEIT
 * Der Code besteht aus 6 Zeichen eines Alphabets ohne verwechselbare
 * Zeichen (kein O/0, kein I/1) — das sind gut eine Milliarde Möglichkeiten.
 * Er gilt nur 10 Minuten, lässt sich genau einmal einlösen und wird danach
 * gelöscht. Zusätzlich wird die Zahl gleichzeitig offener Codes begrenzt,
 * damit niemand den Speicher vollmüllen kann.
 *
 * Wichtig: Der Code allein nützt nichts. Wer ihn errät, muss immer noch das
 * Server-Passwort kennen, um ihn einzulösen. Er ersetzt also nichts, er
 * verlagert nur die Eingabe vom Fernseher aufs Handy.
 */
import { randomInt } from "node:crypto";

/** Ohne 0/O, 1/I/L, 2/Z, 5/S, 8/B — aus zwei Metern Entfernung eindeutig. */
const ZEICHEN = "34679ACDEFGHJKMNPQRTUVWXY";
const GUELTIG_MS = 10 * 60 * 1000;
const MAX_OFFEN = 20;

/** code -> { erstellt, geraet, token, eingeloest } */
const offen = new Map();

function aufraeumen() {
  const jetzt = Date.now();
  for (const [code, e] of offen) {
    if (jetzt - e.erstellt > GUELTIG_MS) offen.delete(code);
  }
}

function neuerCode() {
  for (let versuch = 0; versuch < 50; versuch++) {
    let c = "";
    for (let i = 0; i < 6; i++) c += ZEICHEN[randomInt(ZEICHEN.length)];
    if (!offen.has(c)) return c;
  }
  return null;
}

/**
 * Einen Kopplungsvorgang beginnen (vom Fernseher aufgerufen).
 * @returns {{code:string, gueltigBis:number}|null}
 */
export function starteKopplung(geraet = "Fernseher") {
  aufraeumen();
  if (offen.size >= MAX_OFFEN) {
    // Ältesten verwerfen statt abzulehnen — sonst blockiert ein liegen
    // gebliebener Vorgang die echte Nutzung.
    const aeltester = [...offen.entries()].sort((a, b) => a[1].erstellt - b[1].erstellt)[0];
    if (aeltester) offen.delete(aeltester[0]);
  }
  const code = neuerCode();
  if (!code) return null;
  offen.set(code, { erstellt: Date.now(), geraet: String(geraet).slice(0, 40), token: null, eingeloest: false });
  return { code, gueltigBis: Date.now() + GUELTIG_MS };
}

/**
 * Nachsehen, ob die Kopplung inzwischen bestätigt wurde (vom Fernseher).
 * Nach dem Abholen wird der Vorgang gelöscht — jeder Code gilt genau einmal.
 *
 * @returns {{status:"offen"|"fertig"|"unbekannt", token?:string}}
 */
export function pruefeKopplung(code) {
  aufraeumen();
  const e = offen.get(String(code || "").toUpperCase());
  if (!e) return { status: "unbekannt" };
  if (!e.eingeloest) return { status: "offen" };
  offen.delete(String(code).toUpperCase());
  return { status: "fertig", token: e.token };
}

/**
 * Die Kopplung bestätigen (vom Handy, nach Eingabe des Passworts).
 * @returns {boolean} ob der Code gültig war
 */
export function loeseKopplungEin(code, token) {
  aufraeumen();
  const schluessel = String(code || "").toUpperCase().trim();
  const e = offen.get(schluessel);
  if (!e || e.eingeloest) return false;
  e.token = token;
  e.eingeloest = true;
  return true;
}

/** Nur für Tests und die Statusanzeige. */
export const offeneKopplungen = () => offen.size;
export const _leeren = () => offen.clear();

/* ══ Die Seite, die das Handy nach dem Scannen öffnet ═════════════════════
 * Bewusst eine einzelne, sehr schlichte Seite ohne Skript-Abhängigkeiten:
 * Sie muss auf jedem Handy-Browser sofort funktionieren, auch auf einem
 * alten. Deshalb reines HTML mit einem Formular.
 */
export function kopplungsSeite({ code = "", meldung = "", fertig = false } = {}) {
  const sicher = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GHGFlix – Fernseher verbinden</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#0b0b0f; color:#f2f2f5;
         font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         display:flex; align-items:center; justify-content:center; min-height:100vh; padding:20px; }
  .karte { background:#14141a; border:1px solid #2e2e38; border-radius:16px;
           padding:26px; width:100%; max-width:420px; }
  h1 { color:#e50914; font-size:26px; margin:0 0 4px; }
  p  { color:#9a9aa8; font-size:15px; line-height:1.5; margin:0 0 18px; }
  .code { font-size:30px; font-weight:800; letter-spacing:6px; text-align:center;
          background:#1c1c24; border-radius:10px; padding:14px; margin-bottom:18px; }
  label { display:block; font-size:14px; color:#9a9aa8; margin-bottom:6px; }
  input { width:100%; box-sizing:border-box; background:#1c1c24; border:2px solid #2e2e38;
          border-radius:10px; color:#f2f2f5; padding:14px; font-size:17px; margin-bottom:16px; }
  input:focus { outline:none; border-color:#e50914; }
  button { width:100%; background:#e50914; color:#fff; border:0; border-radius:10px;
           padding:15px; font-size:17px; font-weight:700; cursor:pointer; }
  .fehler { background:#e5091422; border:1px solid #e5091455; border-radius:10px;
            padding:12px; font-size:14px; margin-bottom:16px; }
  .fertig { text-align:center; }
  .haken { font-size:60px; margin-bottom:10px; }
</style>
</head>
<body>
<div class="karte">
${fertig ? `
  <div class="fertig">
    <div class="haken">✓</div>
    <h1>Verbunden</h1>
    <p>Der Fernseher meldet sich in wenigen Sekunden von selbst an.<br>
       Dieses Fenster kannst du schließen.</p>
  </div>
` : `
  <h1>GHGFlix</h1>
  <p>Fernseher verbinden — gib hier einmal das Server-Passwort ein,
     dann muss es am Fernseher niemand eintippen.</p>
  ${meldung ? `<div class="fehler">${sicher(meldung)}</div>` : ""}
  <div class="code">${sicher(code)}</div>
  <form method="POST" action="/koppeln">
    <input type="hidden" name="code" value="${sicher(code)}">
    <label for="pw">Server-Passwort</label>
    <input id="pw" name="passwort" type="password" autocomplete="current-password"
           autofocus placeholder="Passwort">
    <button type="submit">Fernseher freischalten</button>
  </form>
`}
</div>
</body>
</html>`;
}
