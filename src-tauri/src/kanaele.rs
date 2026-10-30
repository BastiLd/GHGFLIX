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

/* So viele Beiträge werden insgesamt aufgehoben. Mit Gruppen kommen schnell
   10+ Abos zusammen — 600 sind als JSON immer noch nur wenige hundert KB. */
const MAX_ITEMS: usize = 600;
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
    /// Zu welcher Gruppe (Film/Serie) gehoert dieses Abo? None = keine.
    #[serde(default)]
    pub gruppe_id: Option<String>,
    #[serde(default)]
    pub gruppe_ids: Option<Vec<String>>,
}

impl Feed {
    fn gruppen_ids(&self) -> Vec<String> {
        self.gruppe_ids.clone().unwrap_or_else(|| self.gruppe_id.iter().cloned().collect())
    }
}

/* ══ Gruppen ══════════════════════════════════════════════════════════════
   Eine Gruppe ist ein Thema: ein Film, eine Filmreihe oder eine Serie. Darin
   liegen die Abos und Blogs, die dazu gehoeren.

   Warum am ABO und nicht am einzelnen Beitrag: ein Kanal bleibt beim Thema.
   Einmal einsortiert, landet alles Neue von selbst richtig. */

/* Ein echter Browser-Agent ist Pflicht: etliche Seiten (und YouTubes
   Zustimmungswand) behandeln "GHGFlix/1.0" anders als einen Browser. */
const UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// Consent headers are not evidence of a video format.
const CONSENT_COOKIE: &str = "SOCS=CAISEwgDEgk0ODE3Nzk3MjQaAmRlIAEaBgiA_LyaBg; CONSENT=YES+cb";

const SHORTS_CHECK_VERSION: u32 = 2;
const SHORTS_RETRY_MS: i64 = 24 * 60 * 60 * 1000;

pub const GRUPPEN_KEY: &str = "feed_gruppen";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Gruppe {
    pub id: String,
    pub name: String,
    pub emoji: String,
    pub farbe: Option<String>,
    /// Beim Oeffnen der Seite direkt aufklappen. Hoechstens EINE Gruppe.
    #[serde(default)]
    pub standard_offen: bool,
    #[serde(default)]
    pub sortierung: i64,
    #[serde(default)]
    pub angelegt: i64,
}

/// Eine Gruppe samt Zaehlern, so wie die Kachelansicht sie braucht.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GruppenKachel {
    pub id: Option<String>,
    pub name: String,
    pub emoji: String,
    pub farbe: Option<String>,
    pub standard_offen: bool,
    pub sortierung: i64,
    pub abos: i64,
    pub kanaele: i64,
    pub blogs: i64,
    pub beitraege: i64,
    pub ungelesen: i64,
    pub bilder: Vec<String>,
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
    /// None = noch nicht geprueft. Der Feed verraet es nicht.
    #[serde(default)]
    pub ist_short: Option<bool>,
    #[serde(default)]
    pub shorts_pruefung: u32,
    #[serde(default)]
    pub shorts_geprueft_am: i64,
    #[serde(default)]
    pub format_override: Option<String>,
    /// Merkliste („Spaeter ansehen")
    #[serde(default)]
    pub gemerkt: bool,
    #[serde(default)]
    pub gesehen: bool,
    /// Laufzeit in Sekunden, falls bekannt (kommt aus der Shorts-Pruefung).
    #[serde(default)]
    pub dauer_sek: Option<i64>,
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
    let mut items: Vec<Beitrag> = lesen(conn, ITEMS_KEY);
    for b in &mut items {
        if b.shorts_pruefung != SHORTS_CHECK_VERSION { b.ist_short = None; b.dauer_sek = None; }
    }
    items
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
        .header("User-Agent", UA)
        .header("Accept-Language", "de,en;q=0.8")
        .header("Cookie", CONSENT_COOKIE)
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
/* Uebliche Adressen, unter denen Blogsysteme ihren Feed anbieten.
   Gemessen am 01.08.2026: "tumblr.com" hat keinen Feed im HTML, ein echter
   Tumblr-Blog liefert aber unter /rss einen. Ohne dieses Abklopfen war
   "Blog hinzufuegen" fuer solche Seiten schlicht unmoeglich. */
