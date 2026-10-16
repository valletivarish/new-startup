import type { ReactNode } from 'react';

/** Legacy wrapper. The beam and glow are retired: it renders its children as they are. */
export function LiveVoiceSurface({
  children,
}: {
  children: ReactNode;
  /** Ignored. */
  live: boolean;
  /** Ignored. */
  processing?: boolean;
  /** Ignored. */
  level?: number;
}) {
  return <div>{children}</div>;
}
