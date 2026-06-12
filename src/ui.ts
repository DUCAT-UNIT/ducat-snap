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

export function divider(): Component {
  return {
    type: 'divider',
  } as unknown as Component;
}
