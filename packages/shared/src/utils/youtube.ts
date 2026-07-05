// Shared by the frontend's pre-submit check (ImportTabs.tsx - fail fast
// before ever hitting the network) and the backend's ImportYoutubeDto
// (the actual authoritative check) so the two can't drift into accepting
// different URLs. Deliberately permissive about query params/playlist
// context after the id - yt-dlp (apps/worker) is the one that actually
// resolves the URL, this just rejects obviously-not-YouTube input early.
const YOUTUBE_URL_PATTERN =
  /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=[\w-]+|youtu\.be\/[\w-]+|youtube\.com\/shorts\/[\w-]+)/i;

export function isYoutubeUrl(url: string): boolean {
  return YOUTUBE_URL_PATTERN.test(url.trim());
}
