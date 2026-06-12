import type { Component, Panel } from '@metamask/snaps-sdk';

export function panel(children: Component[]): Panel {
  return {
    type: 'panel',
    children,
  } as unknown as Panel;
}

export function heading(value: string): Component {
  return {
    type: 'heading',
    value,
  } as unknown as Component;
}

export function text(value: string): Component {
  return {
    type: 'text',
    value,
    markdown: true,
  } as unknown as Component;
}

/**
 * Renders arbitrary signing content without Markdown interpretation.
 * @param value - The exact value to show.
 * @param sensitive - Whether MetaMask should treat the value as sensitive.
 * @returns A Snap copyable UI component.
 */
export function copyable(value: string, sensitive = false): Component {
  return {
    type: 'copyable',
    value,
    sensitive,
  } as unknown as Component;
}

export function divider(): Component {
  return {
    type: 'divider',
  } as unknown as Component;
}
