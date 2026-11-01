import React, { useEffect, useRef, useState } from 'react';
import { Box, CircularProgress, IconButton, InputAdornment, TextField, Tooltip, Typography } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';
import MapOutlinedIcon from '@mui/icons-material/MapOutlined';
import { searchCalapanPlaces, serviceAreaContains, snapToRoad } from '@sakay/shared';
import type { PlaceResult } from '@sakay/shared';

import { fetchServiceArea } from '../../services/serviceAreaService';
import { FONT } from '../../styles/density';
import { OPS_TEXT } from '../operations/operationsTheme';

interface Pin {
  lat: number;
  lng: number;
}

interface TerminalLocationFieldsProps {
  /** The terminal place as typed */
  location: string;
  onLocationChange: (value: string) => void;
  /** The coordinates of the terminal (null until there are some) */
  pin: Pin | null;
  onPinChange: (pin: Pin) => void;
  /** The place on record: typing something else looks for it on the map */
  recordedLocation: string;
  /** The pin is away from the terminal on record: only then is it judged (the recorded terminal was accepted when it was recorded) */
  moved: boolean;
  /** Whether the pin may be sent: inside Calapan City and on a road */
  onAcceptableChange: (ok: boolean) => void;
  onPickOnMap: () => void;
}

type Check = { status: 'idle' | 'checking' | 'ok' | 'off_road' | 'outside' };

const COORDINATES = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
const asText = (pin: Pin | null): string => (pin ? `${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}` : '');

/**
 * The terminal place and its coordinates, in two fields that follow each other: typing the PLACE looks it up in Calapan City and fills the coordinates; the coordinates can still be
 * typed, or the pin placed on the map, and the place name stays as typed. The pin is judged like every pin of SAKAY (inside the city, on a road); a place found by name that is a
 * few metres off the road is moved onto it, coordinates typed by hand are only judged, never changed.
 */
