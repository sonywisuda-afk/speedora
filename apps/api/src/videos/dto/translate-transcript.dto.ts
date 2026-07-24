import { IsString, Length } from 'class-validator';

// Subtitle Studio roadmap (P2f) - a free-form BCP-47-ish language code/name
// (e.g. 'en', 'id', 'es', 'Spanish') passed straight into the LLM prompt
// rather than validated against a closed enum - translation quality depends
// on the LLM understanding the target language, not on this codebase
// maintaining a language list.
export class TranslateTranscriptDto {
  @IsString()
  @Length(1, 40)
  languageCode!: string;
}
