import type { ReactElement, ReactNode } from 'react';

/** The page's frame: one full-height column that holds the current screen. */
export function AppShell({ children }: { children: ReactNode }): ReactElement {
  return <main className="atlas-play-shell">{children}</main>;
}
