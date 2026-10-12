import React, { useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import { estimatedFareFor, fetchFareQuote, formatPeso } from "@sakay/shared";

import { supabase } from "../../../../services/supabaseClient";
import { changeBookingPickup, describePickupRefusal } from "../../../../services/dispatchService";
import {
  getCurrentDevicePosition,
  getOSRMRoute,
  reverseGeocodeCoordinates,
  searchPlaces,
  type PlaceSuggestion,
} from "../../../../services/locationService";
import { isOutsideServiceArea, outsideServiceAreaMessage, type ServiceArea } from "../../../../services/serviceAreaService";
import type { Language } from "../../../../utils/LanguageContext";

interface ChangePickupDialogProps {
  open: boolean;
  language: Language;
  bookingId: string;
  passengers: number;
  tripType: "Solo" | "Shared";
  /** The destination stays where it is: only the pickup can change (Rule 29.9) */
  dropoff: { lat: number; lng: number };
  /** What the booking costs now, to show next to the new figure */
  currentFare: number | null;
  serviceArea: ServiceArea | null;
  onClose: () => void;
  /** The database changed the pickup and started the search again */
  onChanged: (place: { address: string; lat: number; lng: number }) => void;
}

type Place = { address: string; lat: number; lng: number };
type Prep = "idle" | "loading" | "ready" | "error";

const FONT = "Poppins, sans-serif";
const SEARCH_DELAY_MS = 350;

/**
 * Rule 29.9: a passenger who chose the wrong pickup may change it, but ONLY while the search is still running (no driver has accepted). The new place is
 * routed to the destination and the database quotes the fare again; the passenger confirms the figure he sees, the database checks it again, withdraws the
 * offers that are out and starts the search over from the nearest drivers. After a driver accepts, the database refuses (this dialog is not offered then).
 */
const ChangePickupDialog: React.FC<ChangePickupDialogProps> = ({
  open,
  language,
  bookingId,
  passengers,
  tripType,
  dropoff,
  currentFare,
  serviceArea,
  onClose,
  onChanged,
}) => {
  const tl = language === "tl";
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [place, setPlace] = useState<Place | null>(null);
  const [prep, setPrep] = useState<Prep>("idle");
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [newFare, setNewFare] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const requestRef = useRef(0);

  // Start clean every time the dialog opens
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSuggestions([]);
    setPlace(null);
    setPrep("idle");
    setDistanceKm(null);
    setNewFare(null);
    setMessage("");
    setSaving(false);
  }, [open]);

  // Suggestions while the passenger types (the place search service handles recent and curated places too)
  useEffect(() => {
    if (!open || place) return;
    const text = query.trim();
    if (text.length < 2) {
      setSuggestions([]);
      return;
    }
    const mine = ++requestRef.current;
    const timer = setTimeout(() => {
      searchPlaces(text)
        .then((found) => {
          if (requestRef.current === mine) setSuggestions(found.slice(0, 6));
        })
        .catch(() => {
          if (requestRef.current === mine) setSuggestions([]);
        });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, open, place]);

  // The route from the new pickup to the destination, then the database's quote for it
  const prepare = async (chosen: Place) => {
    setPlace(chosen);
    setSuggestions([]);
    setMessage("");
    setNewFare(null);
    setDistanceKm(null);
    if (isOutsideServiceArea(serviceArea, chosen.lat, chosen.lng)) {
      setPrep("error");
      setMessage(outsideServiceAreaMessage(language, "pickup"));
      return;
    }
    setPrep("loading");
    try {
      const route = await getOSRMRoute(chosen.lat, chosen.lng, dropoff.lat, dropoff.lng);
      if (route.source !== "osrm" || !(route.distanceKm > 0)) throw new Error("No OSRM road route");
      const quote = await fetchFareQuote(supabase, route.distanceKm, passengers);
      setDistanceKm(route.distanceKm);
      setNewFare(estimatedFareFor(quote, tripType));
      setPrep("ready");
    } catch {
      setPrep("error");
      setMessage(tl ? "Hindi makuha ang ruta o pamasahe ngayon. Pakisubukang muli." : "We couldn't get the route or the fare right now. Please try again.");
    }
  };

  const useMyLocation = async () => {
    setMessage("");
    try {
      const here = await getCurrentDevicePosition();
      const address = await reverseGeocodeCoordinates(here.latitude, here.longitude);
      await prepare({ address: address || (tl ? "Kasalukuyang Lokasyon" : "Current Location"), lat: here.latitude, lng: here.longitude });
    } catch {
      setMessage(tl ? "Hindi makuha ang iyong lokasyon. Tiyaking naka-on ang Location." : "We couldn't get your location. Make sure Location is turned on.");
    }
  };

  const confirm = async () => {
    if (!place || distanceKm === null || newFare === null || saving) return;
    setSaving(true);
    const outcome = await changeBookingPickup(bookingId, place, distanceKm, newFare);
    setSaving(false);
    if (outcome.ok) {
      onChanged(place);
      onClose();
      return;
    }
    if (outcome.errorCode === "ERR_FARE_MISMATCH" && outcome.expectedFare !== null) {
      setNewFare(outcome.expectedFare);               // the database's figure: the passenger is asked again
    }
    setMessage(describePickupRefusal(outcome.errorCode, language));
  };

  const fareChanged = newFare !== null && currentFare !== null && Math.abs(newFare - currentFare) > 0.001;

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} fullWidth maxWidth="xs" slotProps={{ paper: { sx: { borderRadius: "20px", p: 0.5 } } }}>
      <DialogTitle sx={{ fontWeight: 700, fontSize: "17px", fontFamily: FONT }}>{tl ? "Baguhin ang pickup" : "Change pickup"}</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Typography sx={{ fontSize: "12.5px", color: "#475569", fontFamily: FONT, lineHeight: 1.45 }}>
          {tl
            ? "Maaari mo lang baguhin ang pickup habang naghahanap pa ng drayber. Maghahanap muli mula sa pinakamalapit na drayber at maaaring magbago ang pamasahe."
            : "You can change the pickup only while we are still finding a driver. The search starts again from the nearest drivers, and the fare may change."}
        </Typography>

        {!place && (
          <>
            <TextField
              autoFocus
              size="small"
              label={tl ? "Hanapin ang bagong pickup" : "Search for the new pickup"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              fullWidth
            />
            <Button startIcon={<MyLocationIcon />} onClick={useMyLocation} sx={{ alignSelf: "flex-start", textTransform: "none", fontFamily: FONT, fontWeight: 600, color: "#FF6600" }}>
              {tl ? "Gamitin ang aking lokasyon" : "Use my current location"}
            </Button>
            <List dense disablePadding>
              {suggestions.map((s) => (
                <ListItemButton key={s.id} onClick={() => prepare({ address: s.address || s.name, lat: s.lat, lng: s.lng })} sx={{ borderRadius: "10px" }}>
                  <ListItemText primary={s.name} secondary={s.address} slotProps={{ primary: { sx: { fontSize: 14, fontWeight: 600 } }, secondary: { noWrap: true, sx: { fontSize: 12 } } }} />
                </ListItemButton>
              ))}
            </List>
          </>
        )}

        {place && (
          <Box sx={{ p: "10px 12px", borderRadius: "12px", backgroundColor: "#F8FAFC", border: "1px solid #E2E8F0" }}>
            <Typography sx={{ fontSize: "11.5px", color: "#64748B", fontWeight: 600, fontFamily: FONT }}>{tl ? "Bagong pickup" : "New pickup"}</Typography>
            <Typography sx={{ fontSize: "14px", fontWeight: 600, color: "#0F172A", fontFamily: FONT, overflowWrap: "anywhere" }}>{place.address}</Typography>
            {prep === "loading" && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }} role="status">
                <CircularProgress size={16} sx={{ color: "#FF6600" }} />
                <Typography sx={{ fontSize: "12.5px", color: "#475569", fontFamily: FONT }}>{tl ? "Kinukuha ang ruta at pamasahe..." : "Getting the route and the fare..."}</Typography>
              </Box>
            )}
            {prep === "ready" && newFare !== null && (
              <Box sx={{ mt: 1 }}>
                <Typography sx={{ fontSize: "12.5px", color: "#475569", fontFamily: FONT }}>
                  {tl ? "Pamasahe para sa bagong pickup" : "Fare for the new pickup"}: <strong>{formatPeso(newFare)}</strong>
                  {fareChanged && currentFare !== null ? ` (${tl ? "dati" : "was"} ${formatPeso(currentFare)})` : ""}
                </Typography>
                {fareChanged && (
                  <Typography sx={{ fontSize: "12px", color: "#B45309", fontWeight: 600, fontFamily: FONT, mt: 0.5 }}>
                    {tl ? "Nagbago ang pamasahe. Kumpirmahin lamang kung sang-ayon ka." : "The fare changed. Confirm only if you agree with it."}
                  </Typography>
                )}
              </Box>
            )}
            <Button size="small" disabled={saving} onClick={() => { setPlace(null); setPrep("idle"); setMessage(""); }} sx={{ mt: 1, textTransform: "none", fontFamily: FONT, fontWeight: 600 }}>
              {tl ? "Pumili ng iba" : "Choose another place"}
            </Button>
          </Box>
        )}

        {message && (
          <Alert severity="warning" sx={{ borderRadius: "12px", fontFamily: FONT }}>
            {message}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 2, pb: 2, gap: 1 }}>
        <Button onClick={onClose} disabled={saving} sx={{ textTransform: "none", fontFamily: FONT, fontWeight: 600, color: "#334155" }}>
          {tl ? "Huwag na" : "Never mind"}
        </Button>
        <Button
          variant="contained"
          disabled={prep !== "ready" || saving}
          onClick={confirm}
          sx={{ textTransform: "none", fontFamily: FONT, fontWeight: 700, borderRadius: "12px", backgroundColor: "#FF6600", boxShadow: "none", "&:hover": { backgroundColor: "#E65C00", boxShadow: "none" } }}
        >
          {saving ? <CircularProgress size={20} color="inherit" /> : tl ? "Kumpirmahin ang pickup" : "Confirm new pickup"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ChangePickupDialog;
