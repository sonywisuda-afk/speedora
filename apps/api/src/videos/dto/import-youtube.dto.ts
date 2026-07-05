import { isYoutubeUrl, TranscriptionProvider } from '@speedora/shared';
import { IsEnum, IsOptional, registerDecorator, type ValidationOptions } from 'class-validator';

// Custom rather than @IsUrl() - this needs to reject any non-YouTube URL
// (Vimeo, a direct .mp4 link, etc.), not just validate general URL shape.
// Reuses the exact same check the frontend runs before ever submitting
// (see components/upload/ImportTabs.tsx), so the two can't drift apart.
function IsYoutubeUrl(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isYoutubeUrl',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && isYoutubeUrl(value);
        },
        defaultMessage() {
          return 'url must be a youtube.com or youtu.be video link';
        },
      },
    });
  };
}

export class ImportYoutubeDto {
  @IsYoutubeUrl()
  url!: string;

  // Chosen fresh per import (not an account-level setting) - omitted
  // defaults to the free GROQ tier in VideosController, same as
  // UploadVideoDto below.
  @IsOptional()
  @IsEnum(TranscriptionProvider)
  transcriptionProvider?: TranscriptionProvider;
}
