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

export interface Extras {
  trailerKey?: string | null;
  cast: CastMember[];
}

export interface Stats {
  watchedSeconds: number;
  moviesWatched: number;
  episodesWatched: number;
  inProgress: number;
}
