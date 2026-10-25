import React from 'react';
import { SakayToast as SharedSakayToast } from '@sakay/shared';
import type { SakayToastProps } from '@sakay/shared';

// The one toast of SAKAY (packages/shared/src/components/SakayToast.tsx): this file only says which look of it this app uses.
export type { SakayToastProps };

export const SakayToast: React.FC<SakayToastProps> = (props) => <SharedSakayToast variant="portal" {...props} />;

export default SakayToast;
