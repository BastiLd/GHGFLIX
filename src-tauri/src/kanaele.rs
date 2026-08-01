//! Kanäle & Feeds (Punkt 5 der Übergabe) — Desktop-Seite.
//!
//! 1:1-Gegenstück zu `server/src/kanaele.js`, damit die unveränderte
//! Oberfläche in der Desktop-App und im Browser dasselbe kann. Die
//! ausführliche Begründung steht dort; kurz:
//!
//!   YOUTUBE     Jeder Kanal hat einen offenen Atom-Feed
//!               `https://www.youtube.com/feeds/videos.xml?channel_id=UC…`.
//!               Kein API-Schlüssel, kein Kontingent — deshalb dieser Weg und
//!               nicht die YouTube Data API.
//!   LEAKS/BLOG  Beliebiger RSS-/Atom-Feed. Gleiches Abholen, gleiches Merken.
//!
//! Gespeichert wird in den Einstellungen (`feeds`, `feed_items`) statt in
//! eigenen Tabellen: keine Schema-Wanderung, und der Datenbestand ist winzig.
//!
//! Kein XML-Parser als Abhängigkeit — gezielte reguläre Ausdrücke reichen für
//! die flachen Feeds von YouTube und gängigen Blogs. Ein kaputter Feed darf
//! hier nur „nichts Neues" bedeuten, nie einen Fehler nach außen.

use crate::db;
use anyhow::{anyhow, Result};
use regex::Regex;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::LazyLock;

pub const FEEDS_KEY: &str = "feeds";
pub const ITEMS_KEY: &str = "feed_items";

/// So viele Beiträge werden insgesamt aufgehoben.
const MAX_ITEMS: usize = 300;
/// So viele Beiträge werden pro Feed und Abruf angesehen.
const MAX_PRO_FEED: usize = 15;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Feed {
    pub id: String,
    /// „youtube" oder „blog"
    pub art: String,
    pub titel: String,
    pub kanal_id: Option<String>,
    pub feed_url: String,
    pub seite: String,
    pub benachrichtigen: bool,
    pub hinzugefuegt: i64,
    /// Zeitpunkt des letzten erfolgreichen Abrufs (0 = noch nie).
    pub zuletzt: i64,
    pub fehler: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Beitrag {
    pub id: String,
    pub feed_id: String,
    pub art: String,
    pub video_id: Option<String>,
    pub titel: String,
    pub url: Option<String>,
    pub bild: Option<String>,
    pub beschreibung: Option<String>,
    pub veroeffentlicht: i64,
    pub gelesen: bool,
    pub entdeckt: i64,
    /// Nur beim Ausliefern gefüllt (Name des Abos).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feed_titel: Option<String>,
}

fn jetzt() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn lesen<T: for<'a> Deserialize<'a> + Default>(conn: &Connection, key: &str) -> T {
    let raw = db::get_setting(conn, key).ok().flatten().unwrap_or_default();
    serde_json::from_str(&raw).unwrap_or_default()
}

pub fn feeds_laden(conn: &Connection) -> Vec<Feed> {
    lesen(conn, FEEDS_KEY)
}
fn feeds_speichern(conn: &Connection, v: &[Feed]) -> Result<()> {
    db::set_setting(conn, FEEDS_KEY, &serde_json::to_string(v)?)?;
    Ok(())
}
pub fn beitraege_laden(conn: &Connection) -> Vec<Beitrag> {
    lesen(conn, ITEMS_KEY)
}
fn beitraege_speichern(conn: &Connection, v: &[Beitrag]) -> Result<()> {
    let gekappt: Vec<&Beitrag> = v.iter().take(MAX_ITEMS).collect();
    db::set_setting(conn, ITEMS_KEY, &serde_json::to_string(&gekappt)?)?;
    Ok(())
}

/* ── kleine XML-Helfer ─────────────────────────────────────────────────── */

static RE_CDATA: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<!\[CDATA\[(.*?)\]\]>").unwrap());
static RE_ENTITY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"&(#x?[0-9a-fA-F]+|[a-zA-Z]+);").unwrap());

