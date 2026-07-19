import { isBotUserAgent } from './bot-detection.util';

describe('isBotUserAgent', () => {
  it('treats a missing User-Agent as a bot - conservative, never inflates conversionCount', () => {
    expect(isBotUserAgent(undefined)).toBe(true);
    expect(isBotUserAgent(null)).toBe(true);
    expect(isBotUserAgent('')).toBe(true);
  });

  it('flags known link-preview/unfurl bots', () => {
    expect(isBotUserAgent('Slackbot-LinkExpanding 1.0')).toBe(true);
    expect(isBotUserAgent('facebookexternalhit/1.1')).toBe(true);
    expect(isBotUserAgent('TelegramBot (like TwitterBot)')).toBe(true);
    expect(isBotUserAgent('WhatsApp/2.23')).toBe(true);
  });

  it('flags generic search-engine crawlers', () => {
    expect(isBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true);
    expect(isBotUserAgent('Mozilla/5.0 (compatible; Baiduspider/2.0)')).toBe(true);
  });

  it('flags common scripted-request tools', () => {
    expect(isBotUserAgent('curl/8.4.0')).toBe(true);
    expect(isBotUserAgent('python-requests/2.31.0')).toBe(true);
    expect(isBotUserAgent('okhttp/4.9.0')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isBotUserAgent('MOZILLA/5.0 GOOGLEBOT/2.1')).toBe(true);
  });

  it('does not flag a real browser User-Agent', () => {
    const chrome =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const safariMobile =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

    expect(isBotUserAgent(chrome)).toBe(false);
    expect(isBotUserAgent(safariMobile)).toBe(false);
  });
});
