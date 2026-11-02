/**
 * Floating assistant button of the Main group (owner: shell). Rendered ONCE over the navigator
 * (src/navigation/RootNavigator.tsx), hidden on the chat screen.
 *
 * - A 60dp white disc with the client's headset-chat icon (DASHBOARD_ART.assistantIcon) or, until
 *   that file exists, a robot glyph in primary. A tap opens the AI chat.
 * - The user can put it anywhere: LONG PRESS (LONG_PRESS_MS) starts a drag, the button follows the
 *   finger, and on release it stays where it was dropped (clamped inside the window and the safe
 *   areas). The position is saved per device (AsyncStorage, POSITION_KEY) and restored on launch;
 *   it is re-clamped when the window size changes (rotation, split screen).
 * - Plain accessibility: role button, label "Open the AI assistant", hint "Long press and drag to
 *   move it". While dragging the button does not open the chat.
 * - No animation: the button is static at rest and moves 1:1 with the finger.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Image, PanResponder, StyleSheet, View, useWindowDimensions, type GestureResponderEvent, type PanResponderGestureState } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { createLogger } from '../core/logger';
import { useT } from '../i18n';
import { navigate } from '../navigation/navigationService';
import { DASHBOARD_ART } from '../screens/home/dashboardArt';
import { componentMetrics, floatingShadow, radii, spacing, useAppTheme, withAlpha } from '../theme';

const log = createLogger('assistantFab');

export const POSITION_KEY = 'mg.assistantFab.position';
export const FAB_SIZE = componentMetrics.fabSize + 4;
const ICON_INSET = 8;
/** Hold this long before the button starts following the finger. */
export const LONG_PRESS_MS = 350;
/** Finger travel that cancels a pending long press (the user is scrolling or tapping sloppily). */
const CANCEL_SLOP = 8;
/** Keep this much clear of the window edges and safe areas. */
const MARGIN = componentMetrics.screenGutter;

export interface FabPosition {
  x: number;
  y: number;
}

export interface FabBounds {
  width: number;
  height: number;
  insets: { top: number; bottom: number; left: number; right: number };
}

/** Keeps the button fully inside the window, clear of the safe areas and the edge margin. */
export function clampPosition(position: FabPosition, bounds: FabBounds): FabPosition {
  const minX = bounds.insets.left + MARGIN;
  const maxX = Math.max(minX, bounds.width - bounds.insets.right - MARGIN - FAB_SIZE);
  const minY = bounds.insets.top + MARGIN;
  const maxY = Math.max(minY, bounds.height - bounds.insets.bottom - MARGIN - FAB_SIZE);
  const x = Number.isFinite(position.x) ? Math.min(maxX, Math.max(minX, position.x)) : maxX;
  const y = Number.isFinite(position.y) ? Math.min(maxY, Math.max(minY, position.y)) : maxY;
  return { x, y };
}

/** Bottom-right corner, where the old assistant button lived. */
export function defaultPosition(bounds: FabBounds): FabPosition {
  return clampPosition({ x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY }, bounds);
}

export function parseStoredPosition(raw: string | null): FabPosition | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (value && typeof value === 'object' && typeof (value as FabPosition).x === 'number' && typeof (value as FabPosition).y === 'number') {
      return { x: (value as FabPosition).x, y: (value as FabPosition).y };
    }
  } catch {
    // Corrupt value: fall back to the default position.
  }
  return null;
}

export async function loadStoredPosition(): Promise<FabPosition | null> {
  try {
    return parseStoredPosition(await AsyncStorage.getItem(POSITION_KEY));
  } catch (error: unknown) {
    log.warn('could not read the assistant button position', error);
    return null;
  }
}

function savePosition(position: FabPosition): void {
  AsyncStorage.setItem(POSITION_KEY, JSON.stringify(position)).catch((error: unknown) =>
    log.warn('could not save the assistant button position', error),
  );
}

interface DragController {
  panHandlers: ReturnType<typeof PanResponder.create>['panHandlers'];
  /** Stops a pending long press (unmount). */
  cancel(): void;
}

/**
 * The gesture: tap opens the chat; a hold longer than LONG_PRESS_MS starts a drag that moves the
 * button by the finger's travel since the previous move event (functional state updates, so no
 * refs are read during render). Recreated when the window bounds change.
 */
