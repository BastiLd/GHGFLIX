/** Shared server data, using the same commands and image keys as the web app. */
export async function kanalAufruf(api, command, args = {}) {
  const data = await api(`/api/invoke/${command}`, { method: "POST", body: args });
  if (!data || data.error || !Object.prototype.hasOwnProperty.call(data, "result")) {
    throw new Error(data?.error || "Der Server hat keine gültige Antwort geliefert.");
  }
  return data.result;
}

export const gruppenIds = (feed) => feed.gruppeIds ?? (feed.gruppeId ? [feed.gruppeId] : []);
export const FORMATE = [
  ["", "Alle Formate"], ["videos", "Videos"], ["shorts", "Shorts"],
  ["live", "Livestreams"], ["podcasts", "Podcasts"], ["trailer", "Trailer"],
  ["unknown", "Unbekannt"],
];
export function beitragsFormat(item) {
  return item.formatOverride || (item.istShort === true ? "shorts" : item.istShort === false ? "videos" : "unknown");
}
export function webAdresse(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export async function kanalUebersicht(api) {
  const [groups, feeds, unread] = await Promise.all([
    kanalAufruf(api, "feed_groups"), kanalAufruf(api, "feeds_list"), kanalAufruf(api, "feed_unread"),
  ]);
  const groupsWithImages = await Promise.all(groups.map(async (g) => ({
    ...g, bild: g.id ? await kanalAufruf(api, "get_setting", { key: `feed_group_image_${g.id}` }) : null,
  })));
  // The total must not sum group counts: one channel can belong to several groups.
  return { groups: groupsWithImages, feeds, unread };
}