fn entschluesseln(s: &str) -> String {
    let ohne_cdata = RE_CDATA.replace_all(s, "$1").to_string();
    RE_ENTITY
        .replace_all(&ohne_cdata, |c: &regex::Captures| {
            let name = c[1].to_lowercase();
            match name.as_str() {
                "amp" => "&".to_string(),
                "lt" => "<".to_string(),
                "gt" => ">".to_string(),
                "quot" => "\"".to_string(),
                "apos" | "#39" => "'".to_string(),
                "nbsp" => " ".to_string(),
                _ => {
                    if let Some(hex) = name.strip_prefix("#x") {
                        u32::from_str_radix(hex, 16)
                            .ok()
                            .and_then(char::from_u32)
                            .map(String::from)
                            .unwrap_or_else(|| c[0].to_string())
                    } else if let Some(dez) = name.strip_prefix('#') {
                        dez.parse::<u32>()
                            .ok()
                            .and_then(char::from_u32)
                            .map(String::from)
                            .unwrap_or_else(|| c[0].to_string())
                    } else {
                        c[0].to_string()
                    }
                }
            }
        })
        .trim()
        .to_string()
}

/// Inhalt des ersten `<tag>…</tag>`.
fn tag_inhalt(xml: &str, tag: &str) -> Option<String> {
    let re = Regex::new(&format!(r"(?is)<{t}(?:\s[^>]*)?>(.*?)</{t}>", t = regex::escape(tag))).ok()?;
    re.captures(xml).map(|c| entschluesseln(&c[1]))
}

/// Wert eines Attributs des ersten passenden Tags.
fn tag_attribut(xml: &str, tag: &str, attribut: &str) -> Option<String> {
    let re = Regex::new(&format!(
        r#"(?is)<{t}\b[^>]*\b{a}=["']([^"']+)["']"#,
        t = regex::escape(tag),
        a = regex::escape(attribut)
    ))
    .ok()?;
    re.captures(xml).map(|c| entschluesseln(&c[1]))
}

/// Alle `<item>`- bzw. `<entry>`-Blöcke.
fn eintraege(xml: &str) -> Vec<String> {
    for tag in ["item", "entry"] {
        let re = match Regex::new(&format!(r"(?is)<{t}(?:\s[^>]*)?>(.*?)</{t}>", t = tag)) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let v: Vec<String> = re.captures_iter(xml).map(|c| c[1].to_string()).collect();
        if !v.is_empty() {
            return v; // RSS und Atom nie mischen
        }
    }
    Vec::new()
}

async fn holen(http: &reqwest::Client, url: &str) -> Result<String> {
    let res = http
        .get(url)
        // Ohne erkennbaren Browser-Agenten liefert YouTube eine Zustimmungsseite
        // statt der Kanalseite — dann fände die Kanal-ID-Suche unten nichts.
        .header("User-Agent", "Mozilla/5.0 (compatible; GHGFlix/1.0)")
        .header("Accept-Language", "de,en;q=0.8")
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await?;
    if !res.status().is_success() {
        return Err(anyhow!("{}", res.status()));
    }
    Ok(res.text().await?)
}

/* ── YouTube: Adresse → Kanal-ID ───────────────────────────────────────── */

static RE_UC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^UC[\w-]{20,}$").unwrap());
static RE_CHANNEL_URL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)youtube\.com/channel/(UC[\w-]{20,})").unwrap());
static RE_CHANNEL_JSON: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#""channelId":"(UC[\w-]{20,})""#).unwrap());
static RE_CHANNEL_ANY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"channel/(UC[\w-]{20,})").unwrap());

