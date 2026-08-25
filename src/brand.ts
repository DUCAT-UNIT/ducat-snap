/** @fileoverview Exposes the inline Ducat brand mark used by Snap Home and confirmation interfaces. */
import icon from '../images/icon.svg';

/**
 * Single source of truth for the Ducat mark: the exact SVG the manifest publishes as the Snap
 * icon (`images/icon.svg`), imported as a string by snaps-cli.
 *
 * The SVG carries its own opaque background so it renders identically in light and dark mode.
 * MetaMask shows both the manifest icon and `Card`/`Image` SVGs inside an `<img>` data URI,
 * where page CSS and `currentColor` cannot reach and `prefers-color-scheme` follows the OS
 * theme rather than the MetaMask theme — so theme-adaptive SVG tricks are unreliable there.
 */
export const DUCAT_MARK_SVG: string = icon;
