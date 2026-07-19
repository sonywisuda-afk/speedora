// Sprint 6K (Conversion) - best-effort, substring-based bot/crawler
// detection over the User-Agent header. Not exhaustive (no UA-sniffing
// approach ever is), but covers the cases that matter most for an honest
// conversionCount: link-preview/unfurl bots (Slack, Discord, Facebook,
// X/Twitter, WhatsApp, Telegram, LinkedIn) that fetch a shared link once
// immediately after it's posted, generic search-engine crawlers, and
// common scripted-request tools. A false negative (a bot this list
// doesn't catch) undercounts less than a false positive would inflate a
// real creator's numbers, so this deliberately errs toward flagging more
// as "bot" rather than fewer - consistent with the project's "never a
// fabricated/inflated business KPI" rule.
const BOT_UA_SUBSTRINGS = [
  'bot',
  'spider',
  'crawl',
  'slackbot',
  'discordbot',
  'facebookexternalhit',
  'twitterbot',
  'whatsapp',
  'telegrambot',
  'linkedinbot',
  'pinterest',
  'duckduckbot',
  'baiduspider',
  'yandexbot',
  'preview',
  'unfurl',
  'curl/',
  'wget/',
  'python-requests',
  'go-http-client',
  'okhttp',
  'headlesschrome',
];

// A missing User-Agent entirely is itself unusual for a real browser click -
// treated conservatively as a bot rather than counted as a real conversion,
// same "when uncertain, don't inflate the number" posture as the list
// above.
export function isBotUserAgent(userAgent: string | undefined | null): boolean {
  if (!userAgent) return true;
  const normalized = userAgent.toLowerCase();
  return BOT_UA_SUBSTRINGS.some((substring) => normalized.includes(substring));
}