/// Aus allem, was ein Nutzer einwirft, die Kanal-ID (UC…) machen.
pub async fn kanal_id_ermitteln(http: &reqwest::Client, eingabe: &str) -> Result<String> {
    let text = eingabe.trim();
    if text.is_empty() {
        return Err(anyhow!("Bitte eine YouTube-Adresse oder Kanal-ID angeben"));
    }
    if RE_UC.is_match(text) {
        return Ok(text.to_string());
    }
    if let Some(c) = RE_CHANNEL_URL.captures(text) {
        return Ok(c[1].to_string());
    }

    let url = if text.starts_with("http://") || text.starts_with("https://") {
        text.to_string()
    } else if let Some(rest) = text.strip_prefix('@') {
        format!("https://www.youtube.com/@{rest}")
    } else {
        format!("https://www.youtube.com/@{text}")
    };

    let html = holen(http, &url)
        .await
        .map_err(|e| anyhow!("Die Kanalseite ist nicht erreichbar: {e}"))?;
    let id = RE_CHANNEL_JSON
        .captures(&html)
        .or_else(|| RE_CHANNEL_ANY.captures(&html))
        .map(|c| c[1].to_string());
    id.ok_or_else(|| {
        anyhow!("Auf dieser Seite steht keine Kanal-ID. Bitte den Link zur Kanal-Startseite verwenden.")
    })
}

static RE_FEED_LINK_A: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)<link[^>]+type=["']application/(?:rss|atom)\+xml["'][^>]*href=["']([^"']+)["']"#).unwrap()
});
static RE_FEED_LINK_B: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)<link[^>]+href=["']([^"']+)["'][^>]*type=["']application/(?:rss|atom)\+xml["']"#).unwrap()
});

/// Aus einer Blog-Adresse den Feed heraussuchen (falls kein Feed angegeben).
pub async fn blog_feed_ermitteln(http: &reqwest::Client, eingabe: &str) -> Result<String> {
    let url = eingabe.trim();
    if url.is_empty() {
        return Err(anyhow!("Bitte eine Adresse angeben"));
    }
    let voll = if url.starts_with("http://") || url.starts_with("https://") {
        url.to_string()
    } else {
        format!("https://{url}")
    };
    let text = holen(http, &voll).await.map_err(|e| anyhow!("Nicht erreichbar: {e}"))?;
    let kopf: String = text.chars().take(2000).collect();
    if kopf.contains("<rss") || kopf.contains("<feed") {
        return Ok(voll);
    }
    let treffer = RE_FEED_LINK_A
        .captures(&text)
        .or_else(|| RE_FEED_LINK_B.captures(&text))
        .map(|c| entschluesseln(&c[1]));
    let roh = treffer.ok_or_else(|| {
        anyhow!("Auf dieser Seite ist kein RSS-/Atom-Feed verlinkt. Bitte die Feed-Adresse direkt angeben.")
    })?;
    // reqwest reicht die `url`-Kiste durch — kein zusätzliches Paket nötig.
    let basis = reqwest::Url::parse(&voll)?;
    Ok(basis.join(&roh)?.to_string())
}

/* ── Feeds verwalten ───────────────────────────────────────────────────── */

fn neue_id() -> String {
    // Kein rand-Paket: Zeit in Millisekunden plus Nanosekunden-Rest reicht als
    // Kennung völlig — die Feeds werden einzeln von Hand angelegt.
    let n = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    format!("f{:x}{:x}", jetzt(), n)
}

