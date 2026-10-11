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
import { activateWithKeyboard, useInFlight } from '@sakay/shared';

/** What a driver can report about a trip. These are the labels the TODA and LGU already review (the passenger's list, the ones that apply to a driver). */
const CATEGORIES = [
  { value: 'Passenger Misconduct', tl: 'Hindi Angkop na Asal ng Pasahero', en: 'Passenger Misconduct' },
  { value: 'Rude Behavior', tl: 'Bastos o Hindi Magalang na Pag-uugali', en: 'Rude Behavior' },
  { value: 'Lost Item', tl: 'Naiwang Gamit sa Tricycle', en: 'Lost Item in Tricycle' },
  { value: 'Others', tl: 'Iba Pang Reklamo', en: 'Other Issues' },
];

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
  const [category, setCategory] = useState(CATEGORIES[0].value);
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
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
        setBookingId(fromScreen && list.some((t) => t.bookingId === fromScreen) ? fromScreen : list.length === 1 ? list[0].bookingId : '');
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)))
      .finally(() => alive && setTripsLoading(false));
    return () => {
      alive = false;
    };
  }, [navState?.bookingId]);

  const canSubmit = Boolean(bookingId) && description.trim().length > 0 && !flight.busy && !submitted;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    flight.run(async () => {
      setError(null);
      try {
        await submitIncidentReport({ bookingId, category, description, file });
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
            ? 'Ipinapadala ang ulat sa TODA at sa LGU para suriin. Para sa biyaheng minaneho mo lamang ito.'
            : 'The report goes to your TODA and the LGU for review. You can report only a trip you drove.'}
        </Typography>

        <TextField
          select
          fullWidth
          label={tl ? 'Biyaheng iuulat' : 'Trip to report'}
          value={bookingId}
          onChange={(e) => setBookingId(e.target.value)}
          disabled={tripsLoading || trips.length === 0}
          sx={fieldSx}
        >
          {trips.map((t) => (
            <MenuItem key={t.bookingId} value={t.bookingId} sx={{ fontSize: '13px', fontFamily: FONT, whiteSpace: 'normal' }}>
              {t.dateLabel} • {t.label}
            </MenuItem>
          ))}
        </TextField>
        {!tripsLoading && trips.length === 0 && (
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
          accept="image/*"
          ref={fileInput}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          style={{ display: 'none' }}
          aria-label={tl ? 'Larawan' : 'Photo'}
        />
        <Paper
          elevation={0}
          role="button"
          tabIndex={0}
          onKeyDown={activateWithKeyboard}
          onClick={() => fileInput.current?.click()}
          sx={{
            p: 1.75,
            borderRadius: '16px',
            border: file ? '1.5px solid #10B981' : '1.5px dashed #CBD5E1',
            backgroundColor: file ? '#ECFDF5' : '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            cursor: 'pointer',
          }}
        >
          {file ? <CheckCircleIcon sx={{ color: '#10B981' }} /> : <UploadFileIcon sx={{ color: '#64748B' }} />}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography noWrap sx={{ fontSize: '13px', fontWeight: 700, color: '#0F172A', fontFamily: FONT }}>
              {file ? file.name : tl ? 'Magdagdag ng larawan (opsyonal)' : 'Add a photo (optional)'}
            </Typography>
            <Typography sx={{ fontSize: '12px', color: '#475569', fontFamily: FONT }}>
              {tl ? 'Isang larawan, hanggang 5 MB' : 'One photo, up to 5 MB'}
            </Typography>
          </Box>
          {file && (
            <IconButton
              aria-label={tl ? 'Alisin ang larawan' : 'Remove the photo'}
              onClick={(e) => {
                e.stopPropagation();
                setFile(null);
                if (fileInput.current) fileInput.current.value = '';
              }}
              sx={{ color: '#B91C1C', width: 44, height: 44 }}
            >
              <DeleteOutlinedIcon />
            </IconButton>
          )}
        </Paper>

        {error && (
          <Alert severity="error" sx={{ borderRadius: '12px', fontSize: '12px', fontFamily: FONT }}>
            {error}
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
