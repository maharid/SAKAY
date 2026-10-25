import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Alert, Box, Button, IconButton, MenuItem, Paper, TextField, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import UploadFileIcon from '@mui/icons-material/UploadFile';

import PageHeader from '../../../common/components/PageHeader';
import { useLanguage } from '../../../utils/LanguageContext';
import { fetchReportableTrips, submitIncidentReport, type ReportableTrip } from '../../../services/incidentService';
import {
  activateWithKeyboard,
  evidenceFileProblem,
  incidentCategoriesFor,
  incidentCategoryClass,
  INCIDENT_EVIDENCE_MAX_BYTES,
  INCIDENT_EVIDENCE_MAX_FILES,
  INCIDENT_LOST_ITEM_FILE_DAYS,
  isEmergencyIncident,
  useInFlight,
  messageForLanguage,
} from '@sakay/shared';

/** What a driver can report about a trip: the categories that fit a driver, from the one shared list (Rule 19.1; the emergency and serious ones come first) */
const CATEGORIES = incidentCategoriesFor('Driver');

const FONT = 'Poppins, sans-serif';
const fieldSx = { '& .MuiOutlinedInput-root': { borderRadius: '14px', backgroundColor: '#FFFFFF', fontFamily: FONT, fontSize: '14px' } };

/**
 * The driver's incident report: pick the completed trip, say what happened, optionally add a photo. It is filed through the same table the
 * passenger uses; the database knows from the signed-in user that this is a driver's report and who it concerns, and refuses a trip the
 * driver did not drive. The driver is told it was filed only once the database has accepted it.
 */