/// Kanal oder Blog abonnieren. `art` ist „youtube" oder „blog".
///
/// Bewusst der `Mutex` selbst als Parameter statt einer bereits genommenen
/// Sperre: die Sperre darf NIE über ein `await` gehalten werden, sonst steht
/// die ganze App still, während YouTube antwortet. So wird sie in jedem Block
/// kurz genommen und sofort wieder freigegeben.
pub async fn abonnieren(
    sperre: &std::sync::Mutex<Connection>,
    http: &reqwest::Client,
    eingabe: &str,
    art: &str,
) -> Result<Feed> {
    let vorhandene = {
        let conn = sperre.lock().unwrap();
        feeds_laden(&conn)
    };

    let feed = if art == "blog" {
        let feed_url = blog_feed_ermitteln(http, eingabe).await?;
        if vorhandene.iter().any(|f| f.feed_url == feed_url) {
            return Err(anyhow!("Dieser Feed ist schon abonniert"));
        }
        let titel = holen(http, &feed_url)
            .await
            .ok()
            .and_then(|x| tag_inhalt(&x, "title"))
            .unwrap_or_else(|| feed_url.clone());
        Feed {
            id: neue_id(),
            art: "blog".into(),
            titel,
            kanal_id: None,
            seite: feed_url.clone(),
            feed_url,
            benachrichtigen: true,
            hinzugefuegt: jetzt(),
            zuletzt: 0,
            fehler: None,
        }
    } else {
        let kanal_id = kanal_id_ermitteln(http, eingabe).await?;
        if vorhandene.iter().any(|f| f.kanal_id.as_deref() == Some(kanal_id.as_str())) {
            return Err(anyhow!("Dieser Kanal ist schon abonniert"));
        }
        let feed_url = format!("https://www.youtube.com/feeds/videos.xml?channel_id={kanal_id}");
        let titel = holen(http, &feed_url)
            .await
            .ok()
            .and_then(|x| tag_inhalt(&x, "title"))
            .unwrap_or_else(|| kanal_id.clone());
        Feed {
            id: neue_id(),
            art: "youtube".into(),
            titel,
            seite: format!("https://www.youtube.com/channel/{kanal_id}"),
            kanal_id: Some(kanal_id),
            feed_url,
            benachrichtigen: true,
            hinzugefuegt: jetzt(),
            zuletzt: 0,
            fehler: None,
        }
    };

    {
        let conn = sperre.lock().unwrap();
        let mut alle = feeds_laden(&conn);
        alle.push(feed.clone());
        feeds_speichern(&conn, &alle)?;
    }
    // Direkt einmal abholen, damit die Liste nicht leer bleibt.
    let _ = abholen(sperre, http, Some(&feed.id)).await;
    let conn = sperre.lock().unwrap();
    Ok(feeds_laden(&conn).into_iter().find(|f| f.id == feed.id).unwrap_or(feed))
}

pub fn abbestellen(conn: &Connection, id: &str) -> Result<bool> {
    let feeds: Vec<Feed> = feeds_laden(conn).into_iter().filter(|f| f.id != id).collect();
    feeds_speichern(conn, &feeds)?;
    let items: Vec<Beitrag> = beitraege_laden(conn).into_iter().filter(|b| b.feed_id != id).collect();
    beitraege_speichern(conn, &items)?;
    Ok(true)
}

pub fn feed_aendern(conn: &Connection, id: &str, benachrichtigen: Option<bool>, titel: Option<String>) -> Result<Feed> {
    let mut feeds = feeds_laden(conn);
    let f = feeds
        .iter_mut()
        .find(|f| f.id == id)
        .ok_or_else(|| anyhow!("Dieses Abo gibt es nicht"))?;
    if let Some(b) = benachrichtigen {
        f.benachrichtigen = b;
    }
    if let Some(t) = titel {
        if !t.trim().is_empty() {
            f.titel = t;
        }
    }
    let kopie = f.clone();
    feeds_speichern(conn, &feeds)?;
    Ok(kopie)
}

/* ── Abholen ───────────────────────────────────────────────────────────── */

