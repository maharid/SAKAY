import React from 'react';
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';
import RuleOutlinedIcon from '@mui/icons-material/RuleOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import EventOutlinedIcon from '@mui/icons-material/EventOutlined';
import HealthAndSafetyOutlinedIcon from '@mui/icons-material/HealthAndSafetyOutlined';
import BlockOutlinedIcon from '@mui/icons-material/BlockOutlined';
import ThunderstormOutlinedIcon from '@mui/icons-material/ThunderstormOutlined';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import BuildCircleOutlinedIcon from '@mui/icons-material/BuildCircleOutlined';

import { asAnnouncementEventType, type AnnouncementEventType } from '../utils/announcementEventTypes';

const ICONS: Record<AnnouncementEventType, React.ElementType> = {
  General: CampaignOutlinedIcon,
  'Terminal Rules': RuleOutlinedIcon,
  'Document Renewal': DescriptionOutlinedIcon,
  'Meeting Notice': EventOutlinedIcon,
  'Safety Advisory': HealthAndSafetyOutlinedIcon,
  'Road Closure': BlockOutlinedIcon,
  Weather: ThunderstormOutlinedIcon,
  Emergency: ReportProblemOutlinedIcon,
  'Fare Update': PaymentsOutlinedIcon,
  'Service Notice': BuildCircleOutlinedIcon,
};

export interface AnnouncementEventIconProps {
  /** The announcement's event type (anything unknown is drawn as a general announcement) */
  type: unknown;
  sx?: Record<string, unknown>;
  fontSize?: number;
}

/** The icon of an announcement: it follows its event type, so choosing another type in the form changes the icon at once, and the same icon is shown wherever the announcement appears. */
export const AnnouncementEventIcon: React.FC<AnnouncementEventIconProps> = ({ type, sx, fontSize = 20 }) => {
  const Icon = ICONS[asAnnouncementEventType(type)];
  return <Icon aria-hidden sx={{ fontSize, ...sx }} />;
};
