'use client';

import * as React from 'react';
import { Button, type ButtonProps } from './button';
import { Tooltip } from './tooltip';

export interface IconButtonProps extends Omit<ButtonProps, 'size' | 'asChild' | 'aria-label' | 'arrow'> {
  /** Required. Becomes the accessible name and the tooltip. */
  label: string;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
  /** md is 40px, sm 36px (row actions). Both grow to 44px under a finger. */
  size?: 'sm' | 'md';
}

/**
 * Square button with 10px corners holding one icon: <IconButton label="Settings"><Settings /></IconButton>.
 * White with a hairline border by default (D2 header); variant="quiet" for row actions.
 */
const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, tooltipSide, variant = 'secondary', size = 'md', type = 'button', ...props }, ref) => (
    <Tooltip content={label} side={tooltipSide}>
      {/* The tooltip only repeats the name, so it doesn't describe the button too: the key,
          even undefined, wins over the aria-describedby the tooltip trigger would add. */}
      <Button
        ref={ref}
        type={type}
        variant={variant}
        size={size === 'sm' ? 'icon-sm' : 'icon'}
        aria-label={label}
        aria-describedby={props['aria-describedby']}
        {...props}
      />
    </Tooltip>
  ),
);
IconButton.displayName = 'IconButton';

export { IconButton };
