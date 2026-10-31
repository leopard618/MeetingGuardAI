/**
 * MG Indigo component kit (owner: shell / Foundation) - the shared building blocks every screen
 * group consumes (docs/v1/DESIGN_SYSTEM.md §5). Import from this barrel:
 *
 *   import { Card, MGButton, SectionHeader, ListGroup, ListRow, EmptyState, ErrorState,
 *            LoadingState, Skeleton, Badge, Banner, SheetHandle, GradientSurface, GradientFab,
 *            PressableScale, Reveal } from '../../components/ui';
 *
 * Visual refresh (2026-10-30): gradients only through GradientSurface, press feedback through
 * PressableScale, mount animations through Reveal, extended FABs through GradientFab.
 *
 * Chips stay Paper `Chip` and inputs stay Paper `TextInput mode="outlined"` with
 * `outlineStyle={{ borderRadius: radii.md }}` - both are themed by the MG Paper themes.
 */
export { AuroraBackdrop, type AuroraBackdropProps } from './AuroraBackdrop';
export { Badge, type BadgeProps, type BadgeTone } from './Badge';
export { Banner, type BannerAction, type BannerProps, type BannerTone } from './Banner';
export { Card, type CardAccent, type CardProps, type CardVariant } from './Card';
export { EmptyState, type EmptyStateAction, type EmptyStateProps } from './EmptyState';
export { ErrorState, type ErrorStateProps } from './ErrorState';
export { Glow, type GlowProps } from './Glow';
export { GradientFab, type GradientFabProps } from './GradientFab';
export { GradientSurface, type GradientDirection, type GradientSurfaceProps, type GradientVariant } from './GradientSurface';
export { Icon, type IconName, type IconProps } from './Icon';
export { ListGroup, type ListGroupProps } from './ListGroup';
export { ListRow, type ListRowIconName, type ListRowProps, type ListRowTone } from './ListRow';
export { LoadingState, type LoadingStateProps } from './LoadingState';
export { MGButton, type MGButtonProps, type MGButtonSize, type MGButtonVariant } from './MGButton';
export { PressableScale, type PressableScaleProps } from './PressableScale';
export { Reveal, revealDelay, type RevealProps } from './Reveal';
export { SectionHeader, type SectionHeaderAction, type SectionHeaderProps } from './SectionHeader';
export { SheetHandle } from './SheetHandle';
export { Shimmer, type ShimmerProps } from './Shimmer';
export { Sparkles, type SparklesProps } from './Sparkles';
export { Skeleton, type SkeletonProps } from './Skeleton';
export { useReducedMotion } from './useReducedMotion';
