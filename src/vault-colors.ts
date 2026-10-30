import { Image } from '@metamask/snaps-sdk/jsx';

// Sampled from the supplied reference after converting its display profile to sRGB.
export const VAULT_IMPROVED_COLOR = '#6fc5a3';
export const VAULT_WORSENED_COLOR = '#ef8399';

/** Native Snap Text only accepts theme colors. An SVG keeps these value colors in Flask too. */
export function vaultColoredValue(value: string, improved: boolean) {
  const escaped = value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]!);
  // A compact, right-aligned canvas; extra room prevents large values from clipping.
  const width = Math.ceil([...value].reduce((sum, character) => sum
    + (' .,:;!ilI'.includes(character) ? 4.5 : 'MW%'.includes(character) ? 14 : 9.5), 2));
  return Image({
    alt: value,
    width,
    height: 24,
    src: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="24" viewBox="0 0 ${width} 24"><title>${escaped}</title><text x="${width}" y="18" text-anchor="end" font-family="Arial, sans-serif" font-size="16" font-weight="500" fill="${improved ? VAULT_IMPROVED_COLOR : VAULT_WORSENED_COLOR}">${escaped}</text></svg>`,
  });
}
