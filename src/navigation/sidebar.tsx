/**
 * Sidebar state for the Main group: one MobileSidebar instance rendered next to the navigator,
 * opened from any screen header through this context (no state in App, no screen remounts).
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import MobileSidebar from '../components/MobileSidebar';
import { useCurrentRouteName } from './navigationService';

interface SidebarContextValue {
  isOpen: boolean;
  open(): void;
  close(): void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children?: ReactNode }): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const value = useMemo(() => ({ isOpen, open, close }), [isOpen, open, close]);
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarContextValue {
  const value = useContext(SidebarContext);
  if (value === null) throw new Error('useSidebar must be used within SidebarProvider');
  return value;
}

/** The single sidebar of the Main group. */
export function MainSidebar(): ReactElement {
  const { isOpen, close } = useSidebar();
  const currentRouteName = useCurrentRouteName();
  return <MobileSidebar visible={isOpen} onClose={close} currentRouteName={currentRouteName} />;
}
