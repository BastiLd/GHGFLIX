export type LibraryKind = "movie" | "tv";

export interface Library {
  id: number;
  path: string;
  kind: LibraryKind;
}

export interface Movie {
  id: number;
  path: string;
  title: string;
  year?: number | null;
  tmdbId?: number | null;
  overview?: string | null;
  posterPath?: string | null;
  backdropPath?: string | null;
  genres?: string | null; // JSON array string
  runtime?: number | null;
  rating?: number | null;
  addedAt: number;
  identified: boolean;
  width?: number | null;
  height?: number | null;
  cert?: string | null;
}

export interface Show {
  id: number;
  folder?: string | null;
  title: string;
  year?: number | null;
  tmdbId?: number | null;
  overview?: string | null;
  posterPath?: string | null;
  backdropPath?: string | null;
  genres?: string | null;
  rating?: number | null;
  addedAt: number;
  identified: boolean;
  episodeCount: number;
  seasonCount: number;
  width?: number | null;
  height?: number | null;
  cert?: string | null;
  status?: string | null;
  lastYear?: number | null;
  runtime?: number | null;
  introStart?: number | null;
  introEnd?: number | null;
}

export interface Episode {
  id: number;
  showId: number;
  season: number;
  episode: number;
  path: string;
  title?: string | null;
  overview?: string | null;
  stillPath?: string | null;
  airDate?: string | null;
  runtime?: number | null;
  addedAt: number;
  introStart?: number | null;
  introEnd?: number | null;
  showTitle?: string | null;
  width?: number | null;
  height?: number | null;
  fileCount?: number;
}

export interface EpisodeFile {
  id: number;
  episodeId: number;
  path: string;
  width?: number | null;
  height?: number | null;
  addedAt: number;
}

/** A playable quality/version of a movie or episode (used by the player switch). */
export interface MediaVersion {
  id: number;
  path: string;
  width?: number | null;
  height?: number | null;
}

export interface TmdbImage {
  filePath: string;
  kind: "poster" | "backdrop" | "still";
  width?: number | null;
  height?: number | null;
  voteAverage?: number | null;
  lang?: string | null;
}

export type ArtworkTarget =
  | { target: "movie"; id: number; tmdbId?: number | null; title: string }
  | { target: "show"; id: number; tmdbId?: number | null; title: string }
  | { target: "season"; id: number; tmdbId?: number | null; season: number; title: string }
  | { target: "episode"; id: number; tmdbId?: number | null; season: number; episode: number; title: string };

export interface SeasonGroup {
  season: number;
  episodes: Episode[];
}

export interface ShowDetail {
  show: Show;
  seasons: SeasonGroup[];
  /** Kinofilme, die zu dieser Serie gehören (Reiter „Filme"). */
  movies?: Movie[];
}

export interface Progress {
  profileId: string;
  mediaType: "movie" | "episode";
  refId: number;
  tmdbId?: number | null;
  season?: number | null;
  episode?: number | null;
  positionSec: number;
  durationSec: number;
  watched: boolean;
  updatedAt: number;
}

export interface ContinueItem {
  mediaType: "movie" | "episode";
  refId: number;
  title: string;
  subtitle?: string | null;
  posterPath?: string | null;
  backdropPath?: string | null;
  positionSec: number;
  durationSec: number;
  progress: number;
  updatedAt: number;
  showId?: number | null;
  season?: number | null;
  episode?: number | null;
}

export interface TmdbResult {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  year?: number | null;
  overview?: string | null;
  posterPath?: string | null;
  backdropPath?: string | null;
  rating?: number | null;
}

export interface ScanProgress {
  stage: string;
  message: string;
  current: number;
  total: number;
}

export interface Favorite {
  mediaType: "movie" | "show";
  refId: number;
  addedAt: number;
}

export interface CastMember {
  name: string;
  character?: string | null;
  profilePath?: string | null;
}

/** Ein YouTube-Video von TMDb — Trailer, Teaser, Clip, Featurette … */
export interface TrailerVideo {
  key: string;
  name: string;
  site: string;
  /** „Trailer“, „Teaser“, „Clip“ … */
  type: string;
  /** Sprachkürzel wie „de“, „en“ — Grundlage der Sprachauswahl. */
  lang?: string | null;
  region?: string | null;
  official: boolean;
  publishedAt?: string | null;
  size?: number | null;
  /** Bei Serien: zu welcher Staffel (null = zur ganzen Serie). */
  season?: number | null;
}

