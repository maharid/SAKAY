import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import MailOutlinedIcon from '@mui/icons-material/MailOutlined';
import { useNavigate } from 'react-router-dom';

import { FONT, SPACE } from '../styles/density';
import { PAGE_TEXT, pageCardSx, secondaryButtonSx } from '../styles/pageTheme';
import { SUPPORT_EMAIL } from '../utils/appInfo';
import { mailtoLink, openMailDraft } from '../utils/mailto';

interface GuideSection {
  title: string;
  /** the sidebar entry this is about, so the administrator can open it */
  path?: string;
  items: string[];
}

// The guide for the LGU Administrator, by the sections of the sidebar. It describes what each page is for and the rules the system enforces on it; the rules are the system's (the
// database refuses what is not allowed), so this page never promises anything the portal does not do. It replaces the "under construction" page the Help center used to open.
const SECTIONS: GuideSection[] = [
  {
    title: 'Start with the Dashboard',
    path: '/dashboard',
    items: [
      'The Dashboard shows what needs you now: applications waiting, drivers waiting for verification, open incident reports and appeals. Each card opens the page where it is handled.',
      'Every decision you take in this portal is written to the Audit Logs with your name, the time and your reason. Nothing is decided silently.',
    ],
  },
  {
    title: 'TODA Applications',
    path: '/toda-applications',
    items: [
      'Open the application and read each document (Barangay Clearance, driver roster, bylaws) with View. The roster file is kept exactly as the TODA submitted it; the Master Roster is the living list.',
      'Approve (you enter the certificate number and the date the clearance is valid until), Return for correction (the TODA reads your reason and sends a corrected file), or Decline (give your reason; the TODA reads it).',
    ],
  },
  {
    title: 'Accredited TODAs',
    path: '/accredited-todas',
    items: [
      'View a TODA to see its terminal on the map, its Master Roster summary (members at accreditation and now), its documents and its drivers.',
      'A TODA asks to move its terminal with a pin on the map and a reason. The current terminal stays in force until you approve; approving or rejecting needs your own reason, which the TODA reads.',
      'Record renewal when the TODA sends a renewed Barangay Clearance. After the validity date passes, its drivers cannot go Online until a renewal is recorded.',
      'Suspend TODA (reason required, end date optional): its drivers go Offline at once, a driver already on a trip finishes it, their unanswered offers move to other drivers, and none of them can go Online or take trips until you press Reinstate TODA or the end date arrives. Suspension is not the end of an accreditation; Decline is.',
    ],
  },
  {
    title: 'Drivers and Passengers',
    path: '/drivers',
    items: [
      'Drivers: review documents one by one; return a document for correction with your reason instead of rejecting the whole application. A verified driver cannot replace an approved document.',
      'Passengers and drivers each carry strikes under the ladder of the policy (warning, administrative review, suspensions, deactivation). A suspension ends by itself on its date; a deactivation for a penalty is lifted only by you. A person can also pause their own account in Settings; that is not a penalty, and it never lifts one.',
    ],
  },
  {
    title: 'Vehicle Substitutions and Passenger Feedback',
    path: '/vehicle-substitutions',
    items: [
      'A driver who needs another tricycle for a few days asks first; the TODA decides, then you. After your approval the passenger sees the new plate, and it reverts by itself.',
      'Passenger Feedback lists ratings and comments about trips so you can follow service quality.',
    ],
  },
  {
    title: 'Live Trips, Incident Reports and Strike Appeals',
    path: '/live-trips',
    items: [
      'Live Trips shows trips as they happen. A trip can be ended for safety by an administrator; the reason is recorded.',
      'Incident Reports and Strike Appeals are decided in your own words: the people involved read them. Serious and emergency reports are classed as such, so they can be told apart from standard ones.',
      'A passenger can no longer cancel once the driver is on the way; a driver cancels with a reason from the list.',
    ],
  },
  {
    title: 'Announcements, Fare Configuration and Service Area',
    path: '/announcements',
    items: [
      'Announcements reach the drivers of the TODAs you choose.',
      'A fare change takes effect at the time you set and affects only bookings confirmed after it; the history keeps every rule.',
      'The Service Area is the boundary inside which trips can start and end. A pin must be inside it, on land and on a road a tricycle can use.',
    ],
  },
  {
    title: 'Reports and Analytics',
    path: '/reports',
    items: [
      'Choose Day, Week, Month or a custom range. Day shows one day hour by hour, Week one week, Month one month, with arrows to move and a comparison with the period before.',
      'Exports: Excel and PDF carry a header (what it covers, when it was made, who exported it), the summary on top, then the table and a footer. CSV is the data only. The figures describe SAKAY bookings only.',
    ],
  },
  {
    title: 'Account, Settings and Audit Logs',
    path: '/audit-logs',
    items: [
      'Account Management holds your own profile and password. Settings holds the portal preferences and this help.',
      'Audit Logs can be filtered and exported; an export is itself recorded with who made it.',
    ],
  },
];

export const HelpSupportPage: React.FC = () => {
  const navigate = useNavigate();

  const writeToSupport = () => {
    openMailDraft(mailtoLink(SUPPORT_EMAIL, 'SAKAY LGU Portal help request', 'Describe what you were doing, what you expected and what happened (a screen name and the time help us most).'));
  };

  return (
    <Box sx={{ maxWidth: 820, display: 'flex', flexDirection: 'column', gap: SPACE.gapLarge }}>
      <Box sx={{ ...pageCardSx, p: '16px 19px' }}>
        <Typography component="h2" sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: PAGE_TEXT.primary, mb: '6px' }}>
          Help for the LGU Administrator
        </Typography>
        <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, lineHeight: 1.6 }}>
          What each page is for and the rules the system applies on it. If something here does not match what you see, or a screen does not do what you expect, write to the SAKAY team and say
          which page and when.
        </Typography>
        <Box sx={{ mt: '12px' }}>
          <Button onClick={writeToSupport} startIcon={<MailOutlinedIcon />} sx={secondaryButtonSx}>
            Write to {SUPPORT_EMAIL}
          </Button>
        </Box>
      </Box>

      {SECTIONS.map((section) => (
        <Box key={section.title} component="section" aria-label={section.title} sx={{ ...pageCardSx, p: '16px 19px' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', mb: '8px' }}>
            <Typography component="h3" sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: PAGE_TEXT.primary }}>
              {section.title}
            </Typography>
            {section.path && (
              <Button onClick={() => navigate(section.path as string)} sx={secondaryButtonSx}>
                Open
              </Button>
            )}
          </Box>
          <Box component="ul" sx={{ m: 0, pl: '20px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {section.items.map((item) => (
              <Typography key={item} component="li" sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary, lineHeight: 1.6 }}>
                {item}
              </Typography>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
};

export default HelpSupportPage;