const FEED_PFADE: &[&str] = &[
    "/feed", "/feed/", "/rss", "/rss/", "/rss.xml", "/feed.xml", "/atom.xml",
    "/index.xml", "/?feed=rss2", "/feeds/posts/default", "/blog/feed", "/news/feed",
];

fn sieht_nach_feed_aus(t: &str) -> bool {
    let kopf: String = t.chars().take(3000).collect::<String>().to_lowercase();
    kopf.contains("<rss") || kopf.contains("<feed") || kopf.contains("<rdf:rdf")
}

/// Aus einer Blog-Adresse den Feed heraussuchen.
///
/// Drei Stufen, weil jede fuer sich in echten Faellen scheitert:
///   1. Ist die Adresse selbst schon ein Feed?
///   2. Steht im HTML ein <link rel="alternate" type="application/rss+xml">?
///   3. Sonst die ueblichen Pfade abklopfen (/feed, /rss, ...).
///
/// Dazu ein HTTP-Rueckfall: `serienblitz.de` verweigert die HTTPS-Verbindung
/// rundweg (ECONNREFUSED auf Port 443), antwortet ueber http aber sauber.
/// Ohne diesen Rueckfall bekam der Nutzer nur "error sending request for url".
pub async fn blog_feed_ermitteln(http: &reqwest::Client, eingabe: &str) -> Result<String> {
    let roh = eingabe.trim();
    if roh.is_empty() {
        return Err(anyhow!("Bitte eine Adresse angeben"));
    }

    /* Gemessen am 01.08.2026: bei vorhandenem "https://"-Schema fehlte der
       http-Rückfall — https scheiterte mit ECONNREFUSED und es blieb dabei,
       obwohl der Rückfall bei schemalosen Eingaben schon lief. */
    let versuche: Vec<String> = if let Some(rest) = roh.strip_prefix("https://") {
        vec![roh.to_string(), format!("http://{rest}")]
    } else if roh.starts_with("http://") {
        vec![roh.to_string()]
    } else {
        vec![format!("https://{roh}"), format!("http://{roh}")]
    };

    let mut text: Option<String> = None;
    let mut basis = String::new();
    let mut fehler: Vec<String> = Vec::new();
    for u in &versuche {
        match holen(http, u).await {
            Ok(t) => {
                text = Some(t);
                basis = u.clone();
                break;
            }
            Err(e) => fehler.push(format!("{u}: {}", e.to_string().chars().take(80).collect::<String>())),
        }
    }
    let Some(text) = text else {
        return Err(anyhow!(
            "Die Seite ist nicht erreichbar.
{}
Tipp: Laeuft die Seite nur ueber http://? Dann bitte mit \"http://\" davor eintragen.",
            fehler.join("
")
        ));
    };

    // 1) Schon selbst ein Feed?
    if sieht_nach_feed_aus(&text) {
        return Ok(basis);
    }

    // 2) Im HTML verlinkt?
    if let Some(c) = RE_FEED_LINK_A.captures(&text).or_else(|| RE_FEED_LINK_B.captures(&text)) {
        let roh_link = entschluesseln(&c[1]);
        let b = reqwest::Url::parse(&basis)?;
        return Ok(b.join(&roh_link)?.to_string());
    }

    // 3) Uebliche Pfade abklopfen.
    let b = reqwest::Url::parse(&basis)?;
    let wurzel = format!("{}://{}", b.scheme(), b.host_str().unwrap_or_default());
    for p in FEED_PFADE {
        let Ok(kandidat) = reqwest::Url::parse(&wurzel).and_then(|u| u.join(p)) else { continue };
        let k = kandidat.to_string();
        if let Ok(t) = holen(http, &k).await {
            if sieht_nach_feed_aus(&t) {
                return Ok(k);
            }
        }
    }

    Err(anyhow!(
        "Auf \"{basis}\" ist kein RSS-/Atom-Feed zu finden - weder im Seitenkopf noch unter den ueblichen Adressen.
         Zwei haeufige Gruende:
         - Es ist die Startseite einer Plattform statt eines einzelnen Blogs. Bei Tumblr z. B. \"meinblog.tumblr.com\" statt \"tumblr.com\".
         - Die Seite bietet gar keinen Feed an. Dann hilft nur die Feed-Adresse direkt, falls es eine gibt."
    ))
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
            gruppe_id: None,
            gruppe_ids: None,
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
            gruppe_id: None,
            gruppe_ids: None,
        }
    };

    {
        let conn = sperre.lock().unwrap();
        abo_einfuegen(&conn, &feed)?;
    }
    // Direkt einmal abholen, damit die Liste nicht leer bleibt.
    let _ = abholen(sperre, http, Some(&feed.id)).await;
    let conn = sperre.lock().unwrap();
    Ok(feeds_laden(&conn).into_iter().find(|f| f.id == feed.id).unwrap_or(feed))
}

