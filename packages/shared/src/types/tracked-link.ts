// Sprint 6K (Conversion - first-party click-tracking). A Speedora-owned
// trackable redirect link - the real, first-party data source behind every
// conversionCount this app reports (see ClipTrafficEntry.conversionCount,
// CampaignAnalyticsDto.conversionCount). Never both publishRecordId and
// campaignId, never neither - see TrackedLink's own Prisma model comment
// for the database-level guarantee behind this.
export interface TrackedLinkDto {
  id: string;
  slug: string;
  // The full public redirect URL (e.g. https://api.example.com/r/ab12cd34) -
  // computed server-side so the frontend never has to know the API's own
  // base URL/host.
  redirectUrl: string;
  destinationUrl: string;
  publishRecordId: string | null;
  campaignId: string | null;
  // Bot-filtered - see TrackedLinkClick.isBot's own comment. Always the
  // real, honest number, never an estimate.
  clickCount: number;
  createdAt: string;
}

export interface TrackedLinkListDto {
  links: TrackedLinkDto[];
}
