import { ExportType } from '@speedora/shared';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateExportDto {
  // Optional since ANALYTICS_REPORT is account-wide, not video-scoped - every
  // other ExportType still requires it. ExportService.create() enforces the
  // mutual-exclusion rule (required unless ANALYTICS_REPORT, forbidden when
  // ANALYTICS_REPORT) at the service level, since class-validator has no
  // clean way to express "required depending on a sibling field's value."
  @IsOptional()
  @IsString()
  videoId?: string;

  // Optional and defaults to PDF in ExportService.create(). Sprint 03d added
  // EXCEL/HIGHLIGHT_REPORT/BRAND_REPORT to the enum with no DTO change - all
  // still videoId-scoped like PDF.
  @IsOptional()
  @IsEnum(ExportType)
  type?: ExportType;
}
