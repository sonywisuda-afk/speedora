import * as http from 'node:http';

const BASE_URL = `http://localhost:${process.env.API_PORT ?? 3001}`;

interface RedirectResult {
  status: number;
  location: string | null;
}

// Thin fetch wrapper for the handful of real apps/api HTTP calls this
// verification script needs - one instance per seeded user, since auth here
// is a cookie (see auth.controller.ts's COOKIE_NAME), not a bearer token.
export class ApiClient {
  private cookie: string | undefined;

  static async isReachable(): Promise<boolean> {
    try {
      const res = await fetch(BASE_URL, { method: 'GET' });
      return res.status < 500;
    } catch {
      return false;
    }
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.cookie ? { Cookie: this.cookie } : {}),
    };
  }

  private captureCookie(res: Response): void {
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      this.cookie = setCookie.split(';')[0];
    }
  }

  private async request(path: string, init: RequestInit = {}): Promise<any> {
    const res = await fetch(`${BASE_URL}${path}`, { ...init, headers: this.headers() });
    this.captureCookie(res);
    if (!res.ok) {
      throw new Error(`${init.method ?? 'GET'} ${path} failed: ${res.status} ${await res.text()}`);
    }
    if (res.status === 204) return undefined;
    return res.json();
  }

  register(email: string, password: string) {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  publishClip(clipId: string, body: { socialAccountId: string; campaignId?: string }) {
    return this.request(`/clips/${clipId}/publish`, { method: 'POST', body: JSON.stringify(body) });
  }

  retryVideo(videoId: string) {
    return this.request(`/videos/${videoId}/retry`, { method: 'POST' });
  }

  createCampaign(
    workspaceId: string,
    body: { name: string; description?: string; startDate: string; endDate: string },
  ) {
    return this.request(`/workspaces/${workspaceId}/campaigns`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  getCampaignAnalytics(id: string) {
    return this.request(`/campaigns/${id}/analytics`);
  }

  getClipPerformance(clipId: string) {
    return this.request(`/clips/${clipId}/performance`);
  }

  getAnalyticsOverview() {
    return this.request('/analytics/overview');
  }

  getAnalyticsPerformance() {
    return this.request('/analytics/performance');
  }

  getAnalyticsFollowers() {
    return this.request('/analytics/followers');
  }

  getAnalyticsHeatmap() {
    return this.request('/analytics/heatmap');
  }

  createTrackedLink(
    workspaceId: string,
    body: { destinationUrl: string; publishRecordId?: string; campaignId?: string },
  ) {
    return this.request(`/workspaces/${workspaceId}/tracked-links`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // Raw http.request (not fetch) - deliberately bypasses fetch's own
  // redirect-following/opaque-redirect handling so the real 302 status and
  // Location header are always directly observable, which is exactly what
  // the bot-click/dedup assertions need to inspect.
  clickRedirect(slug: string, userAgent: string | undefined): Promise<RedirectResult> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        `${BASE_URL}/r/${slug}`,
        { method: 'GET', headers: userAgent ? { 'User-Agent': userAgent } : {} },
        (res) => {
          resolve({
            status: res.statusCode ?? 0,
            location: (res.headers.location as string) ?? null,
          });
          res.resume();
        },
      );
      req.on('error', reject);
      req.end();
    });
  }
}