function createDrag(
  bounds: FabBounds,
  setPosition: (update: (current: FabPosition | null) => FabPosition | null) => void,
  setDragging: (value: boolean) => void,
): DragController {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dragging = false;
  let moved = false;
  let lastDx = 0;
  let lastDy = 0;
  let latest: FabPosition | null = null;

  const cancel = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const responder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => !dragging,
    onPanResponderGrant: () => {
      moved = false;
      dragging = false;
      lastDx = 0;
      lastDy = 0;
      latest = null;
      cancel();
      timer = setTimeout(() => {
        timer = null;
        dragging = true;
        setDragging(true);
      }, LONG_PRESS_MS);
    },
    onPanResponderMove: (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
      if (dragging) {
        const stepX = gesture.dx - lastDx;
        const stepY = gesture.dy - lastDy;
        lastDx = gesture.dx;
        lastDy = gesture.dy;
        setPosition((current) => {
          if (!current) return current;
          latest = clampPosition({ x: current.x + stepX, y: current.y + stepY }, bounds);
          return latest;
        });
        return;
      }
      lastDx = gesture.dx;
      lastDy = gesture.dy;
      if (Math.abs(gesture.dx) > CANCEL_SLOP || Math.abs(gesture.dy) > CANCEL_SLOP) {
        moved = true;
        cancel();
      }
    },
    onPanResponderRelease: () => {
      cancel();
      if (dragging) {
        dragging = false;
        setDragging(false);
        if (latest) savePosition(latest);
        return;
      }
      if (!moved) navigate('AIChat');
    },
    onPanResponderTerminate: () => {
      cancel();
      if (dragging) {
        dragging = false;
        setDragging(false);
      }
    },
  });

  return { panHandlers: responder.panHandlers, cancel };
}

export interface AssistantFabProps {
  /** True on the chat screen (nothing to open there). */
  hidden?: boolean;
  testID?: string;
}

export function AssistantFab({ hidden = false, testID = 'assistant-fab' }: AssistantFabProps): ReactElement | null {
  const t = useT();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const bounds = useMemo<FabBounds>(() => ({ width, height, insets }), [width, height, insets]);
  const [position, setPosition] = useState<FabPosition | null>(null);
  const [dragging, setDragging] = useState(false);

  // Restore the saved spot (or start bottom-right). The window bounds of the first render are
  // enough: the position is clamped again on every render below.
  useEffect(() => {
    let active = true;
    loadStoredPosition().then((stored) => {
      if (active) setPosition(stored ?? defaultPosition(bounds));
    });
    return () => {
      active = false;
    };
    // Mount-only: later bounds changes are handled by the render-time clamp.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const drag = useMemo(() => createDrag(bounds, setPosition, setDragging), [bounds]);
  useEffect(() => () => drag.cancel(), [drag]);

  if (hidden || !position) return null;
  const shown = clampPosition(position, bounds);

  return (
    <View
      {...drag.panHandlers}
      style={[
        styles.fab,
        { left: shown.x, top: shown.y, backgroundColor: '#FFFFFF', borderColor: withAlpha(colors.primary, 0.25) },
        dragging && styles.dragging,
      ]}
      accessible
      accessibilityRole="button"
      accessibilityLabel={t('shell:header.assistant')}
      accessibilityHint={t('shell:header.assistantHint')}
      accessibilityState={{ busy: dragging || undefined }}
      testID={testID}
    >
      {DASHBOARD_ART.assistantIcon ? (
        <Image source={DASHBOARD_ART.assistantIcon} style={styles.icon} resizeMode="contain" accessibilityIgnoresInvertColors />
      ) : (
        <MaterialCommunityIcons name="robot-outline" size={componentMetrics.iconNav + 6} color={colors.primary} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: radii.full,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    ...floatingShadow,
    zIndex: 10,
    elevation: 8,
  },
  icon: {
    width: FAB_SIZE - ICON_INSET * 2,
    height: FAB_SIZE - ICON_INSET * 2,
  },
  dragging: {
    opacity: 0.85,
  },
});

/** Spacing kept for the list screens that place their own FAB above this one. */
export const ASSISTANT_FAB_CLEARANCE = FAB_SIZE + spacing.lg;