fn beitrag_aus(block: &str, feed: &Feed) -> Option<Beitrag> {
    let video_id = if feed.art == "youtube" { tag_inhalt(block, "yt:videoId") } else { None };
    let url = tag_inhalt(block, "link")
        .filter(|s| !s.is_empty())
        .or_else(|| tag_attribut(block, "link", "href"))
        .or_else(|| video_id.as_ref().map(|v| format!("https://www.youtube.com/watch?v={v}")));
    let titel = tag_inhalt(block, "title").unwrap_or_else(|| "(ohne Titel)".into());
    let datum = tag_inhalt(block, "published")
        .or_else(|| tag_inhalt(block, "pubDate"))
        .or_else(|| tag_inhalt(block, "updated"));
    let beschreibung = tag_inhalt(block, "media:description")
        .or_else(|| tag_inhalt(block, "description"))
        .or_else(|| tag_inhalt(block, "summary"))
        .map(|s| s.chars().take(400).collect::<String>());
    let bild = match &video_id {
        Some(v) => Some(format!("https://i.ytimg.com/vi/{v}/mqdefault.jpg")),
        None => tag_attribut(block, "media:thumbnail", "url").or_else(|| tag_attribut(block, "enclosure", "url")),
    };

    let kennung = video_id
        .clone()
        .or_else(|| tag_inhalt(block, "guid"))
        .or_else(|| tag_inhalt(block, "id"))
        .or_else(|| url.clone())
        .unwrap_or_else(|| titel.clone());
    if kennung.is_empty() {
        return None;
    }

    Some(Beitrag {
        id: format!("{}:{}", feed.id, kennung),
        feed_id: feed.id.clone(),
        art: feed.art.clone(),
        video_id,
        titel,
        url,
        bild,
        beschreibung,
        veroeffentlicht: datum.and_then(|d| zeit_aus(&d)).unwrap_or_else(jetzt),
        gelesen: false,
        entdeckt: jetzt(),
        feed_titel: None,
    })
}

/// RFC-822 (RSS) und RFC-3339 (Atom) in Millisekunden umrechnen.
///
/// Bewusst ohne Datums-Paket: gebraucht wird nur eine Zahl zum SORTIEREN.
/// Scheitert das Lesen, nimmt der Aufrufer die aktuelle Zeit — die Reihenfolge
/// stimmt dann immer noch, weil neue Beiträge zuerst entdeckt werden.
fn zeit_aus(s: &str) -> Option<i64> {
    let t = s.trim();
    // Atom: 2026-08-01T12:34:56+00:00
    static RE_ISO: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})").unwrap()
    });
    if let Some(c) = RE_ISO.captures(t) {
        let g = |i: usize| c[i].parse::<i64>().unwrap_or(0);
        return Some(tage_seit_epoche(g(1), g(2), g(3)) * 86_400_000 + (g(4) * 3600 + g(5) * 60 + g(6)) * 1000);
    }
    // RSS: Fri, 01 Aug 2026 12:34:56 GMT
    static RE_RFC822: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?").unwrap()
    });
    if let Some(c) = RE_RFC822.captures(t) {
        const MON: [&str; 12] = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
        let monat = MON.iter().position(|m| *m == c[2].to_lowercase()).map(|i| i as i64 + 1)?;
        let g = |i: usize| c.get(i).and_then(|m| m.as_str().parse::<i64>().ok()).unwrap_or(0);
        return Some(
            tage_seit_epoche(g(3), monat, g(1)) * 86_400_000 + (g(4) * 3600 + g(5) * 60 + g(6)) * 1000,
        );
    }
    None
}

