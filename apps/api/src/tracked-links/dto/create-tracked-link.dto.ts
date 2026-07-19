import { IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateTrackedLinkDto {
  // http(s)-only, protocol required - rejects javascript:/data:/file:/etc.
  // at the validation layer, before the request ever reaches
  // TrackedLinksService. The self-redirect-loop check (destinationUrl
  // can't point back into this app's own /r/ path) isn't expressible
  // declaratively here - see TrackedLinksService.assertNotSelfRedirect().
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  destinationUrl!: string;

  // Exactly one of publishRecordId/campaignId is required - not
  // expressible as a pair of decorators without knowing the other field's
  // value, so this is enforced in TrackedLinksService.create() (and, as
  // the real guarantee, by TrackedLink's own database CHECK constraint).
  @IsOptional()
  @IsString()
  publishRecordId?: string;

  @IsOptional()
  @IsString()
  campaignId?: string;
}
