/**
 * MG Indigo component kit (owner: shell / Foundation) — the shared building blocks every screen
 * group consumes (docs/DESIGN_SYSTEM.md §5). Import from this barrel:
 *
 *   import { Card, MGButton, SectionHeader, ListGroup, ListRow, EmptyState, ErrorState,
 *            LoadingState, Skeleton, Badge, Banner, SheetHandle } from '../../components/ui';
 *
 * Chips stay Paper `Chip` and inputs stay Paper `TextInput mode="outlined"` with
 * `outlineStyle={{ borderRadius: radii.md }}` — both are themed by the MG Paper themes.
 */
export { Badge, type BadgeProps, type BadgeTone } from './Badge';
export { Banner, type BannerAction, type BannerProps, type BannerTone } from './Banner';
export { Card, type CardAccent, type CardProps } from './Card';
export { EmptyState, type EmptyStateAction, type EmptyStateProps } from './EmptyState';
export { ErrorState, type ErrorStateProps } from './ErrorState';
export { ListGroup, type ListGroupProps } from './ListGroup';
export { ListRow, type ListRowIconName, type ListRowProps } from './ListRow';
export { LoadingState, type LoadingStateProps } from './LoadingState';
export { MGButton, type MGButtonProps, type MGButtonSize, type MGButtonVariant } from './MGButton';
export { SectionHeader, type SectionHeaderAction, type SectionHeaderProps } from './SectionHeader';
export { SheetHandle } from './SheetHandle';
export { Skeleton, type SkeletonProps } from './Skeleton';
export { useReducedMotion } from './useReducedMotion';
