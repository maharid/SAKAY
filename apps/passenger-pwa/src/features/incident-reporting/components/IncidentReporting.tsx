import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Tabs,
  Tab,
  Alert,
} from '@mui/material';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

import { supabase } from '../../../services/supabaseClient';
import { useLanguage } from '../../../utils/LanguageContext';
import PageHeader from '../../../common/components/PageHeader';

export interface IncidentReportItem {
  id: string;
  incidentType: string;
  franchiseNo: string;
  description: string;
  status: 'Submitted' | 'Under Investigation (LGU & TODA)' | 'Resolved' | 'Action Taken';
  submittedAt: string;
}

const STORAGE_KEY = 'sakay_passenger_incident_reports';

export const IncidentReporting: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();

  const navState = location.state as { from?: string; franchiseNo?: string; bookingId?: string } | null;
  const returnPath = navState?.from || '/dashboard';

  const [tab, setTab] = useState<0 | 1>(0);
  const [incidentType, setIncidentType] = useState('Overcharging Attempt');
  const [franchiseNo, setFranchiseNo] = useState(navState?.franchiseNo || '');
  const [description, setDescription] = useState(navState?.bookingId ? `Booking ref: ${navState.bookingId}. ` : '');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  // Exact categories matching apps/admin-portal/src/features/incidents/pages/IncidentReportsPage.tsx
  const incidentCategories = [
    { value: 'Overcharging Attempt', labelTl: 'Pagtatangkang Maningil nang Sobra (Overcharging)', labelEn: 'Overcharging Attempt' },
    { value: 'Rude Behavior', labelTl: 'Bastos o Hindi Magalang na Pag-uugali', labelEn: 'Rude Behavior' },
    { value: 'Unsafe Driving', labelTl: 'Mapanganib na Pagmamaneho', labelEn: 'Unsafe Driving' },
    { value: 'Reckless Driving', labelTl: 'Kaskaserong Pagpapatakbo', labelEn: 'Reckless Driving' },
    { value: 'Route Deviation', labelTl: 'Paglihis sa Karaniwang Ruta', labelEn: 'Route Deviation' },
    { value: 'Passenger Misconduct', labelTl: 'Hindi Angkop na Asal ng Pasahero', labelEn: 'Passenger Misconduct' },
    { value: 'Lost Item', labelTl: 'Naiwang Gamit sa Tricycle', labelEn: 'Lost Item in Tricycle' },
    { value: 'Others', labelTl: 'Iba Pang Reklamo', labelEn: 'Other Issues' },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;

    const newReport: IncidentReportItem = {
      id: `INC-2026-${Date.now().toString().slice(-4)}`,
      incidentType,
      franchiseNo: franchiseNo.trim() || 'Unspecified Unit',
      description: description.trim(),
      status: 'Under Investigation (LGU & TODA)',
      submittedAt: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    };

    try {
      await supabase.from('incident_report').insert([
        {
          category: incidentType,
          description: `[Franchise: ${franchiseNo.trim() || 'N/A'}] ${description.trim()}`,
          severity: incidentType.includes('Unsafe') || incidentType.includes('Reckless') ? 'High' : 'Medium',
          status: 'Pending Review',
          created_at: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      console.warn('[IncidentReporting] DB sync note:', err);
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const history = raw ? JSON.parse(raw) : [];
      localStorage.setItem(STORAGE_KEY, JSON.stringify([newReport, ...history]));
    } catch {
      // ignore
    }

    setSubmitted(true);
    setTimeout(() => {
      setSubmitted(false);
      setTab(1); // Switch to tracking tab
    }, 1500);
  };

  const getIncidentReports = (): IncidentReportItem[] => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw
        ? JSON.parse(raw)
        : [
            {
              id: 'INC-2026-9041',
              incidentType: 'Overcharging Attempt',
              franchiseNo: 'CAL-2025-0104',
              description: 'Nanghingi ng sobrang ₱20 lampas sa taripa mula Calapan Port hanggang City Hall.',
              status: 'Under Investigation (LGU & TODA)',
              submittedAt: 'Aug 13, 2026',
            },
          ];
    } catch {
      return [];
    }
  };

  return (
    <Box sx={{ width: '100%', height: '100%', backgroundColor: '#F8FAFC', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <PageHeader
        title={language === 'tl' ? 'Pag-uulat ng Insidente' : 'Incident Report'}
        onBack={() => navigate(returnPath)}
      />

      {/* Tabs */}
      <Box sx={{ backgroundColor: '#FFFFFF', px: 2, borderBottom: '1px solid #E2E8F0' }}>
        <Tabs value={tab} onChange={(_, val) => setTab(val)} textColor="inherit" indicatorColor="primary">
          <Tab label={language === 'tl' ? 'Magsumite ng Ulat' : 'Submit Report'} sx={{ fontWeight: 700, textTransform: 'none' }} />
          <Tab label={language === 'tl' ? 'Subaybayan ang Ulat' : 'Track Reports'} sx={{ fontWeight: 700, textTransform: 'none' }} />
        </Tabs>
      </Box>

      {tab === 0 ? (
        <Box component="form" onSubmit={handleSubmit} className="hide-scrollbar" sx={{ p: 2.5, flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2.5, pb: 'calc(var(--safe-area-bottom) + 90px)' }}>
          <Typography sx={{ fontSize: '13.5px', color: '#64748B', fontFamily: 'Poppins, sans-serif' }}>
            {language === 'tl'
              ? 'Direktang ipinapadala ang ulat na ito sa LGU Transport Board at TODA Grievance Committee para sa kaukulang imbestigasyon.'
              : 'This report is forwarded directly to the LGU Transport Board and TODA Grievance Committee for official investigation.'}
          </Typography>

          {/* Category Dropdown */}
          <FormControl fullWidth>
            <InputLabel>{language === 'tl' ? 'Uri ng Insidente' : 'Incident Category'}</InputLabel>
            <Select
              value={incidentType}
              label={language === 'tl' ? 'Uri ng Insidente' : 'Incident Category'}
              onChange={(e) => setIncidentType(e.target.value)}
              sx={{ borderRadius: '14px', backgroundColor: '#FFFFFF', fontFamily: 'Poppins, sans-serif' }}
            >
              {incidentCategories.map((cat) => (
                <MenuItem key={cat.value} value={cat.value} sx={{ fontFamily: 'Poppins, sans-serif' }}>
                  {language === 'tl' ? cat.labelTl : cat.labelEn}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Franchise / Body Number */}
          <TextField
            fullWidth
            label="Franchise Number / Plate No. / TODA"
            placeholder={language === 'tl' ? 'hal. CAL-2025-0773 o TODA-104' : 'e.g. CAL-2025-0773 or TODA-104'}
            value={franchiseNo}
            onChange={(e) => setFranchiseNo(e.target.value)}
            sx={{ backgroundColor: '#FFFFFF', '& .MuiOutlinedInput-root': { borderRadius: '14px', fontFamily: 'Poppins, sans-serif' } }}
          />

          {/* Written Description */}
          <TextField
            fullWidth
            required
            multiline
            rows={4}
            label={language === 'tl' ? 'Detalyadong Salaysay ng Pangyayari' : 'Detailed Narrative of Incident'}
            placeholder={
              language === 'tl'
                ? 'Pakilahad ang eksaktong oras, lugar, at buong detalye ng insidente...'
                : 'Please describe the exact time, location, and full details of the incident...'
            }
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            sx={{ backgroundColor: '#FFFFFF', '& .MuiOutlinedInput-root': { borderRadius: '14px', fontFamily: 'Poppins, sans-serif' } }}
          />

          {/* Hidden File Input */}
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />

          {/* Photo Evidence Upload Card */}
          <Paper
            onClick={() => fileInputRef.current?.click()}
            sx={{
              p: 2,
              borderRadius: '14px',
              border: selectedFile ? '1px solid #1E8E3E' : '1px dashed #CBD5E1',
              backgroundColor: selectedFile ? '#E6F4EA' : '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              {selectedFile ? <CheckCircleIcon sx={{ color: '#1E8E3E' }} /> : <UploadFileIcon sx={{ color: '#64748B' }} />}
              <Box>
                <Typography sx={{ fontSize: '13.5px', fontWeight: 700, color: '#0F172A', fontFamily: 'Poppins, sans-serif' }}>
                  {selectedFile
                    ? selectedFile.name
                    : (language === 'tl' ? 'Mag-upload ng Larawan / Katibayan (Optional)' : 'Upload Photo / Evidence (Optional)')}
                </Typography>
                <Typography sx={{ fontSize: '11px', color: '#64748B', fontFamily: 'Poppins, sans-serif' }}>
                  {selectedFile
                    ? (language === 'tl' ? 'Nai-attach na ang larawan' : 'Photo attached successfully')
                    : (language === 'tl' ? 'Screenshot, resibo, o litrato ng tricycle' : 'Screenshot, receipt, or photo of tricycle')}
                </Typography>
              </Box>
            </Box>
            <Chip
              label={selectedFile ? (language === 'tl' ? 'Nai-attach' : 'Attached') : (language === 'tl' ? 'Pumili File' : 'Browse File')}
              size="small"
              color={selectedFile ? 'success' : 'default'}
            />
          </Paper>

          {/* Bottom Fixed Action Button Bar */}
          <Paper
            elevation={3}
            sx={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              p: 2,
              pb: 'calc(var(--safe-area-bottom) + 16px)',
              backgroundColor: '#FFFFFF',
              borderTop: '1px solid #E2E8F0',
              zIndex: 10,
            }}
          >
            {submitted ? (
              <Alert severity="success" sx={{ borderRadius: '14px', fontFamily: 'Poppins, sans-serif' }}>
                {language === 'tl'
                  ? 'Matagumpay na naitala ang iyong ulat. May magsasagawang imbestigasyon ang LGU.'
                  : 'Your report has been successfully recorded. The LGU will conduct an investigation.'}
              </Alert>
            ) : (
              <Button
                type="submit"
                variant="contained"
                fullWidth
                startIcon={<ReportProblemIcon />}
                sx={{
                  height: 48,
                  borderRadius: '14px',
                  backgroundColor: '#DC2626',
                  fontWeight: 700,
                  fontSize: '14px',
                  fontFamily: 'Poppins, sans-serif',
                  textTransform: 'none',
                  boxShadow: 'none',
                  '&:hover': { backgroundColor: '#B91C1C', boxShadow: 'none' },
                }}
              >
                {language === 'tl' ? 'Isumite ang Reklamo' : 'Submit Report'}
              </Button>
            )}
          </Paper>
        </Box>
      ) : (
        /* Status Tracker Tab */
        <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {getIncidentReports().map((report) => (
            <Paper key={report.id} elevation={0} sx={{ p: 2.5, borderRadius: '16px', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography sx={{ fontSize: '14px', fontWeight: 800, color: '#0F172A' }}>{report.id}</Typography>
                <Chip
                  label={report.status}
                  size="small"
                  sx={{
                    fontWeight: 700,
                    fontSize: '12px',
                    backgroundColor: report.status === 'Resolved' ? '#E6F4EA' : '#FEF3C7',
                    color: report.status === 'Resolved' ? '#1E8E3E' : '#B45309',
                  }}
                />
              </Box>
              <Typography sx={{ fontSize: '14px', fontWeight: 700, color: '#FF6B00' }}>
                {language === 'tl' ? 'Kategorya' : 'Category'}: {report.incidentType}
              </Typography>
              <Typography sx={{ fontSize: '12px', color: '#64748B' }}>
                {language === 'tl' ? 'Inirereklamong Unit:' : 'Reported Unit:'} <strong>{report.franchiseNo}</strong> • {language === 'tl' ? 'Petsa:' : 'Date:'} {report.submittedAt}
              </Typography>
              <Typography sx={{ fontSize: '14px', color: '#334155', mt: 0.5 }}>
                {report.description}
              </Typography>
            </Paper>
          ))}
        </Box>
      )}
    </Box>
  );
};