// Called under the connection lock after all network lookups have finished.
fn abo_einfuegen(conn: &Connection, feed: &Feed) -> Result<()> {
    let mut alle = feeds_laden(conn);
    if alle.iter().any(|f| f.feed_url == feed.feed_url
        || (feed.kanal_id.is_some() && f.kanal_id == feed.kanal_id)) {
        return Err(anyhow!("Dieser Kanal oder Feed ist schon abonniert"));
    }
    alle.push(feed.clone());
    feeds_speichern(conn, &alle)
}

pub fn abbestellen(conn: &Connection, id: &str) -> Result<bool> {
    let feeds: Vec<Feed> = feeds_laden(conn).into_iter().filter(|f| f.id != id).collect();
    feeds_speichern(conn, &feeds)?;
    let items: Vec<Beitrag> = beitraege_laden(conn).into_iter().filter(|b| b.feed_id != id).collect();
    beitraege_speichern(conn, &items)?;
    Ok(true)
}

/// `gruppe_id`: None = nicht anfassen, Some(None) = aus der Gruppe nehmen,
/// Some(Some(id)) = in diese Gruppe stecken.
pub fn feed_aendern(
    conn: &Connection,
    id: &str,
    benachrichtigen: Option<bool>,
    titel: Option<String>,
    gruppe_id: Option<Option<String>>,
    gruppe_ids: Option<Vec<String>>,
) -> Result<Feed> {
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
    if let Some(g) = gruppe_id {
        f.gruppe_ids = Some(g.iter().cloned().collect());
        f.gruppe_id = g;
    }
    if let Some(ids) = gruppe_ids {
        let mut unique = Vec::new();
        for id in ids { if !id.is_empty() && !unique.contains(&id) { unique.push(id); } }
        f.gruppe_id = unique.first().cloned();
        f.gruppe_ids = Some(unique);
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
        ist_short: None,
        shorts_pruefung: 0,
        shorts_geprueft_am: 0,
        format_override: None,
        gemerkt: false,
        gesehen: false,
        dauer_sek: None,
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
    let initial_ids: HashSet<String> = vorhanden.iter().map(|b| b.id.clone()).collect();
    let mut bekannt = initial_ids.clone();
    let mut neue = Vec::new();

    for &i in &ziele {
        let feed = feeds[i].clone();
        match holen(http, &feed.feed_url).await {
            Ok(xml) => {
                // Keep the subscription name, including names edited before this refresh.
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

    /* Shorts-Marke nachtragen — nur fuer Beitraege, die sie noch nicht haben.
       Bewusst NACH dem Einsammeln und mit Obergrenze: bei einem frisch
       abonnierten Kanal waeren es sonst 15 zusaetzliche Abrufe auf einmal.
       Was uebrig bleibt, holt der naechste Durchlauf. */
    let target_ids: HashSet<&str> = ziele.iter().map(|&i| feeds[i].id.as_str()).collect();
    let offen: Vec<(usize, String)> = vorhanden
        .iter()
        .enumerate()
        .filter(|(_, b)| target_ids.contains(b.feed_id.as_str()) && b.art == "youtube" && b.ist_short.is_none()
            && (b.shorts_geprueft_am == 0 || jetzt() - b.shorts_geprueft_am >= SHORTS_RETRY_MS))
        .filter_map(|(i, b)| b.video_id.clone().map(|v| (i, v)))
        .take(25)
        .collect();
    for (i, vid) in offen {
        let (ist_short, dauer) = ist_short_pruefen(&vid).await;
        vorhanden[i].ist_short = ist_short;
        vorhanden[i].dauer_sek = dauer;
        vorhanden[i].shorts_pruefung = SHORTS_CHECK_VERSION;
        vorhanden[i].shorts_geprueft_am = jetzt();
    }

    let results: Vec<Feed> = ziele.iter().map(|&i| feeds[i].clone()).collect();
    let conn = sperre.lock().unwrap();
    refresh_speichern(&conn, &results, vorhanden, &initial_ids, neue)
}

/// Called under the database mutex, after all network work has finished.
fn refresh_speichern(
    conn: &Connection,
    results: &[Feed],
    items: Vec<Beitrag>,
    initial_ids: &HashSet<String>,
    neue: Vec<Beitrag>,
) -> Result<Vec<Beitrag>> {
    let mut feeds = feeds_laden(conn);
    let active: HashSet<String> = feeds.iter().map(|f| f.id.clone()).collect();
    for current in &mut feeds {
        if let Some(result) = results.iter().find(|f| f.id == current.id) {
            if result.zuletzt >= current.zuletzt {
                current.zuletzt = result.zuletzt;
                current.fehler = result.fehler.clone();
            }
        }
    }
    let mut current_items: Vec<Beitrag> = beitraege_laden(conn).into_iter()
        .filter(|b| active.contains(&b.feed_id)).collect();
    let mut inserted = HashSet::new();
    for result in items {
        if !active.contains(&result.feed_id) { continue; }
        if let Some(current) = current_items.iter_mut().find(|b| b.id == result.id) {
            if result.shorts_pruefung == SHORTS_CHECK_VERSION && result.shorts_geprueft_am > current.shorts_geprueft_am {
                current.ist_short = result.ist_short;
                current.dauer_sek = result.dauer_sek;
                current.shorts_pruefung = result.shorts_pruefung;
                current.shorts_geprueft_am = result.shorts_geprueft_am;
            }
        } else if !initial_ids.contains(&result.id) {
            inserted.insert(result.id.clone());
            current_items.push(result);
        }
    }
    current_items.sort_by(|a, b| b.veroeffentlicht.cmp(&a.veroeffentlicht));
    beitraege_speichern(conn, &current_items)?;
    feeds_speichern(conn, &feeds)?;
    Ok(neue.into_iter().filter(|b| inserted.contains(&b.id)).collect())
}

/* ── Lesen ─────────────────────────────────────────────────────────────── */

/// Alle Filter der Oberflaeche in einem Aufruf.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    pub art: Option<String>,
    /// Some(Some(id)) = genau diese Gruppe, Some(None) = nur gruppenlose,
    /// None = egal.
    #[serde(default)]
    pub gruppe_id: Option<Option<String>>,
    pub feed_id: Option<String>,
    pub limit: Option<usize>,
    #[serde(default)]
    pub nur_ungelesen: bool,
    #[serde(default)]
    pub nur_gemerkt: bool,
    #[serde(default)]
    pub ohne_gesehene: bool,
    /// "shorts" | "videos" | None
    pub format: Option<String>,
    pub suche: Option<String>,
    /// "neu" | "alt" | "kanal"
    pub sortierung: Option<String>,
}

pub fn beitraege(conn: &Connection, f: &Filter) -> Vec<Beitrag> {
    let feeds = feeds_laden(conn);
    let titel_von = |id: &str| {
        feeds.iter().find(|x| x.id == id).map(|x| x.titel.clone()).unwrap_or_else(|| "Unbekannt".into())
    };

    // Welche Abo-IDs sind erlaubt? None = alle.
    let erlaubt: Option<HashSet<String>> = f.gruppe_id.as_ref().map(|g| {
        feeds
            .iter()
            .filter(|x| match g {
                Some(id) => x.gruppen_ids().contains(id),
                None => x.gruppen_ids().is_empty(),
            })
            .map(|x| x.id.clone())
            .collect()
    });

    let q = f.suche.as_ref().map(|s| s.to_lowercase()).filter(|s| !s.trim().is_empty());

    let mut liste: Vec<Beitrag> = beitraege_laden(conn)
        .into_iter()
        .filter(|b| f.art.as_deref().is_none_or(|a| b.art == a))
        .filter(|b| f.feed_id.as_deref().is_none_or(|id| b.feed_id == id))
        .filter(|b| erlaubt.as_ref().is_none_or(|s| s.contains(&b.feed_id)))
        .filter(|b| !f.nur_ungelesen || !b.gelesen)
        .filter(|b| !f.nur_gemerkt || b.gemerkt)
        .filter(|b| !f.ohne_gesehene || !b.gesehen)
        .filter(|b| {
            let actual = b.format_override.as_deref().unwrap_or(match b.ist_short {
                Some(true) => "shorts", Some(false) => "videos", None => "unknown",
            });
            f.format.as_deref().is_none_or(|wanted| actual == wanted)
        })
        .filter(|b| match &q {
            None => true,
            Some(q) => {
                let wo = format!(
                    "{} {} {}",
                    b.titel,
                    b.beschreibung.clone().unwrap_or_default(),
                    titel_von(&b.feed_id)
                )
                .to_lowercase();
                wo.contains(q.trim())
            }
        })
        .collect();

    match f.sortierung.as_deref() {
        Some("alt") => liste.sort_by(|a, b| a.veroeffentlicht.cmp(&b.veroeffentlicht)),
        Some("kanal") => liste.sort_by(|a, b| {
            titel_von(&a.feed_id)
                .to_lowercase()
                .cmp(&titel_von(&b.feed_id).to_lowercase())
                .then(b.veroeffentlicht.cmp(&a.veroeffentlicht))
        }),
        _ => liste.sort_by(|a, b| b.veroeffentlicht.cmp(&a.veroeffentlicht)),
    }

    liste
        .into_iter()
        .take(f.limit.unwrap_or(60).clamp(1, 400))
        .map(|mut b| {
            b.feed_titel = Some(titel_von(&b.feed_id));
            b
        })
        .collect()
}

/// Merkliste („Spaeter ansehen") umschalten.
pub fn merken(conn: &Connection, id: &str, an: bool) -> Result<bool> {
    let mut alle = beitraege_laden(conn);
    let b = alle.iter_mut().find(|x| x.id == id).ok_or_else(|| anyhow!("Diesen Beitrag gibt es nicht"))?;
    b.gemerkt = an;
    beitraege_speichern(conn, &alle)?;
    Ok(an)
}

/// Gesehen-Markierung umschalten. Gesehenes gilt zugleich als gelesen.
pub fn format_setzen(conn: &Connection, id: &str, format: Option<String>) -> Result<bool> {
    if format.as_deref().is_some_and(|f| !["videos", "shorts", "live", "podcasts", "trailer"].contains(&f)) {
        return Err(anyhow!("Unbekanntes Format"));
    }
    let mut all = beitraege_laden(conn);
    let item = all.iter_mut().find(|b| b.id == id).ok_or_else(|| anyhow!("Beitrag nicht gefunden"))?;
    item.format_override = format;
    beitraege_speichern(conn, &all)?;
    Ok(true)
}

pub fn gesehen_setzen(conn: &Connection, id: &str, an: bool) -> Result<bool> {
    let mut alle = beitraege_laden(conn);
    let b = alle.iter_mut().find(|x| x.id == id).ok_or_else(|| anyhow!("Diesen Beitrag gibt es nicht"))?;
    b.gesehen = an;
    if an {
        b.gelesen = true;
    }
    beitraege_speichern(conn, &alle)?;
    Ok(an)
}

/* ── Gruppen verwalten ─────────────────────────────────────────────────── */

pub fn gruppen_laden(conn: &Connection) -> Vec<Gruppe> {
    lesen(conn, GRUPPEN_KEY)
}
fn gruppen_speichern(conn: &Connection, v: &[Gruppe]) -> Result<()> {
    db::set_setting(conn, GRUPPEN_KEY, &serde_json::to_string(v)?)?;
    Ok(())
}

pub fn gruppe_anlegen(conn: &Connection, name: &str, emoji: Option<&str>, farbe: Option<&str>) -> Result<Gruppe> {
    let n = name.trim();
    if n.is_empty() {
        return Err(anyhow!("Die Gruppe braucht einen Namen"));
    }
    let mut alle = gruppen_laden(conn);
    if alle.iter().any(|g| g.name.eq_ignore_ascii_case(n)) {
        return Err(anyhow!("Eine Gruppe mit diesem Namen gibt es schon"));
    }
    let g = Gruppe {
        id: neue_id().replacen('f', "g", 1),
        name: n.to_string(),
        emoji: emoji.unwrap_or("📺").chars().take(4).collect(),
        farbe: farbe.map(String::from),
        standard_offen: false,
        sortierung: alle.len() as i64,
        angelegt: jetzt(),
    };
    alle.push(g.clone());
    gruppen_speichern(conn, &alle)?;
    Ok(g)
}

pub fn gruppe_aendern(
    conn: &Connection,
    id: &str,
    name: Option<String>,
    emoji: Option<String>,
    farbe: Option<Option<String>>,
    standard_offen: Option<bool>,
    sortierung: Option<i64>,
) -> Result<Gruppe> {
    let mut alle = gruppen_laden(conn);
    if !alle.iter().any(|g| g.id == id) {
        return Err(anyhow!("Diese Gruppe gibt es nicht"));
    }
    // Nur EINE Gruppe darf beim Oeffnen aufgehen.
    if standard_offen == Some(true) {
        for g in alle.iter_mut() {
            g.standard_offen = false;
        }
    }
    let g = alle.iter_mut().find(|g| g.id == id).unwrap();
    if let Some(n) = name {
        if !n.trim().is_empty() {
            g.name = n.trim().to_string();
        }
    }
    if let Some(e) = emoji {
        let e: String = e.chars().take(4).collect();
        g.emoji = if e.is_empty() { "📺".into() } else { e };
    }
    if let Some(f) = farbe {
        g.farbe = f;
    }
    if let Some(s) = standard_offen {
        g.standard_offen = s;
    }
    if let Some(s) = sortierung {
        g.sortierung = s;
    }
    let kopie = g.clone();
    gruppen_speichern(conn, &alle)?;
    Ok(kopie)
}

/// Gruppe loeschen. Die Abos darin bleiben — sie werden nur gruppenlos.
pub fn gruppe_loeschen(conn: &Connection, id: &str) -> Result<i64> {
    let rest: Vec<Gruppe> = gruppen_laden(conn).into_iter().filter(|g| g.id != id).collect();
    gruppen_speichern(conn, &rest)?;
    let mut feeds = feeds_laden(conn);
    let mut n = 0;
    for f in feeds.iter_mut() {
        if f.gruppen_ids().iter().any(|g| g == id) {
            let ids: Vec<String> = f.gruppen_ids().into_iter().filter(|g| g != id).collect();
            f.gruppe_id = ids.first().cloned();
            f.gruppe_ids = Some(ids);
            n += 1;
        }
    }
    if n > 0 {
        feeds_speichern(conn, &feeds)?;
    }
    Ok(n)
}

/// Gruppen mit Zaehlern, so wie die Kachelansicht sie braucht.
pub fn gruppen_uebersicht(conn: &Connection) -> Vec<GruppenKachel> {
    let feeds = feeds_laden(conn);
    let items = beitraege_laden(conn);
    let bau = |g: Option<&Gruppe>| -> GruppenKachel {
        let abos: Vec<&Feed> = feeds
            .iter()
            .filter(|f| match g {
                Some(g) => f.gruppen_ids().contains(&g.id),
                None => f.gruppen_ids().is_empty(),
            })
            .collect();
        let ids: HashSet<&str> = abos.iter().map(|f| f.id.as_str()).collect();
        let meine: Vec<&Beitrag> = items.iter().filter(|b| ids.contains(b.feed_id.as_str())).collect();
        GruppenKachel {
            id: g.map(|g| g.id.clone()),
            name: g.map(|g| g.name.clone()).unwrap_or_else(|| "Ohne Gruppe".into()),
            emoji: g.map(|g| g.emoji.clone()).unwrap_or_else(|| "📁".into()),
            farbe: g.and_then(|g| g.farbe.clone()),
            standard_offen: g.map(|g| g.standard_offen).unwrap_or(false),
            sortierung: g.map(|g| g.sortierung).unwrap_or(9999),
            abos: abos.len() as i64,
            kanaele: abos.iter().filter(|f| f.art == "youtube").count() as i64,
            blogs: abos.iter().filter(|f| f.art == "blog").count() as i64,
            beitraege: meine.len() as i64,
            ungelesen: meine.iter().filter(|b| !b.gelesen).count() as i64,
            bilder: meine.iter().filter_map(|b| b.bild.clone()).take(4).collect(),
        }
    };
    let mut gruppen = gruppen_laden(conn);
    gruppen.sort_by_key(|g| g.sortierung);
    let mut liste: Vec<GruppenKachel> = gruppen.iter().map(|g| bau(Some(g))).collect();
    let ohne = bau(None);
    // „Ohne Gruppe" nur zeigen, wenn dort wirklich etwas liegt.
    if ohne.abos > 0 {
        liste.push(ohne);
    }
    liste
}

/// Generic HTTP success, consent redirects and aspect ratio do not prove a format.
fn short_aus_antwort(video_id: &str, status: u16, location: Option<&str>) -> Option<bool> {
    if !(300..400).contains(&status) { return None; }
    let base = reqwest::Url::parse("https://www.youtube.com").ok()?;
    let url = base.join(location?).ok()?;
    let ids: Vec<_> = url.query_pairs().filter(|(k, _)| k == "v").map(|(_, v)| v.into_owned()).collect();
    if url.scheme() == "https" && matches!(url.host_str(), Some("youtube.com" | "www.youtube.com" | "m.youtube.com"))
        && url.username().is_empty() && url.password().is_none() && url.port().is_none()
        && url.path() == "/watch" && ids.len() == 1 && ids[0] == video_id {
        Some(false)
    } else { None }
}

async fn ist_short_pruefen(video_id: &str) -> (Option<bool>, Option<i64>) {
    if video_id.len() != 11 || !video_id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-') {
        return (None, None);
    }
    let Ok(client) = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(10)).build() else { return (None, None) };
    let Ok(res) = client.head(format!("https://www.youtube.com/shorts/{video_id}"))
        .header("User-Agent", UA).header("Cookie", CONSENT_COOKIE).send().await else { return (None, None) };
    (short_aus_antwort(video_id, res.status().as_u16(), res.headers().get("location").and_then(|v| v.to_str().ok())), None)
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
            gruppe_id: None,
            gruppe_ids: None,
        }
    }

    #[test]
    fn subscribing_preserves_current_edits_and_rejects_duplicate_commits() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);").unwrap();
        let mut edited = feed("blog");
        edited.titel = "Mein Name".into();
        edited.gruppe_ids = Some(vec!["eins".into(), "zwei".into()]);
        feeds_speichern(&conn, &[edited]).unwrap();
        let mut new = feed("youtube");
        new.id = "new".into(); new.feed_url = "https://youtube.com/feed".into();
        new.kanal_id = Some("UCabcdefghijklmnopqrstuv".into());
        abo_einfuegen(&conn, &new).unwrap();
        assert_eq!(feeds_laden(&conn)[0].titel, "Mein Name");
        assert_eq!(feeds_laden(&conn)[0].gruppen_ids(), vec!["eins", "zwei"]);
        let mut duplicate = new.clone(); duplicate.id = "second-request".into();
        assert!(abo_einfuegen(&conn, &duplicate).is_err());
        assert_eq!(feeds_laden(&conn).len(), 2);
        abbestellen(&conn, "f1").unwrap();
        new.id = "another".into(); new.feed_url = "different".into(); new.kanal_id = None;
        abo_einfuegen(&conn, &new).unwrap();
        assert!(!feeds_laden(&conn).iter().any(|f| f.id == "f1"));
    }

    #[test]
    fn legacy_and_multiple_groups_survive_serialization() {
        let mut f = feed("youtube");
        f.gruppe_id = Some("avatar".into());
        let mut old = serde_json::to_value(&f).unwrap();
        old.as_object_mut().unwrap().remove("gruppeIds");
        let restored: Feed = serde_json::from_value(old).unwrap();
        assert_eq!(restored.gruppen_ids(), vec!["avatar"]);
        f.gruppe_ids = Some(vec!["avatar".into(), "alles".into()]);
        let restored: Feed = serde_json::from_str(&serde_json::to_string(&f).unwrap()).unwrap();
        assert_eq!(restored.gruppen_ids(), vec!["avatar", "alles"]);
        f.gruppe_ids = Some(vec![]);
        assert!(f.gruppen_ids().is_empty());
    }

    #[test]
    fn refresh_preserves_edits_deletions_and_deduplicates_notifications() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);").unwrap();
        let original = feed("blog");
        let old = beitrag_aus(&eintraege(RSS)[0], &original).unwrap();
        let mut incoming = old.clone();
        incoming.id = "f1:new".into();
        let initial = HashSet::from([old.id.clone()]);
        let mut edited_feed = original.clone();
        edited_feed.titel = "Mein Name".into();
        edited_feed.gruppe_ids = Some(vec!["eins".into(), "zwei".into()]);
        edited_feed.benachrichtigen = false;
        feeds_speichern(&conn, &[edited_feed]).unwrap();
        let mut edited_item = old.clone();
        edited_item.gemerkt = true;
        edited_item.gesehen = true;
        edited_item.gelesen = true;
        edited_item.format_override = Some("podcasts".into());
        beitraege_speichern(&conn, &[edited_item]).unwrap();
        let commit = || refresh_speichern(&conn, &[original.clone()], vec![old.clone(), incoming.clone()], &initial, vec![incoming.clone()]).unwrap();
        assert_eq!(commit().len(), 1);
        assert!(commit().is_empty());
        let f = &feeds_laden(&conn)[0];
        assert_eq!(f.titel, "Mein Name");
        assert_eq!(f.gruppen_ids(), vec!["eins", "zwei"]);
        assert!(!f.benachrichtigen);
        let items = beitraege_laden(&conn);
        assert_eq!(items.len(), 2);
        let b = items.iter().find(|b| b.id == old.id).unwrap();
        assert!(b.gemerkt && b.gesehen && b.gelesen);
        assert_eq!(b.format_override.as_deref(), Some("podcasts"));
        abbestellen(&conn, &original.id).unwrap();
        assert!(commit().is_empty());
        assert!(feeds_laden(&conn).is_empty());
        assert!(beitraege_laden(&conn).is_empty());
    }

    #[test]
    fn shorts_requires_a_matching_source_redirect() {
        let id = "AAAAAAAAAAA";
        assert_eq!(short_aus_antwort(id, 200, None), None);
        assert_eq!(short_aus_antwort(id, 302, Some("https://consent.youtube.com/")), None);
        assert_eq!(short_aus_antwort(id, 303, Some("/watch?v=BBBBBBBBBBB")), None);
        assert_eq!(short_aus_antwort(id, 303, Some("https://example.test/watch?v=AAAAAAAAAAA")), None);
        assert_eq!(short_aus_antwort(id, 303, Some("/watch?v=AAAAAAAAAAA&v=BBBBBBBBBBB")), None);
        assert_eq!(short_aus_antwort(id, 303, Some("/watch?v=AAAAAAAAAAA")), Some(false));
    }

    #[test]
    fn legacy_guesses_are_unknown_without_losing_user_fields() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);").unwrap();
        let mut b = beitrag_aus(&eintraege(ATOM)[0], &feed("youtube")).unwrap();
        b.ist_short = Some(true);
        b.gemerkt = true;
        b.format_override = Some("podcasts".into());
        beitraege_speichern(&conn, &[b.clone()]).unwrap();
        let legacy = beitraege_laden(&conn).remove(0);
        assert_eq!(legacy.ist_short, None);
        assert!(legacy.gemerkt);
        assert_eq!(legacy.format_override.as_deref(), Some("podcasts"));
        b.shorts_pruefung = SHORTS_CHECK_VERSION;
        b.ist_short = Some(false);
        beitraege_speichern(&conn, &[b]).unwrap();
        assert_eq!(beitraege_laden(&conn)[0].ist_short, Some(false));
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
