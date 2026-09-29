/**
 * Window-size helpers for layouts (owner: shell):
 * sizes follow the CURRENT window (rotation, split screen, foldables) and fonts are never scaled
 * here (React Native already applies the user's font scale).
 */
import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

export const BREAKPOINTS = {
  /** Below this width a phone is "small" (compact paddings, stacked rows). */
  compact: 360,
  /** From this width on the layout is tablet-like (centered, width-limited content). */
  tablet: 768,
} as const;

/** Widest readable column for text-heavy screens. */
export const MAX_CONTENT_WIDTH = 640;

export interface ResponsiveLayout {
  width: number;
  height: number;
  isCompact: boolean;
  isTablet: boolean;
  isLandscape: boolean;
  /** Horizontal screen padding. */
  gutter: number;
  /** Width of the content column (at most MAX_CONTENT_WIDTH). */
  contentWidth: number;
}

export function computeResponsiveLayout(width: number, height: number): ResponsiveLayout {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 0;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 0;
  const isCompact = safeWidth < BREAKPOINTS.compact;
  const isTablet = safeWidth >= BREAKPOINTS.tablet;
  const gutter = isCompact ? 12 : isTablet ? 32 : 16;
  return {
    width: safeWidth,
    height: safeHeight,
    isCompact,
    isTablet,
    isLandscape: safeWidth > safeHeight,
    gutter,
    contentWidth: Math.max(0, Math.min(MAX_CONTENT_WIDTH, safeWidth - gutter * 2)),
  };
}

export function useResponsive(): ResponsiveLayout {
  const { width, height } = useWindowDimensions();
  return useMemo(() => computeResponsiveLayout(width, height), [width, height]);
}
