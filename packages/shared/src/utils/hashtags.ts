// Normalizes a raw hashtag list into the storage form: no leading '#', no
// blank/whitespace-only entries. Used both by detect-clips's LLM response
// parsing (the model can ignore the "no #" instruction) and ClipsService's
// manual PATCH /clips/:id edits, so a hashtag looks the same in storage no
// matter which path produced it.
export function sanitizeHashtags(hashtags: string[]): string[] {
  return hashtags.map((tag) => tag.trim().replace(/^#+/, '')).filter((tag) => tag.length > 0);
}
