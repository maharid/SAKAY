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
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';

import { fetchReportableTrips, submitIncidentReport, type ReportableTrip } from '../../../services/incidentService';
import { useLanguage } from '../../../utils/LanguageContext';
import PageHeader from '../../../common/components/PageHeader';
import { RegisterInput } from '../../../common/components/RegisterInput';
import {
  activateWithKeyboard,
  evidenceFileProblem,
  incidentCategoriesFor,
  incidentCategoryClass,
  INCIDENT_EVIDENCE_MAX_BYTES,
  INCIDENT_EVIDENCE_MAX_FILES, INCIDENT_LOST_ITEM_FILE_DAYS,
  isEmergencyIncident,
} from '@sakay/shared';

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
          border: `1.5px solid ${focused ? '#FF6600' : '#E2E8F0'}`,
          boxShadow: focused ? '0 0 0 3px rgba(255, 102, 0, 0.12)' : 'none',
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
            fontSize: floating ? '12px' : '14px',
            fontWeight: floating ? 700 : 500,
            color: focused ? '#FF6600' : floating ? '#64748B' : '#64748B',
            textTransform: 'none',
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
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
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
        const completed = list.filter((t) => !t.emergencyOnly);
        setSelectedBookingId(fromScreen && list.some((t) => t.bookingId === fromScreen) ? fromScreen : completed.length === 1 ? completed[0].bookingId : '');
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)))
      .finally(() => alive && setTripsLoading(false));
    return () => {
      alive = false;
    };
  }, [navState?.bookingId]);

  // Rule 16.5: a report is about a completed trip; the trip in progress (or one the passenger had to walk away from) is listed only for an emergency incident
  // (an emergency, a safety concern, an accident, or an assault, harassment, threat or crime)
  const visibleTrips = trips.filter((t) => !t.emergencyOnly || isEmergencyIncident(incidentType));
  useEffect(() => {
    setSelectedBookingId((current) => (current && !trips.some((t) => t.bookingId === current && (!t.emergencyOnly || isEmergencyIncident(incidentType))) ? '' : current));
  }, [incidentType, trips]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (picked.length === 0) return;
    const room = INCIDENT_EVIDENCE_MAX_FILES - files.length;
    const accepted: File[] = [];
    let problem: string | null = null;
    for (const file of picked.slice(0, Math.max(0, room))) {
      const why = evidenceFileProblem(file);
      if (why) problem = why;
      else accepted.push(file);
    }
    if (picked.length > room) problem = problem ?? (language === 'tl' ? `Hanggang ${INCIDENT_EVIDENCE_MAX_FILES} larawan lamang.` : `At most ${INCIDENT_EVIDENCE_MAX_FILES} photos.`);
    setError(problem);
    if (accepted.length > 0) {
      setFiles((prev) => [...prev, ...accepted]);
      setPreviews((prev) => [...prev, ...accepted.map((a) => URL.createObjectURL(a))]);
    }
  };

  const handleRemoveFile = (index: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    URL.revokeObjectURL(previews[index]);
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setPreviews((prev) => prev.filter((_, i) => i !== index));
    setError(null);
  };

  // the previews are blob addresses: let them go when the screen does
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p)), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Rule 19.1 and the ones of Batches 9 and 11: the categories that fit a passenger (the emergency and serious ones come first), from the one shared list
  const incidentCategories = incidentCategoriesFor('Passenger').map((c) => ({ value: c.value, labelTl: c.tl, labelEn: c.en }));
  const categoryClass = incidentCategoryClass(incidentType);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim() || !selectedBookingId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitIncidentReport({ bookingId: selectedBookingId, category: incidentType, description, files });
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
          '& > *': { flexShrink: 0 },
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          pb: 'calc(var(--safe-area-bottom) + 90px)',
        }}
      >
        <Typography sx={{ fontSize: '13px', color: '#64748B', fontFamily: 'Poppins, sans-serif', lineHeight: 1.45 }}>
          {language === 'tl'
            ? 'Ang ulat tungkol sa drayber ay unang susuriin ng TODA Administrator ng drayber, at ipapasa sa LGU Administrator kung kailangan. Ang pananakit, panliligalig, pagbabanta o krimen ay diretso sa LGU. Walang strike hangga\'t hindi napapatunayan ang ulat.'
            : 'A report about a driver is reviewed first by that driver\'s TODA Administrator, and goes to the LGU Administrator when needed. Assault, harassment, threats and crime go straight to the LGU. Nobody is struck unless the report is upheld.'}
        </Typography>

        <FloatingSelect
          label={language === 'tl' ? 'Biyaheng Inirereklamo' : 'Trip You Are Reporting'}
          value={selectedBookingId}
          onChange={setSelectedBookingId}
          disabled={tripsLoading || visibleTrips.length === 0}
          options={visibleTrips.map((t) => ({ value: t.bookingId, label: `${t.dateLabel} • ${t.label}${t.state === 'in_progress' ? (language === 'tl' ? ' (kasalukuyan)' : ' (in progress)') : t.state === 'cancelled' ? (language === 'tl' ? ' (nakansela)' : ' (cancelled)') : ''}` }))}
        />
        {!tripsLoading && visibleTrips.length === 0 && (
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
        {categoryClass === 'SERIOUS' && (
          <Alert severity="error" sx={{ borderRadius: '12px', fontSize: '12px', fontFamily: 'Poppins, sans-serif' }}>
            {language === 'tl'
              ? 'Diretso ito sa LGU Administrator para sa agarang pagsusuri (Rule 19.8). Kung nasa agarang panganib ka ngayon, tumawag sa 911 gamit ang telepono mo; kung nasa biyahe ka, gamitin ang "Urgent Safety Report" sa screen ng biyahe.'
              : 'This goes straight to the LGU Administrator for an immediate review (Rule 19.8). If you are in danger now, call 911 with your phone; during a trip, use "Urgent Safety Report" on the trip screen.'}
          </Alert>
        )}
        {categoryClass === 'EMERGENCY' && (
          <Alert severity="warning" sx={{ borderRadius: '12px', fontSize: '12px', fontFamily: 'Poppins, sans-serif' }}>
            {language === 'tl'
              ? 'Ang emergency ay agad na susuriin at walang itatalagang may kasalanan hangga\'t hindi napapatunayan. Maaari itong isumite habang nasa biyahe.'
              : 'An emergency is reviewed as a priority and nobody is assigned fault unless it is established. You can send it during the trip.'}
          </Alert>
        )}
        {categoryClass === 'LOST_ITEM' && (
          <Alert severity="info" sx={{ borderRadius: '12px', fontSize: '12px', fontFamily: 'Poppins, sans-serif' }}>
            {language === 'tl'
              ? `Iulat agad ito (hanggang ${INCIDENT_LOST_ITEM_FILE_DAYS} araw pagkatapos ng biyahe). Ikokonekta ka ng TODA Administrator sa drayber para maibalik ang gamit. Walang strike para sa sinuman.`
              : `Report it right away (within ${INCIDENT_LOST_ITEM_FILE_DAYS} days of the trip). The TODA Administrator will connect you with the driver to return the item. Nobody is struck for a lost item.`}
          </Alert>
        )}
        {/* Rule 18.8: counterfeit money is not decided by the app: the report goes to the TODA Administrator, who refers it to the police when it is needed */}
        {incidentType === 'Counterfeit Currency' && (
          <Alert severity="info" sx={{ borderRadius: '12px', fontSize: '12px', fontFamily: 'Poppins, sans-serif' }}>
            {language === 'tl'
              ? 'Hindi pinapasya ng app ang tungkol sa pekeng pera. Ipapadala ang ulat sa TODA Administrator, na magrerekomenda ng pulisya kung kailangan.'
              : 'The app does not decide about counterfeit money. The report goes to the TODA Administrator, who refers it to the police where appropriate.'}
          </Alert>
        )}

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

        {/* Hidden File Input: up to 3 photos, JPEG / PNG / WebP, 5 MB each (F11.2) */}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          ref={fileInputRef}
          onChange={handleFileChange}
          style={{ display: 'none' }}
          aria-label={language === 'tl' ? 'Mga larawan' : 'Photos'}
        />

        <Paper
          elevation={0}
          sx={{
            p: 2,
            borderRadius: '16px',
            border: files.length > 0 ? '1.5px solid #10B981' : '1.5px dashed #CBD5E1',
            backgroundColor: files.length > 0 ? '#ECFDF5' : '#FFFFFF',
            boxShadow: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 1.25,
          }}
        >
          <Box
            role="button"
            tabIndex={0}
            onKeyDown={activateWithKeyboard}
            onClick={() => files.length < INCIDENT_EVIDENCE_MAX_FILES && fileInputRef.current?.click()}
            sx={{ display: 'flex', alignItems: 'center', gap: 1.5, cursor: files.length < INCIDENT_EVIDENCE_MAX_FILES ? 'pointer' : 'default', opacity: files.length < INCIDENT_EVIDENCE_MAX_FILES ? 1 : 0.6 }}
          >
            {files.length > 0 ? <CheckCircleIcon sx={{ color: '#10B981', fontSize: 24 }} /> : <UploadFileIcon sx={{ color: '#64748B', fontSize: 24 }} />}
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontSize: '13px', fontWeight: 700, color: '#0F172A', fontFamily: 'Poppins, sans-serif' }}>
                {files.length === 0
                  ? (language === 'tl' ? 'Mag-upload ng Larawan o Katibayan' : 'Upload Photo or Evidence')
                  : (language === 'tl' ? `${files.length} sa ${INCIDENT_EVIDENCE_MAX_FILES} larawan` : `${files.length} of ${INCIDENT_EVIDENCE_MAX_FILES} photos`)}
              </Typography>
              <Typography sx={{ fontSize: '12px', color: '#64748B', fontFamily: 'Poppins, sans-serif', mt: 0.25 }}>
                {language === 'tl'
                  ? `Opsyonal. Hanggang ${INCIDENT_EVIDENCE_MAX_FILES} larawan (JPEG, PNG o WebP), ${INCIDENT_EVIDENCE_MAX_BYTES / (1024 * 1024)} MB bawat isa`
                  : `Optional. Up to ${INCIDENT_EVIDENCE_MAX_FILES} photos (JPEG, PNG or WebP), ${INCIDENT_EVIDENCE_MAX_BYTES / (1024 * 1024)} MB each`}
              </Typography>
            </Box>
          </Box>
          {previews.length > 0 && (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {previews.map((src, i) => (
                <Box key={src} sx={{ position: 'relative' }}>
                  <Box component="img" src={src} alt={language === 'tl' ? `Larawan ${i + 1}` : `Photo ${i + 1}`} sx={{ width: 64, height: 64, borderRadius: '10px', objectFit: 'cover', border: '1px solid #A7F3D0' }} />
                  <IconButton
                    aria-label={language === 'tl' ? `Alisin ang larawan ${i + 1}` : `Remove photo ${i + 1}`}
                    size="small"
                    onClick={handleRemoveFile(i)}
                    sx={{ position: 'absolute', top: -10, right: -10, width: 28, height: 28, backgroundColor: '#FFFFFF', color: '#EF4444', border: '1px solid #FECACA', '&:hover': { backgroundColor: '#FEF2F2' } }}
                  >
                    <DeleteOutlinedIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Box>
              ))}
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
              '&.Mui-disabled': { backgroundColor: '#F1F5F9', color: '#64748B' },
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
