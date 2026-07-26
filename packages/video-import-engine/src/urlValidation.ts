import { VideoImportError } from './errors';

// Never regex-only: new URL() rejects malformed input outright, and the
// hostname comparison is exact (not a substring/regex match), so
// "youtube.com.evil.example" can never pass as "youtube.com".
export function assertAllowedDomain(
  url: string,
  allowedDomains: string[],
  engineName: string,
): void {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    throw new VideoImportError(`"${url}" is not a valid URL`, {
      category: 'unsupported',
      engineName,
      retryable: false,
    });
  }

  const isAllowed = allowedDomains.some((domain) => hostname === domain.toLowerCase());
  if (!isAllowed) {
    throw new VideoImportError(`"${hostname}" is not a supported import domain`, {
      category: 'unsupported',
      engineName,
      retryable: false,
    });
  }
}
