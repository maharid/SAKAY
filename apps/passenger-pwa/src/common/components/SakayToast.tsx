import React from 'react';
import { SakayToast as SharedSakayToast, messageForLanguage } from '@sakay/shared';
import type { SakayToastProps } from '@sakay/shared';

import { useLanguage } from '../../utils/LanguageContext';

// The one toast of SAKAY (packages/shared/src/components/SakayToast.tsx): this file only says which look of it this app uses.
export type { SakayToastProps };

// Every toast of the app passes through here. A message that comes from the server can carry both languages ("Tagalog (English)") or a rule number: the
// passenger reads the selected language only, with no repeated translation in brackets.
export const SakayToast: React.FC<SakayToastProps> = ({ message, ...props }) => {
  const { language } = useLanguage();
  return <SharedSakayToast variant="mobile" {...props} message={message ? messageForLanguage(message, language) : message} />;
};

export default SakayToast;