export const TerminalLocationFields: React.FC<TerminalLocationFieldsProps> = ({ location, onLocationChange, pin, onPinChange, recordedLocation, moved, onAcceptableChange, onPickOnMap }) => {
  const [coordText, setCoordText] = useState(asText(pin));
  const [coordFocused, setCoordFocused] = useState(false);
  const [matches, setMatches] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [noMatch, setNoMatch] = useState(false);
  const [check, setCheck] = useState<Check>({ status: 'idle' });
  // coordinates typed by hand are not replaced by the place that was typed before them
  const handCoordinates = useRef(false);
  // a pin that this component moved onto a road (not a new decision of the person): it is not judged again as a new pin
  const snapped = useRef<string | null>(null);
  const checkSeq = useRef(0);
  const searchSeq = useRef(0);

  // the coordinates field follows the pin (a place found, the map, a snap) unless the person is typing in it
  useEffect(() => {
    if (!coordFocused) setCoordText(asText(pin));
  }, [pin, coordFocused]);

  // typing a place: after a pause, look it up and put the pin on the best match
  useEffect(() => {
    const text = location.trim();
    if (text.length < 3 || text === recordedLocation.trim()) {
      setMatches([]);
      setNoMatch(false);
      setSearching(false);
      return;
    }
    const mine = ++searchSeq.current;
    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchCalapanPlaces(text, controller.signal).then((found) => {
        if (mine !== searchSeq.current) return;
        setSearching(false);
        setMatches(found);
        setNoMatch(found.length === 0);
        if (found.length > 0 && !handCoordinates.current) onPinChange({ lat: found[0].lat, lng: found[0].lng });
      });
    }, 650);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, recordedLocation]);

  // judging the pin: inside the city, on a road
  useEffect(() => {
    if (!moved || !pin) {
      checkSeq.current += 1;
      setCheck({ status: 'idle' });
      onAcceptableChange(true);
      return;
    }
    const key = `${pin.lat.toFixed(6)},${pin.lng.toFixed(6)}`;
    const mine = ++checkSeq.current;
    setCheck({ status: 'checking' });
    onAcceptableChange(false);
    const timer = window.setTimeout(async () => {
      const area = await fetchServiceArea();
      if (mine !== checkSeq.current) return;
      if (area && !serviceAreaContains(area, pin.lat, pin.lng)) {
        setCheck({ status: 'outside' });
        return;
      }
      const found = await snapToRoad(pin.lat, pin.lng);
      if (mine !== checkSeq.current) return;
      if (found.status === 'off_road') {
        setCheck({ status: 'off_road' });
        return;
      }
      // a place found by name (not typed coordinates) a few metres off the road is moved onto it
      if (found.status === 'on_road' && found.distanceM !== null && found.distanceM > 1 && !handCoordinates.current && snapped.current !== key) {
        snapped.current = `${found.lat.toFixed(6)},${found.lng.toFixed(6)}`;
        onPinChange({ lat: found.lat, lng: found.lng });
        return;
      }
      setCheck({ status: 'ok' });
      onAcceptableChange(true);
    }, 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin?.lat, pin?.lng, moved]);

  const typeCoordinates = (value: string) => {
    setCoordText(value);
    const m = COORDINATES.exec(value);
    if (!m) return;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    handCoordinates.current = true;
    onPinChange({ lat, lng });
  };

  const chooseMatch = (p: PlaceResult) => {
    handCoordinates.current = false;
    onLocationChange(`${p.name}${p.detail ? `, ${p.detail.split(',')[0].trim()}` : ''}`);
    onPinChange({ lat: p.lat, lng: p.lng });
    setMatches([]);
  };

  const coordInvalid = coordText.trim() !== '' && !COORDINATES.test(coordText);
  const statusLine =
    check.status === 'checking' ? { icon: <CircularProgress size={13} sx={{ color: OPS_TEXT.secondary }} />, text: 'Checking the place...', tone: OPS_TEXT.secondary }
    : check.status === 'ok' ? { icon: <CheckCircleOutlineIcon sx={{ fontSize: 16 }} />, text: 'On a road in Calapan City', tone: '#166534' }
    : check.status === 'off_road' ? { icon: <ErrorOutlineIcon sx={{ fontSize: 16 }} />, text: 'Not on a road. Change the coordinates or pick the place on the map.', tone: '#991B1B' }
    : check.status === 'outside' ? { icon: <ErrorOutlineIcon sx={{ fontSize: 16 }} />, text: 'Outside Calapan City. A terminal must be inside the city.', tone: '#991B1B' }
    : noMatch && !moved ? { icon: <ErrorOutlineIcon sx={{ fontSize: 16 }} />, text: 'No such place found. Type the coordinates or pick it on the map.', tone: '#92400E' }
    : null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <TextField
        label="Terminal location"
        placeholder="e.g. Calapan Public Market, J.P. Rizal St."
        value={location}
        onChange={(e) => {
          handCoordinates.current = false;
          onLocationChange(e.target.value);
        }}
        fullWidth
        size="small"
        slotProps={{
          input: {
            endAdornment: searching ? (
              <InputAdornment position="end">
                <CircularProgress size={14} sx={{ color: OPS_TEXT.secondary }} />
              </InputAdornment>
            ) : undefined,
          },
        }}
      />

      {matches.length > 1 && (
        <Box role="listbox" aria-label="Places found" sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px', mt: '-4px' }}>
          {matches.slice(0, 4).map((p, i) => (
            <Box
              key={`${p.lat},${p.lng},${i}`}
              role="option"
              aria-selected={pin ? Math.abs(pin.lat - p.lat) < 0.00002 && Math.abs(pin.lng - p.lng) < 0.00002 : false}
              tabIndex={0}
              onClick={() => chooseMatch(p)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  chooseMatch(p);
                }
              }}
              sx={{
                cursor: 'pointer',
                px: '10px',
                py: '3px',
                borderRadius: '999px',
                border: '1px solid',
                borderColor: pin && Math.abs(pin.lat - p.lat) < 0.00002 && Math.abs(pin.lng - p.lng) < 0.00002 ? OPS_TEXT.brand : 'rgba(15, 23, 42, 0.14)',
                backgroundColor: '#FFFFFF',
                fontSize: FONT.small,
                color: OPS_TEXT.primary,
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                '&:hover': { backgroundColor: '#FFF4EA' },
                '&:focus-visible': { outline: `2px solid ${OPS_TEXT.brand}`, outlineOffset: 1 },
              }}
            >
              {p.name}{p.detail ? `, ${p.detail.split(',')[0].trim()}` : ''}
            </Box>
          ))}
        </Box>
      )}

      <TextField
        label="Coordinates"
        placeholder="latitude, longitude"
        value={coordText}
        onChange={(e) => typeCoordinates(e.target.value)}
        onFocus={() => setCoordFocused(true)}
        onBlur={() => setCoordFocused(false)}
        error={coordInvalid}
        helperText={coordInvalid ? 'Type them as: 13.410942, 121.176174' : undefined}
        fullWidth
        size="small"
        slotProps={{
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <Tooltip title="Pick the place on the map" arrow>
                  <IconButton edge="end" size="small" onClick={onPickOnMap} aria-label="Pick the place on the map" sx={{ color: OPS_TEXT.brand }}>
                    <MapOutlinedIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </Tooltip>
              </InputAdornment>
            ),
          },
        }}
      />

      {statusLine && (
        <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: '6px', color: statusLine.tone, mt: '-4px' }}>
          {statusLine.icon}
          <Typography component="span" sx={{ fontSize: FONT.small, fontWeight: 600 }}>{statusLine.text}</Typography>
        </Box>
      )}

      {moved && (
        <Typography sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary }}>
          A new terminal place takes effect only after the LGU approves it.
        </Typography>
      )}
    </Box>
  );
};