export const DriverIncidentReporting: React.FC = () => {
  const { language } = useLanguage();
  const tl = language === 'tl';
  const navigate = useNavigate();
  const location = useLocation();
  const navState = location.state as { from?: string; bookingId?: string } | null;
  const returnPath = navState?.from || '/driver/support';

  const [trips, setTrips] = useState<ReportableTrip[]>([]);
  const [tripsLoading, setTripsLoading] = useState(true);
  const [bookingId, setBookingId] = useState('');
  const [category, setCategory] = useState('Passenger Misconduct');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const flight = useInFlight();
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let alive = true;
    fetchReportableTrips()
      .then((list) => {
        if (!alive) return;
        setTrips(list);
        const fromScreen = navState?.bookingId;
        const completed = list.filter((t) => !t.emergencyOnly);
        setBookingId(fromScreen && list.some((t) => t.bookingId === fromScreen) ? fromScreen : completed.length === 1 ? completed[0].bookingId : '');
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)))
      .finally(() => alive && setTripsLoading(false));
    return () => {
      alive = false;
    };
  }, [navState?.bookingId]);

  // Rule 16.5: a report is about a completed trip; the trip in progress (or one the driver had to give up) is listed only for an emergency incident
  // (an emergency, a safety concern, an accident, or an assault, harassment, threat or crime)
  const visibleTrips = trips.filter((t) => !t.emergencyOnly || isEmergencyIncident(category));
  useEffect(() => {
    setBookingId((current) => (current && !trips.some((t) => t.bookingId === current && (!t.emergencyOnly || isEmergencyIncident(category))) ? '' : current));
  }, [category, trips]);
  const categoryClass = incidentCategoryClass(category);

  const addFiles = (picked: File[]) => {
    if (fileInput.current) fileInput.current.value = '';
    if (picked.length === 0) return;
    const room = Math.max(0, INCIDENT_EVIDENCE_MAX_FILES - files.length);
    const accepted: File[] = [];
    let problem: string | null = picked.length > room ? (tl ? `Hanggang ${INCIDENT_EVIDENCE_MAX_FILES} larawan lamang.` : `At most ${INCIDENT_EVIDENCE_MAX_FILES} photos.`) : null;
    for (const file of picked.slice(0, room)) {
      const why = evidenceFileProblem(file);
      if (why) problem = why;
      else accepted.push(file);
    }
    setError(problem);
    if (accepted.length > 0) {
      setFiles((prev) => [...prev, ...accepted]);
      setPreviews((prev) => [...prev, ...accepted.map((a) => URL.createObjectURL(a))]);
    }
  };
  const removeFile = (index: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    URL.revokeObjectURL(previews[index]);
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setPreviews((prev) => prev.filter((_, i) => i !== index));
    setError(null);
  };
  // the previews are blob addresses: let them go when the screen does
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const canSubmit = Boolean(bookingId) && description.trim().length > 0 && !flight.busy && !submitted;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    flight.run(async () => {
      setError(null);
      try {
        await submitIncidentReport({ bookingId, category, description, files });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
      setSubmitted(true);
      setTimeout(() => navigate(returnPath, { replace: true }), 1800);
    });
  };

  return (
    <Box sx={{ width: '100%', height: '100%', backgroundColor: '#FAFAFA', display: 'flex', flexDirection: 'column' }}>
      <PageHeader title={tl ? 'Pag-uulat ng Insidente' : 'Report an Incident'} onBack={() => navigate(returnPath)} />

      <Box
        component="form"
        onSubmit={handleSubmit}
        className="hide-scrollbar"
        sx={{ flex: 1, overflowY: 'auto', '& > *': { flexShrink: 0 }, p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}
      >
        <Typography sx={{ fontSize: '13px', color: '#475569', fontFamily: FONT, lineHeight: 1.45 }}>
          {tl
            ? 'Unang susuriin ng TODA Administrator mo ang ulat, at ipapasa sa LGU kung kailangan. Ang pananakit, panliligalig, pagbabanta o krimen ay diretso sa LGU. Para sa biyaheng minaneho mo lamang ito.'
            : 'Your TODA Administrator reviews the report first, and it goes to the LGU when needed. Assault, harassment, threats and crime go straight to the LGU. You can report only a trip you drove.'}
        </Typography>

        <TextField
          select
          fullWidth
          label={tl ? 'Biyaheng iuulat' : 'Trip to report'}
          value={bookingId}
          onChange={(e) => setBookingId(e.target.value)}
          disabled={tripsLoading || visibleTrips.length === 0}
          sx={fieldSx}
        >
          {visibleTrips.map((t) => (
            <MenuItem key={t.bookingId} value={t.bookingId} sx={{ fontSize: '13px', fontFamily: FONT, whiteSpace: 'normal' }}>
              {t.dateLabel} • {t.label}
              {t.state === 'in_progress' ? (tl ? ' (kasalukuyan)' : ' (in progress)') : t.state === 'cancelled' ? (tl ? ' (nakansela)' : ' (cancelled)') : ''}
            </MenuItem>
          ))}
        </TextField>
        {!tripsLoading && visibleTrips.length === 0 && (
          <Alert severity="info" sx={{ borderRadius: '12px', fontSize: '12px', fontFamily: FONT }}>
            {tl ? 'Wala ka pang natapos na biyahe na maiuulat.' : 'You have no completed trip to report yet.'}
          </Alert>
        )}

        <TextField select fullWidth label={tl ? 'Uri ng insidente' : 'What happened'} value={category} onChange={(e) => setCategory(e.target.value)} sx={fieldSx}>
          {CATEGORIES.map((c) => (
            <MenuItem key={c.value} value={c.value} sx={{ fontSize: '13px', fontFamily: FONT, whiteSpace: 'normal' }}>
              {tl ? c.tl : c.en}
            </MenuItem>
          ))}
        </TextField>
        {categoryClass === 'SERIOUS' && (
          <Alert severity="error" sx={{ borderRadius: '12px', fontSize: '12px', fontFamily: FONT }}>
            {tl
              ? 'Diretso ito sa LGU Administrator para sa agarang pagsusuri. Kung nasa agarang panganib ka, tumawag sa 911 gamit ang telepono mo.'
              : 'This goes straight to the LGU Administrator for an immediate review. If you are in immediate danger, call 911 with your phone.'}
          </Alert>
        )}
        {categoryClass === 'EMERGENCY' && (
          <Alert severity="warning" sx={{ borderRadius: '12px', fontSize: '12px', fontFamily: FONT }}>
            {tl
              ? 'Agad itong susuriin at walang itatalagang may kasalanan hangga\'t hindi napapatunayan. Maaari itong isumite habang nasa biyahe.'
              : 'It is reviewed as a priority and nobody is assigned fault unless it is established. You can send it during the trip.'}
          </Alert>
        )}
        {categoryClass === 'LOST_ITEM' && (
          <Alert severity="info" sx={{ borderRadius: '12px', fontSize: '12px', fontFamily: FONT }}>
            {tl
              ? `Iulat sa loob ng ${INCIDENT_LOST_ITEM_FILE_DAYS} araw pagkatapos ng biyahe. Ikokonekta ng TODA Administrator ang pasahero at ikaw para maibalik ang gamit. Walang strike para sa sinuman.`
              : `Report it within ${INCIDENT_LOST_ITEM_FILE_DAYS} days of the trip. The TODA Administrator will connect the passenger and you to return the item. Nobody is struck for a lost item.`}
          </Alert>
        )}
        {/* Rule 18.8: counterfeit money is not decided by the app: the report goes to the TODA Administrator, who refers it to the police where it is needed */}
        {category === 'Counterfeit Currency' && (
          <Alert severity="info" sx={{ borderRadius: '12px', fontSize: '12px', fontFamily: FONT }}>
            {tl
              ? 'Hindi pinapasya ng app ang tungkol sa pekeng pera. Ipapadala ang ulat sa TODA Administrator, na magrerekomenda ng pulisya kung kailangan.'
              : 'The app does not decide about counterfeit money. The report goes to the TODA Administrator, who refers it to the police where appropriate.'}
          </Alert>
        )}

        <TextField
          fullWidth
          multiline
          minRows={4}
          required
          label={tl ? 'Ilarawan ang nangyari' : 'Describe what happened'}
          placeholder={tl ? 'Oras, lugar, at mga detalye...' : 'Time, place and details...'}
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, 2000))}
          helperText={`${description.length}/2000`}
          sx={fieldSx}
        />

        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          ref={fileInput}
          onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
          style={{ display: 'none' }}
          aria-label={tl ? 'Mga larawan' : 'Photos'}
        />
        <Paper
          elevation={0}
          sx={{
            p: 1.75,
            borderRadius: '16px',
            border: files.length > 0 ? '1.5px solid #10B981' : '1.5px dashed #CBD5E1',
            backgroundColor: files.length > 0 ? '#ECFDF5' : '#FFFFFF',
            display: 'flex',
            flexDirection: 'column',
            gap: 1.25,
          }}
        >
          <Box
            role="button"
            tabIndex={0}
            onKeyDown={activateWithKeyboard}
            onClick={() => files.length < INCIDENT_EVIDENCE_MAX_FILES && fileInput.current?.click()}
            sx={{ display: 'flex', alignItems: 'center', gap: 1.5, cursor: files.length < INCIDENT_EVIDENCE_MAX_FILES ? 'pointer' : 'default', opacity: files.length < INCIDENT_EVIDENCE_MAX_FILES ? 1 : 0.6 }}
          >
            {files.length > 0 ? <CheckCircleIcon sx={{ color: '#10B981' }} /> : <UploadFileIcon sx={{ color: '#64748B' }} />}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography noWrap sx={{ fontSize: '13px', fontWeight: 700, color: '#0F172A', fontFamily: FONT }}>
                {files.length === 0
                  ? tl ? 'Magdagdag ng larawan (opsyonal)' : 'Add a photo (optional)'
                  : tl ? `${files.length} sa ${INCIDENT_EVIDENCE_MAX_FILES} larawan` : `${files.length} of ${INCIDENT_EVIDENCE_MAX_FILES} photos`}
              </Typography>
              <Typography sx={{ fontSize: '12px', color: '#475569', fontFamily: FONT }}>
                {tl
                  ? `Hanggang ${INCIDENT_EVIDENCE_MAX_FILES} larawan (JPEG, PNG o WebP), ${INCIDENT_EVIDENCE_MAX_BYTES / (1024 * 1024)} MB bawat isa`
                  : `Up to ${INCIDENT_EVIDENCE_MAX_FILES} photos (JPEG, PNG or WebP), ${INCIDENT_EVIDENCE_MAX_BYTES / (1024 * 1024)} MB each`}
              </Typography>
            </Box>
          </Box>
          {previews.length > 0 && (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {previews.map((src, i) => (
                <Box key={src} sx={{ position: 'relative' }}>
                  <Box component="img" src={src} alt={tl ? `Larawan ${i + 1}` : `Photo ${i + 1}`} sx={{ width: 64, height: 64, borderRadius: '10px', objectFit: 'cover', border: '1px solid #A7F3D0' }} />
                  <IconButton
                    aria-label={tl ? `Alisin ang larawan ${i + 1}` : `Remove photo ${i + 1}`}
                    onClick={removeFile(i)}
                    sx={{ position: 'absolute', top: -12, right: -12, color: '#B91C1C', width: 44, height: 44, '& svg': { backgroundColor: '#FFFFFF', borderRadius: '50%', border: '1px solid #FECACA', padding: '3px', fontSize: 28 } }}
                  >
                    <DeleteOutlinedIcon />
                  </IconButton>
                </Box>
              ))}
            </Box>
          )}
        </Paper>

        {error && (
          <Alert severity="error" sx={{ borderRadius: '12px', fontSize: '12px', fontFamily: FONT }}>
            {messageForLanguage(error, language)}
          </Alert>
        )}
        {submitted && (
          <Alert severity="success" sx={{ borderRadius: '12px', fontSize: '12px', fontFamily: FONT }}>
            {tl ? 'Naisumite ang ulat. Susuriin ito ng TODA at LGU.' : 'Report submitted. Your TODA and the LGU will review it.'}
          </Alert>
        )}

        <Button
          type="submit"
          variant="contained"
          fullWidth
          disabled={!canSubmit}
          startIcon={<ReportProblemIcon />}
          sx={{
            minHeight: 50,
            borderRadius: '14px',
            backgroundColor: '#B91C1C',
            color: '#FFFFFF',
            fontWeight: 700,
            fontSize: '15px',
            fontFamily: FONT,
            textTransform: 'none',
            boxShadow: 'none',
            '&:hover': { backgroundColor: '#991B1B', boxShadow: 'none' },
            '&.Mui-disabled': { backgroundColor: '#E2E8F0', color: '#64748B' },
          }}
        >
          {flight.busy ? (tl ? 'Isinusumite...' : 'Submitting...') : tl ? 'Isumite ang Ulat' : 'Submit Report'}
        </Button>
      </Box>
    </Box>
  );
};

export default DriverIncidentReporting;
