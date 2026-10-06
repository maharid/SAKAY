import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Button,
  FormControl,
  Select,
  MenuItem,
  Alert,
  IconButton,
} from '@mui/material';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';

import { fetchReportableTrips, submitIncidentReport, type ReportableTrip } from '../../../services/incidentService';
import { useLanguage } from '../../../utils/LanguageContext';
import PageHeader from '../../../common/components/PageHeader';
import { RegisterInput } from '../../../common/components/RegisterInput';

/** The floating-label select used by this form (same look as RegisterInput). */
interface FloatingSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}

const FloatingSelect: React.FC<FloatingSelectProps> = ({ label, value, onChange, options, disabled }) => {
  const [focused, setFocused] = useState(false);
  const floating = focused || Boolean(value);
  return (
    <Box sx={{ width: '100%' }}>
      <Box
        sx={{
          width: '100%',
          minHeight: '62px',
          height: '62px',
          borderRadius: '16px',
          backgroundColor: focused ? '#FFFFFF' : '#F1F3F5',
          border: `1.5px solid ${focused ? '#FF6B00' : '#E2E8F0'}`,
          boxShadow: focused ? '0 0 0 3px rgba(255, 107, 0, 0.12)' : 'none',
          px: 2,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          boxSizing: 'border-box',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <Typography
          sx={{
            position: 'absolute',
            left: '16px',
            top: floating ? '8px' : '50%',
            transform: floating ? 'translateY(0)' : 'translateY(-50%)',
            fontSize: floating ? '9.5px' : '14px',
            fontWeight: floating ? 700 : 500,
            color: focused ? '#FF6B00' : floating ? '#64748B' : '#94A3B8',
            letterSpacing: floating ? '0.5px' : '0px',
            textTransform: floating ? 'uppercase' : 'none',
            pointerEvents: 'none',
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            zIndex: 1,
          }}
        >
          {label}
        </Typography>

        <FormControl fullWidth sx={{ pt: floating ? '16px' : 0 }}>
          <Select
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(String(e.target.value))}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            variant="standard"
            disableUnderline
            IconComponent={(props) => <KeyboardArrowDownIcon {...props} sx={{ color: '#64748B', fontSize: 20 }} />}
            sx={{
              fontSize: '14px',
              fontWeight: 600,
              color: '#0F172A',
              fontFamily: 'Poppins, sans-serif',
              '& .MuiSelect-select': { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
            }}
          >
            {options.map((opt) => (
              <MenuItem key={opt.value} value={opt.value} sx={{ fontSize: '13px', fontFamily: 'Poppins, sans-serif' }}>
                {opt.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>
    </Box>
  );
};

export const IncidentReporting: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();

  const navState = location.state as { from?: string; bookingId?: string } | null;
  const returnPath = navState?.from || '/dashboard';

  const [incidentType, setIncidentType] = useState('Overcharging Attempt');
  const [trips, setTrips] = useState<ReportableTrip[]>([]);
  const [tripsLoading, setTripsLoading] = useState(true);
  const [selectedBookingId, setSelectedBookingId] = useState('');
  const [description, setDescription] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A report is about a completed trip (policy 16.5), so the passenger says which one.
  useEffect(() => {
    let alive = true;
    fetchReportableTrips()
      .then((list) => {
        if (!alive) return;
        setTrips(list);
        const fromScreen = navState?.bookingId;
        setSelectedBookingId(fromScreen && list.some((t) => t.bookingId === fromScreen) ? fromScreen : list.length === 1 ? list[0].bookingId : '');
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)))
      .finally(() => alive && setTripsLoading(false));
    return () => {
      alive = false;
    };
  }, [navState?.bookingId]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setFilePreview(URL.createObjectURL(file));
    }
  };

  const handleRemoveFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedFile(null);
    setFilePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

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
    if (!description.trim() || !selectedBookingId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitIncidentReport({ bookingId: selectedBookingId, category: incidentType, description, file: selectedFile });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    setSubmitted(true);
    setTimeout(() => {
      setSubmitted(false);
      navigate('/track-reports');
    }, 1500);
  };

  return (
    <Box sx={{ width: '100%', height: '100%', backgroundColor: '#FAFAFA', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <PageHeader
        title={language === 'tl' ? 'Pag-uulat ng Insidente' : 'Incident Report'}
        onBack={() => navigate(returnPath)}
      />

      <Box
        component="form"
        onSubmit={handleSubmit}
        className="hide-scrollbar"
        sx={{
          p: 2.5,
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          pb: 'calc(var(--safe-area-bottom) + 90px)',
        }}
      >
        <Typography sx={{ fontSize: '12.5px', color: '#64748B', fontFamily: 'Poppins, sans-serif', lineHeight: 1.45 }}>
          {language === 'tl'
            ? 'Direktang ipinapadala ang ulat na ito sa LGU Transport Board at TODA Grievance Committee para sa kaukulang imbestigasyon.'
            : 'This report is forwarded directly to the LGU Transport Board and TODA Grievance Committee for official investigation.'}
        </Typography>

        <FloatingSelect
          label={language === 'tl' ? 'Biyaheng Inirereklamo' : 'Trip You Are Reporting'}
          value={selectedBookingId}
          onChange={setSelectedBookingId}
          disabled={tripsLoading || trips.length === 0}
          options={trips.map((t) => ({ value: t.bookingId, label: `${t.dateLabel} • ${t.label}` }))}
        />
        {!tripsLoading && trips.length === 0 && (
          <Alert severity="info" sx={{ borderRadius: '12px', fontSize: '12px', fontFamily: 'Poppins, sans-serif' }}>
            {language === 'tl'
              ? 'Makakapag-ulat ka lamang tungkol sa biyaheng natapos na. Wala ka pang natapos na biyahe.'
              : 'You can report only a completed trip. You have no completed trip yet.'}
          </Alert>
        )}

        <FloatingSelect
          label={language === 'tl' ? 'Uri ng Insidente' : 'Incident Category'}
          value={incidentType}
          onChange={setIncidentType}
          options={incidentCategories.map((cat) => ({ value: cat.value, label: language === 'tl' ? cat.labelTl : cat.labelEn }))}
        />

        {/* Detailed Narrative Input */}
        <RegisterInput
          label={language === 'tl' ? 'Detalyadong Salaysay ng Pangyayari' : 'Detailed Narrative of Incident'}
          value={description}
          onChange={(val) => setDescription(val)}
          multiline
          rows={3}
          required
          placeholder={
            language === 'tl'
              ? 'Pakilahad ang eksaktong oras, lugar, at buong detalye ng insidente...'
              : 'Please describe the exact time, location, and full details of the incident...'
          }
        />

        {/* Hidden File Input */}
        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />

        {/* Flat Photo Evidence Upload Card (No Shadow, No Optional, No Browse Pill) */}
        <Paper
          elevation={0}
          onClick={() => fileInputRef.current?.click()}
          sx={{
            p: 2,
            borderRadius: '16px',
            border: selectedFile ? '1.5px solid #10B981' : '1.5px dashed #CBD5E1',
            backgroundColor: selectedFile ? '#ECFDF5' : '#FFFFFF',
            boxShadow: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            '&:hover': { backgroundColor: selectedFile ? '#ECFDF5' : '#F8FAFC' },
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, flex: 1 }}>
            {filePreview ? (
              <Box
                component="img"
                src={filePreview}
                alt="Attachment preview"
                sx={{ width: 44, height: 44, borderRadius: '10px', objectFit: 'cover', border: '1px solid #A7F3D0' }}
              />
            ) : selectedFile ? (
              <CheckCircleIcon sx={{ color: '#10B981', fontSize: 24 }} />
            ) : (
              <UploadFileIcon sx={{ color: '#64748B', fontSize: 24 }} />
            )}

            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontSize: '13px', fontWeight: 700, color: '#0F172A', fontFamily: 'Poppins, sans-serif', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {selectedFile
                  ? selectedFile.name
                  : (language === 'tl' ? 'Mag-upload ng Larawan o Katibayan' : 'Upload Photo or Evidence')}
              </Typography>
              <Typography sx={{ fontSize: '11px', color: '#64748B', fontFamily: 'Poppins, sans-serif', mt: 0.25 }}>
                {selectedFile
                  ? (language === 'tl' ? 'Nai-attach na ang larawan' : 'Photo attached successfully')
                  : (language === 'tl' ? 'Screenshot, resibo, o litrato ng tricycle' : 'Screenshot, receipt, or photo of tricycle')}
              </Typography>
            </Box>
          </Box>

          {selectedFile && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <IconButton size="small" onClick={() => fileInputRef.current?.click()} sx={{ color: '#FF6B00' }}>
                <RefreshIcon sx={{ fontSize: 18 }} />
              </IconButton>
              <IconButton size="small" onClick={handleRemoveFile} sx={{ color: '#EF4444' }}>
                <DeleteOutlinedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>
          )}
        </Paper>
        {error && (
          <Alert severity="error" sx={{ borderRadius: '12px', fontSize: '12px', fontFamily: 'Poppins, sans-serif' }}>
            {error}
          </Alert>
        )}
      </Box>

      {/* Bottom Fixed Action Button Bar */}
      <Paper
        elevation={0}
        sx={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          p: 2,
          pb: 'calc(var(--safe-area-bottom) + 16px)',
          backgroundColor: '#FFFFFF',
          borderTop: '1px solid #F1F5F9',
          boxShadow: 'none',
          zIndex: 10,
        }}
      >
        {submitted ? (
          <Alert severity="success" sx={{ borderRadius: '12px', fontSize: '12px', fontFamily: 'Poppins, sans-serif' }}>
            {language === 'tl'
              ? 'Matagumpay na naisumite ang iyong ulat. Susuriin ito ng TODA at LGU.'
              : 'Your report has been submitted. The TODA and the LGU will review it.'}
          </Alert>
        ) : (
          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={!description.trim() || !selectedBookingId || submitting}
            startIcon={<ReportProblemIcon />}
            sx={{
              height: 46,
              borderRadius: '14px',
              backgroundColor: '#DC2626',
              fontWeight: 700,
              fontSize: '14px',
              fontFamily: 'Poppins, sans-serif',
              textTransform: 'none',
              boxShadow: 'none',
              '&:hover': { backgroundColor: '#B91C1C', boxShadow: 'none' },
              '&.Mui-disabled': { backgroundColor: '#F1F5F9', color: '#94A3B8' },
            }}
          >
            {submitting ? (language === 'tl' ? 'Isinusumite...' : 'Submitting...') : language === 'tl' ? 'Isumite ang Reklamo' : 'Submit Report'}
          </Button>
        )}
      </Paper>
    </Box>
  );
};

export default IncidentReporting;
