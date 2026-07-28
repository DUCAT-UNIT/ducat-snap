/** @fileoverview Wraps MetaMask Snap JSX constructors behind the typed UI API used across views. */
import * as SnapJsx from '@metamask/snaps-sdk/jsx';
import type { JSXElement } from '@metamask/snaps-sdk/jsx';

export type SnapElement = JSXElement;

export function uiBox(
  children: SnapElement[],
  options?: {
    alignment?: 'start' | 'center' | 'end' | 'space-between' | 'space-around';
    center?: boolean;
    crossAlignment?: 'start' | 'center' | 'end';
    direction?: 'vertical' | 'horizontal';
  },
): SnapElement {
  return SnapJsx.Box({
    children,
    alignment: options?.alignment,
    center: options?.center,
    crossAlignment: options?.crossAlignment,
    direction: options?.direction,
  });
}

export function uiSection(children: SnapElement[]): SnapElement {
  return SnapJsx.Section({ children });
}

export function uiHeading(value: string, size: 'sm' | 'md' | 'lg' = 'sm'): SnapElement {
  return SnapJsx.Heading({ children: value, size });
}

export function uiText(
  value: string,
  options?: {
    alignment?: 'start' | 'center' | 'end';
    color?: 'default' | 'alternative' | 'muted' | 'error' | 'success' | 'warning';
    size?: 'sm' | 'md';
    fontWeight?: 'regular' | 'medium' | 'bold';
  },
): SnapElement {
  return SnapJsx.Text({
    children: value,
    alignment: options?.alignment,
    color: options?.color,
    size: options?.size,
    fontWeight: options?.fontWeight,
  });
}

export function uiMuted(value: string): SnapElement {
  return uiText(value, { color: 'muted', size: 'sm' });
}

export function uiCopyable(value: string, sensitive = false): SnapElement {
  return SnapJsx.Copyable({ value, sensitive });
}

/**
 * Render a small built-in MetaMask icon inside compact confirmation rows.
 * @param name - MetaMask icon name.
 * @param color - MetaMask icon color.
 * @returns The rendered icon element.
 */
export function uiIcon(
  name: 'security-tick' | 'warning',
  color: 'default' | 'primary' | 'muted' | 'error' | 'success' | 'warning' = 'default',
): SnapElement {
  return SnapJsx.Icon({ name, color, size: 'inherit' });
}

/**
 * Align short icon-and-text indicators without custom CSS.
 * @param children - Inline child elements.
 * @returns The rendered inline group.
 */
export function uiInline(children: SnapElement[]): SnapElement {
  return uiBox(children, { direction: 'horizontal', crossAlignment: 'center' });
}

export function uiLink(label: string, href: string): SnapElement {
  return SnapJsx.Link({ children: label, href });
}

export function uiCard(params: { title: string; value: string; description?: string; extra?: string; image?: string }): SnapElement {
  return SnapJsx.Card(params);
}

export function uiCollapsibleSection(label: string, children: SnapElement[], isExpanded = false): SnapElement {
  return SnapJsx.CollapsibleSection({
    children,
    isExpanded,
    label,
  });
}

export function uiDivider(): SnapElement {
  return SnapJsx.Divider({});
}

export function uiValue(value: string, extra: string): SnapElement {
  return SnapJsx.Value({ value, extra });
}

export function uiRow(label: string, value: string | SnapElement, variant?: 'default' | 'warning' | 'critical', tooltip?: string): SnapElement {
  return SnapJsx.Row({
    label,
    variant,
    tooltip,
    children: typeof value === 'string' ? uiText(value, { alignment: 'end' }) : value,
  });
}

export function uiBanner(title: string, severity: 'danger' | 'info' | 'success' | 'warning', body: string): SnapElement {
  return SnapJsx.Banner({
    title,
    severity,
    children: uiText(body) as never,
  });
}

export function uiButton(
  value: string,
  options?: { name?: string; type?: 'button' | 'submit'; variant?: 'primary' | 'destructive' },
): SnapElement {
  return SnapJsx.Button({
    children: value,
    name: options?.name,
    type: options?.type,
    variant: options?.variant,
  });
}

export function uiField(label: string, child: SnapElement): SnapElement {
  return SnapJsx.Field({
    label,
    children: child as never,
  });
}

export function uiDropdown(name: string, value: string, options: { label: string; value: string }[]): SnapElement {
  return SnapJsx.Dropdown({
    name,
    value,
    children: options.map((option) => SnapJsx.Option({
      value: option.value,
      children: option.label,
    })),
  });
}

export function uiForm(name: string, children: SnapElement[]): SnapElement {
  return SnapJsx.Form({
    name,
    children,
  });
}

export function uiInput(
  name: string,
  type: 'text' | 'number' | 'password' = 'text',
  placeholder?: string,
  value?: string,
): SnapElement {
  return SnapJsx.Input({
    name,
    type,
    placeholder,
    value,
  });
}

export function uiSpinner(): SnapElement {
  return SnapJsx.Spinner({});
}
