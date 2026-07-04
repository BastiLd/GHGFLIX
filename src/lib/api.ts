import { invoke } from "@tauri-apps/api/core";
import type {
  ContinueItem,
  Episode,
  Extras,
  Favorite,
  Library,
  LibraryKind,
  EpisodeFile,
  Movie,
  Progress,
  Show,
  ShowDetail,
  Stats,
  TmdbImage,
  TmdbResult,
} from "./types";

// ===== settings =====
export const getSetting = (key: string) => invoke<string | null>("get_setting", { key });
export const setSetting = (key: string, value: string) => invoke<void>("set_setting", { key, value });

// ===== libraries =====
export const getLibraries = () => invoke<Library[]>("get_libraries");
export const addLibrary = (path: string, kind: LibraryKind) => invoke<number>("add_library", { path, kind });
export const detectLibraries = (root: string) => invoke<Library[]>("detect_libraries", { root });
export const removeLibrary = (id: number) => invoke<void>("remove_library", { id });

// ===== scanning =====
export const scanLibraries = () => invoke<void>("scan_libraries");
export const refreshMetadata = () => invoke<void>("refresh_metadata");
export const detectIntros = (showId?: number) => invoke<void>("detect_intros", { showId: showId ?? null });
export const isScanning = () => invoke<boolean>("is_scanning");
export const resetLibrary = () => invoke<void>("reset_library");

// ===== library reads =====
export const listMovies = () => invoke<Movie[]>("list_movies");
export const getMovie = (id: number) => invoke<Movie | null>("get_movie", { id });
export const movieVersions = (id: number) => invoke<Movie[]>("movie_versions", { id });
export const listShows = () => invoke<Show[]>("list_shows");
export const getShowDetail = (id: number) => invoke<ShowDetail | null>("get_show_detail", { id });
export const getEpisode = (id: number) => invoke<Episode | null>("get_episode", { id });
export const episodeVersions = (id: number) => invoke<EpisodeFile[]>("episode_versions", { id });
export const listShowEpisodes = (showId: number) => invoke<Episode[]>("list_show_episodes", { showId });
export const pathExists = (path: string) => invoke<boolean>("path_exists", { path });
export const revealInExplorer = (path: string) => invoke<void>("reveal_in_explorer", { path });
export const openAppData = () => invoke<void>("open_app_data");

// ===== TMDb + identify =====
export const searchTmdb = (query: string, kind: "movie" | "tv" | "multi") =>
  invoke<TmdbResult[]>("search_tmdb", { query, kind });
export const identifyMovie = (movieId: number, tmdbId: number, remember = true) =>
  invoke<void>("identify_movie", { movieId, tmdbId, remember });
/** Returns the surviving show id (identifying can merge duplicate folders). */
export const identifyShow = (showId: number, tmdbId: number, remember = true) =>
  invoke<number>("identify_show", { showId, tmdbId, remember });
export const setEpisodeNumbers = (episodeId: number, season: number, episode: number) =>
  invoke<void>("set_episode_numbers", { episodeId, season, episode });
/** "This file is SxxEyy — and everything after it in order": returns assigned count. */
export const assignEpisodesSequential = (episodeId: number, season: number, episode: number) =>
  invoke<number>("assign_episodes_sequential", { episodeId, season, episode });
export interface TmdbEpisodeInfo {
  episode: number;
  title?: string | null;
  overview?: string | null;
  stillPath?: string | null;
  airDate?: string | null;
}
export const tmdbSeasonList = (tmdbId: number, season: number) =>
  invoke<TmdbEpisodeInfo[]>("tmdb_season_list", { tmdbId, season });
export const tmdbSeasonNumbers = (tmdbId: number) =>
  invoke<number[]>("tmdb_season_numbers", { tmdbId });

// ===== progress =====
export const setProgress = (
  profileId: string,
  mediaType: "movie" | "episode",
  refId: number,
  positionSec: number,
  durationSec: number,
  watched: boolean,
) => invoke<void>("set_progress", { profileId, mediaType, refId, positionSec, durationSec, watched });

export const getProgress = (profileId: string, mediaType: "movie" | "episode", refId: number) =>
  invoke<Progress | null>("get_progress", { profileId, mediaType, refId });

