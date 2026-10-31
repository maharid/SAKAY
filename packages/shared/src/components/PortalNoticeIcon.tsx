import React from 'react';
import Box from '@mui/material/Box';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import AlarmOnIcon from '@mui/icons-material/AlarmOn';
import ForwardToInboxOutlinedIcon from '@mui/icons-material/ForwardToInboxOutlined';
import AssignmentReturnedOutlinedIcon from '@mui/icons-material/AssignmentReturnedOutlined';
import HowToRegOutlinedIcon from '@mui/icons-material/HowToRegOutlined';
import VerifiedUserOutlinedIcon from '@mui/icons-material/VerifiedUserOutlined';
import GavelOutlinedIcon from '@mui/icons-material/GavelOutlined';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

import { NOTICE_KIND_LABEL, noticeVisualKind, type NoticeVisualKind } from '../utils/portalNoticeRouting';

const LOOK: Record<NoticeVisualKind, { Icon: React.ElementType; bg: string; fg: string }> = {
  incident: { Icon: ReportProblemOutlinedIcon, bg: '#FFF1E6', fg: '#B34700' },
  overdue: { Icon: AlarmOnIcon, bg: '#FEE2E2', fg: '#B91C1C' },
  followup: { Icon: ForwardToInboxOutlinedIcon, bg: '#EDE9FE', fg: '#5B21B6' },
  resubmission: { Icon: AssignmentReturnedOutlinedIcon, bg: '#DBEAFE', fg: '#1D4ED8' },
  driverVerification: { Icon: HowToRegOutlinedIcon, bg: '#DCFCE7', fg: '#166534' },
  accreditation: { Icon: VerifiedUserOutlinedIcon, bg: '#FEF3C7', fg: '#92400E' },
  appeal: { Icon: GavelOutlinedIcon, bg: '#F1F5F9', fg: '#334155' },
  reminder: { Icon: NotificationsActiveOutlinedIcon, bg: '#FEF9C3', fg: '#854D0E' },
  general: { Icon: InfoOutlinedIcon, bg: '#F1F5F9', fg: '#475569' },
};

export interface PortalNoticeIconProps {
  /** The notice's type (INCIDENT_ESCALATED, DRIVER_RESUBMITTED ...); the kind and so the icon follow from it */
  type: string | null | undefined;
  size?: number;
}

/** The icon of a notice in the LGU or the TODA portal: one distinct icon and colour per kind (incident, overdue, follow-up, resubmission, driver verification, accreditation, appeal, reminder). */
export const PortalNoticeIcon: React.FC<PortalNoticeIconProps> = ({ type, size = 34 }) => {
  const kind = noticeVisualKind(type);
  const { Icon, bg, fg } = LOOK[kind];
  return (
    <Box
      role="img"
      aria-label={NOTICE_KIND_LABEL[kind]}
      sx={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: bg, color: fg }}
    >
      <Icon aria-hidden sx={{ fontSize: Math.round(size * 0.52) }} />
    </Box>
  );
};
