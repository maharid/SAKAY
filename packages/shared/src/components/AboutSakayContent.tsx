import React from 'react';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';

import {
  ABOUT_SAKAY_APP_LINE,
  ABOUT_SAKAY_DESCRIPTION,
  ABOUT_SAKAY_DEVELOPERS,
  ABOUT_SAKAY_EMAIL,
} from '../config/aboutSakay';
import type { AboutSakayAudience, AboutSakayLanguage } from '../config/aboutSakay';

export interface AboutSakayContentProps {
  language: AboutSakayLanguage;
  audience: AboutSakayAudience;
  /** The app's own logo (each app has its own Logo component and image set) */
  logo: React.ReactNode;
}

const LABEL = {
  appName: { en: { driver: 'SAKAY Driver app', passenger: 'SAKAY Passenger app' }, tl: { driver: 'SAKAY Driver app', passenger: 'SAKAY Passenger app' } },
  contact: { en: 'Contact', tl: 'Makipag-ugnayan' },
  developers: { en: 'Developed by', tl: 'Binuo nina' },
} as const;

const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <Box sx={{ py: 1.5, borderTop: '1px solid #F1F5F9' }}>
    <Typography component="dt" sx={{ fontSize: '12px', fontWeight: 700, color: '#64748B', mb: 0.25 }}>
      {label}
    </Typography>
    <Typography component="dd" sx={{ m: 0, fontSize: '14px', fontWeight: 600, color: '#0F172A', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
      {children}
    </Typography>
  </Box>
);

/**
 * The body of the About SAKAY page of the Driver and Passenger apps (each app wraps it in its own page header). It reuses the facts the portals already
 * show (config/aboutSakay.ts) and adds nothing else.
 */
export const AboutSakayContent: React.FC<AboutSakayContentProps> = ({ language, audience, logo }) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, pt: 1.5, pb: 0.5 }}>
      {logo}
      <Typography sx={{ fontSize: '13px', fontWeight: 600, color: '#64748B' }}>{LABEL.appName[language][audience]}</Typography>
    </Box>

    <Box sx={{ backgroundColor: '#FFFFFF', border: '1px solid #F1F5F9', borderRadius: '16px', p: 2 }}>
      <Typography sx={{ fontSize: '14px', color: '#334155', lineHeight: 1.6 }}>{ABOUT_SAKAY_DESCRIPTION[language]}</Typography>
      <Typography sx={{ fontSize: '14px', color: '#334155', lineHeight: 1.6, mt: 1 }}>{ABOUT_SAKAY_APP_LINE[audience][language]}</Typography>
    </Box>

    <Box component="dl" sx={{ m: 0, px: 2, backgroundColor: '#FFFFFF', border: '1px solid #F1F5F9', borderRadius: '16px', '& > div:first-of-type': { borderTop: 'none' } }}>
      <Fact label={LABEL.contact[language]}>
        <Link href={`mailto:${ABOUT_SAKAY_EMAIL}`} underline="hover" sx={{ color: '#C75000', fontWeight: 600 }}>
          {ABOUT_SAKAY_EMAIL}
        </Link>
      </Fact>
      <Fact label={LABEL.developers[language]}>
        {ABOUT_SAKAY_DEVELOPERS.map((name) => (
          <Box component="span" key={name} sx={{ display: 'block' }}>
            {name}
          </Box>
        ))}
      </Fact>
    </Box>
  </Box>
);

export default AboutSakayContent;