export const listProgress = (profileId: string) => invoke<Progress[]>("list_progress", { profileId });
export const continueWatching = (profileId: string) =>
  invoke<ContinueItem[]>("continue_watching", { profileId });
export const recentlyWatched = (profileId: string, limit = 20) =>
  invoke<ContinueItem[]>("recently_watched", { profileId, limit });

export interface FileInfoResult {
  sizeBytes: number;
  modifiedSecs?: number | null;
  exists: boolean;
}
export const fileInfo = (path: string) => invoke<FileInfoResult>("file_info", { path });

export interface RemoteProgressRow {
  mediaType: "movie" | "episode";
  tmdbId: number;
  season?: number | null;
  episode?: number | null;
  positionSec: number;
  durationSec: number;
  watched: boolean;
  updatedAt: number;
}
export const applyRemoteProgress = (profileId: string, rows: RemoteProgressRow[]) =>
  invoke<void>("apply_remote_progress", { profileId, rows });

// ===== favorites / watched / stats / extras =====
export const toggleFavorite = (profileId: string, mediaType: "movie" | "show", refId: number) =>
  invoke<boolean>("toggle_favorite", { profileId, mediaType, refId });
export const listFavorites = (profileId: string) => invoke<Favorite[]>("list_favorites", { profileId });
export const setWatched = (profileId: string, mediaType: "movie" | "episode", refId: number, watched: boolean) =>
  invoke<void>("set_watched", { profileId, mediaType, refId, watched });
export const setShowWatched = (profileId: string, showId: number, watched: boolean) =>
  invoke<void>("set_show_watched", { profileId, showId, watched });
export const setSeasonWatched = (profileId: string, showId: number, season: number, watched: boolean) =>
  invoke<void>("set_season_watched", { profileId, showId, season, watched });
export const getStats = (profileId: string) => invoke<Stats>("get_stats", { profileId });
export const tmdbExtras = (mediaType: "movie" | "tv", tmdbId: number) =>
  invoke<Extras>("tmdb_extras", { mediaType, tmdbId });

// ===== artwork (Plex-style) + quality =====
export const tmdbImages = (
  mediaType: "movie" | "tv" | "season" | "episode",
  tmdbId: number,
  season?: number | null,
  episode?: number | null,
) => invoke<TmdbImage[]>("tmdb_images", { mediaType, tmdbId, season: season ?? null, episode: episode ?? null });

export const setArtwork = (
  target: "movie" | "show" | "episode" | "season",
  id: number,
  path: string,
  opts?: { field?: "poster" | "backdrop"; season?: number },
) => invoke<void>("set_artwork", { target, id, path, field: opts?.field ?? null, season: opts?.season ?? null });

export const getSeasonArt = (showId: number) => invoke<[number, string][]>("get_season_art", { showId });

export const mediaThumbnail = (path: string, timeSec: number) =>
  invoke<string>("media_thumbnail", { path, timeSec });

export const probeQualities = (force = false) => invoke<void>("probe_qualities", { force });

// ===== tools / maintenance =====
export interface ToolStatus {
  path?: string | null;
  ok: boolean;
  version?: string | null;
}
export interface ToolsReport {
  mpv: ToolStatus;
  ffmpeg: ToolStatus;
  ffprobe: ToolStatus;
}
export const checkTools = () => invoke<ToolsReport>("check_tools");
export const thumbCacheSize = () => invoke<number>("thumb_cache_size");
export const clearThumbCache = () => invoke<number>("clear_thumb_cache");
export const dbOptimize = () => invoke<void>("db_optimize");
export const exportData = (path: string) => invoke<number>("export_data", { path });
export const importData = (path: string) => invoke<number>("import_data", { path });

// ===== playback-derived metadata =====
export const setMediaDims = (
  mediaType: "movie" | "episode",
  id: number,
  path: string,
  width: number,
  height: number,
) => invoke<void>("set_media_dims", { mediaType, id, path, width, height });

// ===== intro windows =====
export const setEpisodeIntro = (episodeId: number, start: number, end: number) =>
  invoke<void>("set_episode_intro", { episodeId, start, end });
export const setShowIntro = (showId: number, start: number | null, end: number | null) =>
  invoke<void>("set_show_intro", { showId, start, end });

// ===== search =====
export const searchEpisodes = (query: string) => invoke<Episode[]>("search_episodes", { query });
