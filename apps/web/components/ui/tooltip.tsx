'use client';

import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from './cn';

const DELAY_MS = 300;

// True inside a TooltipProvider, so each Tooltip stops carrying a provider of its own.
const Shared = React.createContext(false);

/**
 * Optional. Wrap a toolbar or the sidebar rail: once one tooltip is open, moving to the next
 * opens it at once, without the delay or the fade. Tooltips outside a provider work on their own.
 */
function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={DELAY_MS}>
      <Shared.Provider value>{children}</Shared.Provider>
    </TooltipPrimitive.Provider>
  );
}

export interface TooltipProps {
  /** What the tooltip says. Supplementary only: never the sole name of a control. */
  content: React.ReactNode;
  /** One focusable element (a button or link). */
  children: React.ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  className?: string;
}

/** Dark pill. Shows on hover and keyboard focus. No app-level setup needed. */
function Tooltip({ content, children, side = 'top', align = 'center', className }: TooltipProps) {
  const shared = React.useContext(Shared);
  const tip = (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={8}
          className={cn(
            // Fades in after the delay; an instant-open (moving between tooltips) skips the fade.
            'z-50 max-w-[18rem] rounded-input bg-primary px-2.5 py-1 text-meta font-medium text-primary-foreground data-[state=closed]:animate-fade-out data-[state=delayed-open]:animate-fade-in',
            className,
          )}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
  return shared ? tip : <TooltipPrimitive.Provider delayDuration={DELAY_MS}>{tip}</TooltipPrimitive.Provider>;
}

export { Tooltip, TooltipProvider };
