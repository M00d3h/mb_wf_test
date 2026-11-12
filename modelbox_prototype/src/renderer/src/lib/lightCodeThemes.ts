import type { CSSProperties } from "react";
import { solarizedlight } from "react-syntax-highlighter/dist/esm/styles/prism";

/**
 * Light mode syntax highlighting: Solarized Light token colors on a white block
 * (classic Solarized uses cream; we force #fff to match the rest of the UI).
 */
export const LIGHT_CODE_SURFACE = "#ffffff";

/** Default body text — replaces Solarized’s muted grey `#657b83` for readability. */
const BASE_TEXT = "#171717";

const CODE_KEY = 'code[class*="language-"]';
const PRE_KEY = 'pre[class*="language-"]';

const solarizedBase = solarizedlight as Record<string, CSSProperties>;

export const lightModePrismStyle: Record<string, CSSProperties> = {
  ...solarizedBase,
  [CODE_KEY]: { ...(solarizedBase[CODE_KEY] ?? {}), color: BASE_TEXT },
  [PRE_KEY]: { ...(solarizedBase[PRE_KEY] ?? {}), color: BASE_TEXT },
};
