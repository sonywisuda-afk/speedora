import { CaptionStyle } from './video';
import type { FontFamily } from './brand-kit';

// Subtitle Presets roadmap (P3b) - a named, user-saved bundle of the 3
// "subtitle look" axes (captionStyle/speakerColorCaptions/fontFamily),
// selectable per clip in the Timeline Editor.
export interface SubtitlePresetDto {
  id: string;
  name: string;
  captionStyle: CaptionStyle;
  speakerColorCaptions: boolean;
  fontFamily: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubtitlePresetListDto {
  presets: SubtitlePresetDto[];
}

// A small, fixed, non-persisted set of built-in presets - same "curated
// constant, not user data" shape as FONT_FAMILIES. Never touches the DB -
// selecting one in the Timeline Editor just bulk-sets the same
// already-validated Clip fields a custom SubtitlePreset also sets, so no
// backend validation surface is needed for these.
export interface BuiltInSubtitlePreset {
  key: string;
  name: string;
  captionStyle: CaptionStyle;
  speakerColorCaptions: boolean;
  fontFamily: FontFamily;
}

export const BUILT_IN_SUBTITLE_PRESETS: BuiltInSubtitlePreset[] = [
  {
    key: 'default',
    name: 'Default',
    captionStyle: CaptionStyle.DEFAULT,
    speakerColorCaptions: false,
    fontFamily: 'Inter',
  },
  {
    key: 'minimal',
    name: 'Minimal',
    captionStyle: CaptionStyle.DEFAULT,
    speakerColorCaptions: false,
    fontFamily: 'Open Sans',
  },
  {
    key: 'bold',
    name: 'Bold',
    captionStyle: CaptionStyle.BOLD_HIGHLIGHT,
    speakerColorCaptions: false,
    fontFamily: 'Montserrat',
  },
  {
    key: 'karaoke',
    name: 'Karaoke',
    captionStyle: CaptionStyle.KARAOKE,
    speakerColorCaptions: false,
    fontFamily: 'Poppins',
  },
  {
    key: 'creator',
    name: 'Creator',
    captionStyle: CaptionStyle.KARAOKE,
    speakerColorCaptions: true,
    fontFamily: 'Poppins',
  },
];
