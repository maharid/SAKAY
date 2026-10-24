import React, { useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import { OPS_BORDER, OPS_DIVIDER, OPS_TEXT, opsFocusRing } from '../operations/operationsTheme';
import { FONT } from '../../styles/density';
import type { LegalDocument, LegalSection } from '../../utils/legalContent';

// **words between double stars** are shown in bold
const withBold = (text: string) => text.split('**').map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));

const paragraphSx = { fontSize: FONT.body, color: OPS_TEXT.primary, lineHeight: 1.6 } as const;
const noteSx = { fontSize: FONT.body, color: OPS_TEXT.secondary, lineHeight: 1.6 } as const;

interface ItemsProps {
  items: NonNullable<LegalSection['items']>;
}

// The expandable lines (what SAKAY collects). One is open at a time, like in the Driver App.
const Items: React.FC<ItemsProps> = ({ items }) => {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {items.map((item) => {
        const open = openId === item.id;
        return (
          <Accordion
            key={item.id}
            expanded={open}
            onChange={(_, expanded) => setOpenId(expanded ? item.id : null)}
            disableGutters
            elevation={0}
            square
            sx={{
              border: `1px solid ${open ? 'var(--sakay-orange-border)' : OPS_BORDER}`,
              borderRadius: '8px !important',
              backgroundColor: open ? 'var(--sakay-orange-soft)' : '#FAFAF8',
              '&::before': { display: 'none' },
            }}
          >
            <AccordionSummary
              expandIcon={<ExpandMoreIcon sx={{ fontSize: 18, color: open ? OPS_TEXT.brand : OPS_TEXT.secondary }} />}
              sx={{ minHeight: 40, px: '14px', '& .MuiAccordionSummary-content': { my: '10px' }, '&.Mui-focusVisible': { outline: `2px solid ${OPS_TEXT.brand}`, outlineOffset: '-2px', backgroundColor: 'transparent' } }}
            >
              <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: OPS_TEXT.primary }}>{item.title}</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ px: '14px', pt: 0, pb: '12px' }}>
              <Typography sx={noteSx}>{item.desc}</Typography>
            </AccordionDetails>
          </Accordion>
        );
      })}
    </Box>
  );
};

const Section: React.FC<{ section: LegalSection }> = ({ section }) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
    <Typography component="h4" sx={{ fontSize: FONT.heading, fontWeight: 700, color: OPS_TEXT.primary }}>{section.title}</Typography>
    {section.intro && <Typography sx={paragraphSx}>{withBold(section.intro)}</Typography>}
    {section.items && <Items items={section.items} />}
    {section.bullets && (
      <Box component="ul" sx={{ m: 0, pl: '20px', ...paragraphSx }}>
        {section.bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </Box>
    )}
    {section.table && (
      <TableContainer sx={{ border: `1px solid ${OPS_BORDER}`, borderRadius: '8px' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              {section.table.head.map((cell) => (
                <TableCell key={cell} sx={{ fontSize: FONT.small, fontWeight: 600, color: OPS_TEXT.secondary, backgroundColor: '#FAFAF8' }}>{cell}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {section.table.rows.map((row) => (
              <TableRow key={row.join('|')} sx={{ '&:last-of-type td': { borderBottom: 'none' } }}>
                {row.map((cell, i) => (
                  <TableCell key={`${cell}-${i}`} sx={{ fontSize: FONT.body, color: OPS_TEXT.primary, borderBottom: `1px solid ${OPS_DIVIDER}` }}>{cell}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    )}
    {section.note && <Typography sx={noteSx}>{withBold(section.note)}</Typography>}
  </Box>
);

interface LegalDocumentViewProps {
  document: LegalDocument;
}

// A whole document in a scrollable area of its own. The area can be reached and scrolled with the keyboard (Tab, then the arrow keys or Page Down).
export const LegalDocumentView: React.FC<LegalDocumentViewProps> = ({ document: legal }) => (
  <Box
    role="region"
    aria-label={`${legal.title}, scrollable`}
    tabIndex={0}
    sx={{
      maxWidth: 760,
      maxHeight: 'max(300px, calc(100dvh - 400px))',
      overflowY: 'auto',
      border: `1px solid ${OPS_BORDER}`,
      borderRadius: '8px',
      p: '18px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '18px',
      ...opsFocusRing,
    }}
  >
    <Box>
      <Typography component="h3" sx={{ fontSize: FONT.cardTitle, fontWeight: 700, color: OPS_TEXT.primary }}>{legal.title}</Typography>
      <Typography sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary, mt: '2px' }}>{legal.lastUpdated}</Typography>
    </Box>
    {legal.intro && <Typography sx={paragraphSx}>{legal.intro}</Typography>}
    {legal.sections.map((section) => (
      <Section key={section.title} section={section} />
    ))}
  </Box>
);