/// Tage seit 1970-01-01 (bürgerlicher Kalender, Howard Hinnants Verfahren).
fn tage_seit_epoche(jahr: i64, monat: i64, tag: i64) -> i64 {
    let y = if monat <= 2 { jahr - 1 } else { jahr };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (monat + 9) % 12;
    let doy = (153 * mp + 2) / 5 + tag - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Einen Feed (oder alle) abholen. Gibt die NEUEN Beiträge zurück.
pub async fn abholen(
    sperre: &std::sync::Mutex<Connection>,
    http: &reqwest::Client,
    nur_id: Option<&str>,
) -> Result<Vec<Beitrag>> {
    // Erst lesen und die Sperre wieder freigeben — über ein await darf sie
    // niemals gehalten werden, sonst steht die ganze App beim Netzzugriff.
    let mut feeds = {
        let conn = sperre.lock().unwrap();
        feeds_laden(&conn)
    };
    let ziele: Vec<usize> = feeds
        .iter()
        .enumerate()
        .filter(|(_, f)| nur_id.is_none_or(|id| f.id == id))
        .map(|(i, _)| i)
        .collect();
    if ziele.is_empty() {
        return Ok(Vec::new());
    }

    let mut vorhanden = {
        let conn = sperre.lock().unwrap();
        beitraege_laden(&conn)
    };
    let mut bekannt: HashSet<String> = vorhanden.iter().map(|b| b.id.clone()).collect();
    let mut neue = Vec::new();

    for i in ziele {
        let feed = feeds[i].clone();
        match holen(http, &feed.feed_url).await {
            Ok(xml) => {
                if let Some(t) = tag_inhalt(&xml, "title") {
                    if !t.is_empty() {
                        feeds[i].titel = t;
                    }
                }
                for block in eintraege(&xml).into_iter().take(MAX_PRO_FEED) {
                    let Some(mut b) = beitrag_aus(&block, &feed) else { continue };
                    if bekannt.contains(&b.id) {
                        continue;
                    }
                    bekannt.insert(b.id.clone());
                    /* Beim ERSTEN Abruf eines neuen Abos gilt nichts als „neu":
                       sonst löste ein frisch abonnierter Kanal sofort 15
                       Benachrichtigungen aus. Die Beiträge landen trotzdem in
                       der Liste — nur eben schon als gelesen. */
                    if feed.zuletzt == 0 {
                        b.gelesen = true;
                    } else {
                        neue.push(b.clone());
                    }
                    vorhanden.push(b);
                }
                feeds[i].zuletzt = jetzt();
                feeds[i].fehler = None;
            }
            Err(e) => {
                let msg = e.to_string().chars().take(200).collect::<String>();
                eprintln!("[feeds] \"{}\" nicht abrufbar: {msg}", feed.titel);
                feeds[i].fehler = Some(msg);
            }
        }
    }

    vorhanden.sort_by(|a, b| b.veroeffentlicht.cmp(&a.veroeffentlicht));
    {
        let conn = sperre.lock().unwrap();
        beitraege_speichern(&conn, &vorhanden)?;
        feeds_speichern(&conn, &feeds)?;
    }
    Ok(neue)
}

/* ── Lesen ─────────────────────────────────────────────────────────────── */

pub fn beitraege(conn: &Connection, art: Option<&str>, limit: usize, nur_ungelesen: bool) -> Vec<Beitrag> {
    let feeds = feeds_laden(conn);
    beitraege_laden(conn)
        .into_iter()
        .filter(|b| art.is_none_or(|a| b.art == a))
        .filter(|b| !nur_ungelesen || !b.gelesen)
        .take(limit.clamp(1, 300))
        .map(|mut b| {
            b.feed_titel = Some(
                feeds
                    .iter()
                    .find(|f| f.id == b.feed_id)
                    .map(|f| f.titel.clone())
                    .unwrap_or_else(|| "Unbekannt".into()),
            );
            b
        })
        .collect()
}

pub fn ungelesen_zahl(conn: &Connection, art: Option<&str>) -> i64 {
    beitraege_laden(conn)
        .iter()
        .filter(|b| !b.gelesen && art.is_none_or(|a| b.art == a))
        .count() as i64
}

/// Beiträge als gelesen markieren. Ohne `ids` alle.
pub fn als_gelesen(conn: &Connection, ids: Option<Vec<String>>) -> Result<i64> {
    let mut alle = beitraege_laden(conn);
    let menge: Option<HashSet<String>> = ids.map(|v| v.into_iter().collect());
    let mut n = 0;
    for b in alle.iter_mut() {
        if b.gelesen {
            continue;
        }
        if let Some(m) = &menge {
            if !m.contains(&b.id) {
                continue;
            }
        }
        b.gelesen = true;
        n += 1;
    }
    beitraege_speichern(conn, &alle)?;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ATOM: &str = r#"<?xml version="1.0"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
  <title>Mein Kanal</title>
  <entry>
    <id>yt:video:AAAAAAAAAAA</id>
    <yt:videoId>AAAAAAAAAAA</yt:videoId>
    <title>Erstes &amp; bestes Video</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=AAAAAAAAAAA"/>
    <published>2026-07-30T10:00:00+00:00</published>
    <media:group><media:description>Beschreibung hier</media:description></media:group>
  </entry>
  <entry>
    <id>yt:video:BBBBBBBBBBB</id>
    <yt:videoId>BBBBBBBBBBB</yt:videoId>
    <title><![CDATA[Zweites Video]]></title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=BBBBBBBBBBB"/>
    <published>2026-07-31T10:00:00+00:00</published>
  </entry>
</feed>"#;

    const RSS: &str = r#"<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Leak-Blog</title>
  <item>
    <title>Neuer Leak</title>
    <link>https://example.test/leak-1</link>
    <guid>leak-1</guid>
    <pubDate>Fri, 01 Aug 2026 12:00:00 GMT</pubDate>
    <description>Kurztext</description>
  </item>
</channel></rss>"#;

    fn feed(art: &str) -> Feed {
        Feed {
            id: "f1".into(),
            art: art.into(),
            titel: "T".into(),
            kanal_id: None,
            feed_url: "u".into(),
            seite: "s".into(),
            benachrichtigen: true,
            hinzugefuegt: 0,
            zuletzt: 1,
            fehler: None,
        }
    }

    #[test]
    fn atom_wird_gelesen() {
        let bloecke = eintraege(ATOM);
        assert_eq!(bloecke.len(), 2);
        let b = beitrag_aus(&bloecke[0], &feed("youtube")).expect("Beitrag");
        assert_eq!(b.video_id.as_deref(), Some("AAAAAAAAAAA"));
        // &amp; muss zu & werden, sonst steht die Entität im Titel
        assert_eq!(b.titel, "Erstes & bestes Video");
        assert_eq!(b.url.as_deref(), Some("https://www.youtube.com/watch?v=AAAAAAAAAAA"));
        assert_eq!(b.bild.as_deref(), Some("https://i.ytimg.com/vi/AAAAAAAAAAA/mqdefault.jpg"));
        assert_eq!(b.beschreibung.as_deref(), Some("Beschreibung hier"));
    }

    #[test]
    fn cdata_wird_ausgepackt() {
        let bloecke = eintraege(ATOM);
        let b = beitrag_aus(&bloecke[1], &feed("youtube")).expect("Beitrag");
        assert_eq!(b.titel, "Zweites Video");
    }

    #[test]
    fn rss_wird_gelesen() {
        let bloecke = eintraege(RSS);
        assert_eq!(bloecke.len(), 1);
        let b = beitrag_aus(&bloecke[0], &feed("blog")).expect("Beitrag");
        assert_eq!(b.titel, "Neuer Leak");
        assert_eq!(b.url.as_deref(), Some("https://example.test/leak-1"));
        assert!(b.video_id.is_none());
    }

    #[test]
    fn datum_atom_und_rss() {
        // 2026-07-30T10:00:00Z
        assert_eq!(zeit_aus("2026-07-30T10:00:00+00:00"), Some(1_785_405_600_000));
        // Fri, 01 Aug 2026 12:00:00 GMT
        assert_eq!(zeit_aus("Fri, 01 Aug 2026 12:00:00 GMT"), Some(1_785_585_600_000));
        assert_eq!(zeit_aus("weder noch"), None);
    }

    #[test]
    fn kennung_ist_stabil() {
        // Zweimal gelesen muss dieselbe id herauskommen — sonst gälte jeder
        // Abruf als "neu" und es hagelte Benachrichtigungen.
        let bloecke = eintraege(ATOM);
        let a = beitrag_aus(&bloecke[0], &feed("youtube")).unwrap();
        let b = beitrag_aus(&bloecke[0], &feed("youtube")).unwrap();
        assert_eq!(a.id, b.id);
        assert_eq!(a.id, "f1:AAAAAAAAAAA");
    }
}
