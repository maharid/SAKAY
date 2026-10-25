import React from 'react';

import { AppearancePanel } from './AppearancePanel';

// Preferences: what the person can set for themselves. The only one this portal has is how it looks (the accent colour, kept in ThemeContext and saved with the
// administrator's record). There is no language choice: every text of this portal is English only, so a language selector would change nothing.
export const PreferencesPanel: React.FC = () => <AppearancePanel />;
