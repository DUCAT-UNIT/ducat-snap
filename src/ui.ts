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
  }) as SnapElement;
}

export function uiSection(children: SnapElement[]): SnapElement {
  return SnapJsx.Section({ children }) as SnapElement;
}

export function uiHeading(value: string, size: 'sm' | 'md' | 'lg' = 'sm'): SnapElement {
  return SnapJsx.Heading({ children: value, size }) as SnapElement;
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
  }) as SnapElement;
}

export function uiMuted(value: string): SnapElement {
  return uiText(value, { color: 'muted', size: 'sm' });
}

export function uiCopyable(value: string, sensitive = false): SnapElement {
  return SnapJsx.Copyable({ value, sensitive }) as SnapElement;
}

export function uiLink(label: string, href: string): SnapElement {
  return SnapJsx.Link({ children: label, href }) as SnapElement;
}

export function uiCard(params: { title: string; value: string; description?: string; extra?: string; image?: string }): SnapElement {
  return SnapJsx.Card(params) as SnapElement;
}

export function uiCollapsibleSection(label: string, children: SnapElement[], isExpanded = false): SnapElement {
  return SnapJsx.CollapsibleSection({
    children,
    isExpanded,
    label,
  }) as SnapElement;
}

export function uiDivider(): SnapElement {
  return SnapJsx.Divider({}) as SnapElement;
}

export function uiValue(value: string, extra: string): SnapElement {
  return SnapJsx.Value({ value, extra }) as SnapElement;
}

export function uiRow(label: string, value: string | SnapElement, variant?: 'default' | 'warning' | 'critical', tooltip?: string): SnapElement {
  return SnapJsx.Row({
    label,
    variant,
    tooltip,
    children: typeof value === 'string' ? uiText(value, { alignment: 'end' }) : value,
  }) as SnapElement;
}

export function uiBanner(title: string, severity: 'danger' | 'info' | 'success' | 'warning', body: string): SnapElement {
  return SnapJsx.Banner({
    title,
    severity,
    children: uiText(body) as never,
  }) as SnapElement;
}
