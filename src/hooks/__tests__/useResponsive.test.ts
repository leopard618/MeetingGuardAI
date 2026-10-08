import { BREAKPOINTS, MAX_CONTENT_WIDTH, computeResponsiveLayout } from '../useResponsive';

describe('computeResponsiveLayout', () => {
  it('uses compact gutters on small phones', () => {
    const layout = computeResponsiveLayout(320, 640);
    expect(layout).toMatchObject({ isCompact: true, isTablet: false, isLandscape: false, gutter: 12 });
    expect(layout.contentWidth).toBe(320 - 24);
  });

  it('limits the content column on tablets and in landscape', () => {
    const layout = computeResponsiveLayout(1024, 768);
    expect(layout).toMatchObject({ isCompact: false, isTablet: true, isLandscape: true, gutter: 32 });
    expect(layout.contentWidth).toBe(MAX_CONTENT_WIDTH);
  });

  it('treats a regular phone as neither compact nor tablet', () => {
    const layout = computeResponsiveLayout(BREAKPOINTS.compact, 800);
    expect(layout).toMatchObject({ isCompact: false, isTablet: false, gutter: 16, contentWidth: BREAKPOINTS.compact - 32 });
  });

  it('never returns negative or NaN sizes', () => {
    const layout = computeResponsiveLayout(Number.NaN, -1);
    expect(layout.width).toBe(0);
    expect(layout.height).toBe(0);
    expect(layout.contentWidth).toBe(0);
  });
});