export interface Extras {
  trailerKey?: string | null;
  /** Alle gefundenen Videos mit Sprache (Punkt 4). */
  videos?: TrailerVideo[];
  cast: CastMember[];
}

export interface Stats {
  watchedSeconds: number;
  moviesWatched: number;
  episodesWatched: number;
  inProgress: number;
}

// ===== Auswahl-Fenster für Ordner (Punkt 1) =====

/** Ein im Ordner gefundenes Video, so wie es das Auswahl-Fenster anzeigt. */
export interface FolderHit {
  path: string;
  name: string;
  /** Ordner der Datei — die Oberfläche gruppiert danach. */
  dir: string;
  sizeBytes: number;
  /** Geraten; der Nutzer kann beim Bestätigen noch umstellen. */
  kind: "movie" | "episode";
  title: string;
  year?: number | null;
  season?: number | null;
  episode?: number | null;
  /** Schon in der Bibliothek? Dann ist nichts zu tun. */
  inLibrary: boolean;
  /** Früher schon abgelehnt? */
  ignored: boolean;
}

export interface FolderPreview {
  path: string;
  hits: FolderHit[];
  /** Übersprungene Schnipsel/Winzdateien — nur als Zahl. */
  skipped: number;
  truncated: boolean;
}

export interface ImportSummary {
  accepted: number;
  rejected: number;
  libraryId?: number | null;
  libraryCreated: boolean;
  removed: number;
}

// ===== Kanäle & Feeds (Punkt 5) =====

/** Ein Abo — YouTube-Kanal oder Blog/Leak-Feed. */
export interface Feed {
  id: string;
  art: "youtube" | "blog";
  titel: string;
  kanalId?: string | null;
  feedUrl: string;
  /** Seite zum Anklicken (Kanalseite bzw. Blog). */
  seite: string;
  benachrichtigen: boolean;
  /** Zu welcher Gruppe (Film/Serie) gehört dieses Abo? null = keine. */
  gruppeId?: string | null;
  hinzugefuegt: number;
  /** Zeitpunkt des letzten erfolgreichen Abrufs (0 = noch nie). */
  zuletzt: number;
  fehler?: string | null;
}

/** Ein Beitrag aus einem Abo. */
export interface FeedBeitrag {
  id: string;
  feedId: string;
  art: "youtube" | "blog";
  videoId?: string | null;
  titel: string;
  url?: string | null;
  bild?: string | null;
  beschreibung?: string | null;
  veroeffentlicht: number;
  gelesen: boolean;
  /** null = noch nicht geprüft (der Feed verrät es nicht). */
  istShort?: boolean | null;
  /** Merkliste „Später ansehen" */
  gemerkt?: boolean;
  gesehen?: boolean;
  /** Laufzeit in Sekunden, falls bekannt (aus der Shorts-Prüfung). */
  dauerSek?: number | null;
  entdeckt: number;
  /** Name des Abos — nur beim Abrufen gefüllt. */
  feedTitel?: string | null;
}

/** Eine Gruppe auf der Kanäle-Seite: ein Film, eine Filmreihe oder eine Serie. */
export interface FeedGruppe {
  /** null = die Sammelkachel „Ohne Gruppe" */
  id: string | null;
  name: string;
  emoji: string;
  farbe?: string | null;
  /** Beim Öffnen der Seite direkt aufklappen — höchstens eine Gruppe. */
  standardOffen: boolean;
  sortierung: number;
  abos: number;
  kanaele: number;
  blogs: number;
  beitraege: number;
  ungelesen: number;
  /** Ein paar Vorschaubilder für die Kachel. */
  bilder: string[];
}

/** Filter für die Beitragsliste. */
export interface FeedFilter {
  art?: "youtube" | "blog" | null;
  /** undefined = egal, null = nur gruppenlose, sonst genau diese Gruppe. */
  gruppeId?: string | null;
  feedId?: string | null;
  limit?: number;
  unreadOnly?: boolean;
  savedOnly?: boolean;
  hideWatched?: boolean;
  format?: "shorts" | "videos" | null;
  search?: string | null;
  sort?: "neu" | "alt" | "kanal";
}
