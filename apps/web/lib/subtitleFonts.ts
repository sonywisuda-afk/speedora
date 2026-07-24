// Subtitle Presets roadmap (P3b) - self-hosts the same 8 curated families
// apps/worker's Dockerfile bundles (packages/contracts' FONT_FAMILIES),
// via next/font/google (build-time download, no runtime Google request -
// consistent with the "curated list, not arbitrary upload" decision from
// Brand Kit roadmap P3a). Weights 400+700 so BOLD_HIGHLIGHT's bold words
// preview correctly in TimelineEditor's canvas caption preview.
import {
  Inter,
  Lato,
  Montserrat,
  Nunito,
  Open_Sans,
  Oswald,
  Poppins,
  Roboto,
} from 'next/font/google';
import type { FontFamily } from '@speedora/shared';

const inter = Inter({ weight: ['400', '700'], subsets: ['latin'] });
const poppins = Poppins({ weight: ['400', '700'], subsets: ['latin'] });
const montserrat = Montserrat({ weight: ['400', '700'], subsets: ['latin'] });
const roboto = Roboto({ weight: ['400', '700'], subsets: ['latin'] });
const oswald = Oswald({ weight: ['400', '700'], subsets: ['latin'] });
const nunito = Nunito({ weight: ['400', '700'], subsets: ['latin'] });
const openSans = Open_Sans({ weight: ['400', '700'], subsets: ['latin'] });
const lato = Lato({ weight: ['400', '700'], subsets: ['latin'] });

// Each font object's own .style.fontFamily is a real, usable CSS
// font-family string (e.g. "__Inter_abc123, __Inter_Fallback_abc123") -
// works directly in a canvas ctx.font string once Next has injected the
// @font-face rule, which happens at import time regardless of whether
// .className is ever applied to a DOM node.
export const FONT_FAMILY_CSS: Record<FontFamily, string> = {
  Inter: inter.style.fontFamily,
  Poppins: poppins.style.fontFamily,
  Montserrat: montserrat.style.fontFamily,
  Roboto: roboto.style.fontFamily,
  Oswald: oswald.style.fontFamily,
  Nunito: nunito.style.fontFamily,
  'Open Sans': openSans.style.fontFamily,
  Lato: lato.style.fontFamily,
};
