/**
 * MG Indigo component kit (owner: shell / Foundation) - the shared building blocks every screen
 * group consumes (docs/v1/DESIGN_SYSTEM.md §5). Import from this barrel:
 *
 *   import { Card, MGButton, SectionHeader, ListGroup, ListRow, EmptyState, ErrorState,
 *            LoadingState, Skeleton, Badge, Banner, SheetHandle, GradientSurface, GradientFab,
 *            PressableScale, Reveal } from '../../components/ui';
 *
 * Flat style (2026-11-01): no gradients, no decorative light, no motion. GradientSurface is a
 * solid primary block, PressableScale a plain pressed dim, Reveal a plain View (names kept so
 * callers did not change); extended FABs through GradientFab.
 *
 * Chips stay Paper `Chip` and inputs stay Paper `TextInput mode="outlined"` with
 * `outlineStyle={{ borderRadius: radii.md }}` - both are themed by the MG Paper themes.
 */
export { Badge, type BadgeProps, type BadgeTone } from './Badge';
export { Banner, type BannerAction, type BannerProps, type BannerTone } from './Banner';
export { Card, type CardAccent, type CardProps, type CardVariant } from './Card';
export { EmptyState, type EmptyStateAction, type EmptyStateProps } from './EmptyState';
export { ErrorState, type ErrorStateProps } from './ErrorState';
export { GradientFab, type GradientFabProps } from './GradientFab';
export { GradientSurface, type GradientDirection, type GradientSurfaceProps, type GradientVariant } from './GradientSurface';
export { Icon, type IconName, type IconProps } from './Icon';
export { ListGroup, type ListGroupProps } from './ListGroup';
export { ListRow, type ListRowIconName, type ListRowProps, type ListRowTone } from './ListRow';
export { LoadingState, type LoadingStateProps } from './LoadingState';
export { MGButton, type MGButtonProps, type MGButtonSize, type MGButtonVariant } from './MGButton';
export { MiniBars, barHeight, MIN_FRACTION, type MiniBar, type MiniBarsProps } from './MiniBars';
export { PressableScale, type PressableScaleProps } from './PressableScale';
export { Reveal, type RevealProps } from './Reveal';
export { SectionHeader, type SectionHeaderAction, type SectionHeaderProps } from './SectionHeader';
export { SheetHandle } from './SheetHandle';
export { Skeleton, type SkeletonProps } from './Skeleton';
export { useReducedMotion } from './useReducedMotion';
