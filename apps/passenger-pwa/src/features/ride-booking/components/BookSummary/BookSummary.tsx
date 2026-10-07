import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import InfoIcon from "@mui/icons-material/Info";
import LocalTaxiIcon from "@mui/icons-material/LocalTaxi";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import RouteIcon from "@mui/icons-material/Route";
import PersonIcon from "@mui/icons-material/Person";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Alert from "@mui/material/Alert";
import GroupsIcon from "@mui/icons-material/Groups";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import { useLanguage } from "../../../../utils/LanguageContext";
import { supabase } from "../../../../services/supabaseClient";
import SuccessModal from "../../../../common/components/SuccessModal";
import SharedFareNotice from "../../../../common/components/SharedFareNotice";
import { createBooking } from "../../../../services/bookingService";
import { getOSRMRoute, saveRecentDestination } from "../../../../services/locationService";
import {
  fetchFareQuote,
  estimatedFareFor,
  parseFareError,
  describeFareError,
  type FareQuote,
} from "@sakay/shared";

interface LocationState {
  address: string;
  lat: number;
  lng: number;
}

const BookSummary: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();

  // Retrieve states from sessionStorage
  const [pickup, setPickup] = useState<LocationState | null>(null);
  const [dropoff, setDropoff] = useState<LocationState | null>(null);
  const [passengers, setPassengers] = useState<number>(1);
  const [tripType, setTripType] = useState<"Solo" | "Shared">("Solo");

  // Route and fare. Rule 6.2: priced from the confirmed OSRM road route (no straight-line guess, decision D5), and
  // the fare itself comes from the database (public.quote_fare); this screen holds no tariff and no formula.
  const [loading, setLoading] = useState<boolean>(true);
  const [distance, setDistance] = useState<number | null>(null);
  const [quote, setQuote] = useState<FareQuote | null>(null);
  const [bookingLoading, setBookingLoading] = useState<boolean>(false);
  const [successOpen, setSuccessOpen] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    const rawPickup = sessionStorage.getItem("trip_pickup");
    const rawDropoff = sessionStorage.getItem("trip_dropoff");
    const rawPassengers = sessionStorage.getItem("trip_passengers");
    const rawType = sessionStorage.getItem("trip_type");

    if (!rawPickup || !rawDropoff) {
      navigate("/new-trip");
      return;
    }

    const p: LocationState = JSON.parse(rawPickup);
    const d: LocationState = JSON.parse(rawDropoff);
    const count = rawPassengers ? parseInt(rawPassengers, 10) : 1;
    const type = (rawType as "Solo" | "Shared") || "Solo";

    setPickup(p);
    setDropoff(d);
    setPassengers(count);
    setTripType(type);

    loadRoute(p, d);
  }, []);

  // Quote the fare for that route and headcount (both trip types come back in one quote).
  useEffect(() => {
    if (distance === null) return;
    let cancelled = false;
    fetchFareQuote(supabase, distance, passengers)
      .then((q) => {
        if (!cancelled) {
          setQuote(q);
          setErrorMessage("");
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setQuote(null);
        const parsed = parseFareError(err instanceof Error ? err.message : "");
        setErrorMessage(
          parsed
            ? describeFareError(parsed, language)
            : language === "tl"
            ? "Hindi makuha ang pamasahe ngayon. Pakisubukang muli."
            : "We could not get the fare right now. Please try again."
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [distance, passengers, language]);

  const loadRoute = async (p: LocationState, d: LocationState) => {
    setLoading(true);
    try {
      const route = await getOSRMRoute(p.lat, p.lng, d.lat, d.lng);
      if (route.source !== "osrm" || !(route.distanceKm > 0)) throw new Error("No OSRM road route");
      setDistance(route.distanceKm);
    } catch {
      setDistance(null);
      setQuote(null);
      setErrorMessage(
        language === "tl"
          ? "Hindi makuha ang ruta sa mapa ngayon. Bumalik at subukang muli."
          : "We couldn't get the road route right now. Please go back and try again."
      );
      setLoading(false);
    }
  };

  const handleToggleTripType = (newType: "Solo" | "Shared") => {
    setTripType(newType);
    if (newType === "Shared" && passengers > 2) {
      setPassengers(2);
      sessionStorage.setItem("trip_passengers", "2");
    }
    sessionStorage.setItem("trip_type", newType);
  };

  const handleChangePassengers = (delta: number) => {
    const max = tripType === "Shared" ? 2 : 4;
    const next = Math.max(1, Math.min(max, passengers + delta));
    setPassengers(next);
    sessionStorage.setItem("trip_passengers", next.toString());
  };

  const fare = quote ? estimatedFareFor(quote, tripType) : null;

  const [createdBookingId, setCreatedBookingId] = useState<string>("");

  const handleConfirmBooking = async () => {
    if (!pickup || !dropoff || distance === null || fare === null) return;
    setBookingLoading(true);
    setErrorMessage("");

    try {
      const newBooking = await createBooking({
        is_shared_trip: tripType === "Shared",
        passenger_count: passengers,
        pickup_address: pickup.address,
        pickup_latitude: pickup.lat,
        pickup_longitude: pickup.lng,
        dropoff_address: dropoff.address,
        dropoff_latitude: dropoff.lat,
        dropoff_longitude: dropoff.lng,
        estimated_distance_km: distance,
        estimated_fare: fare,
      });

      // The database starts the search for a driver the moment the booking is inserted.

      setCreatedBookingId(newBooking.booking_id);
      sessionStorage.setItem("current_active_booking_id", newBooking.booking_id);
      setBookingLoading(false);
      setSuccessOpen(true);
    } catch (err: any) {
      console.error("Booking error:", err);
      const errMsg = err?.message || "May aberya sa pag-book. Pakisubukang muli.";
      setErrorMessage(errMsg);
      setBookingLoading(false);
      // The rate changed (or the figure was off) between the quote and the tap: show the current fare again.
      if (err?.fareCode === "ERR_FARE_MISMATCH") {
        fetchFareQuote(supabase, distance, passengers).then(setQuote).catch(() => undefined);
      }
    }
  };

  const handleSuccessClose = () => {
    setSuccessOpen(false);
    // Save destination to recent destinations
    const rawDropoff = sessionStorage.getItem("trip_dropoff");
    if (rawDropoff) {
      try {
        const parsed = JSON.parse(rawDropoff);
        if (parsed.address && parsed.lat && parsed.lng) {
          saveRecentDestination({
            name: parsed.address.split(",")[0] || parsed.address,
            address: parsed.address,
            lat: parsed.lat,
            lng: parsed.lng,
          });
        }
      } catch {}
    }
    // Clear trip input session data
    sessionStorage.removeItem("trip_pickup");
    sessionStorage.removeItem("trip_dropoff");
    sessionStorage.removeItem("trip_passengers");
    sessionStorage.removeItem("trip_type");
    if (createdBookingId) {
      sessionStorage.setItem("current_active_booking_id", createdBookingId);
    }
    // Transition directly into Trip Monitoring screen with history replacement
    navigate("/trip-monitoring", { replace: true, state: { bookingId: createdBookingId } });
  };

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        backgroundColor: "#F8FAFC",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {/* Header respecting safe-area-inset-top */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          paddingTop: "calc(var(--safe-area-top) + 16px)",
          paddingBottom: "16px",
          paddingLeft: "20px",
          paddingRight: "20px",
        }}
      >
        <IconButton onClick={() => navigate("/new-trip")} sx={{ color: "#0F172A", padding: 0 }}>
          <ArrowBackIcon />
        </IconButton>
        <Typography sx={{ fontSize: "18px", fontWeight: 800, marginLeft: "12px", color: "#0F172A" }}>
          {language === "tl" ? "Kumpirmahin ang Biyahe" : "Booking Details"}
        </Typography>
      </Box>

      {errorMessage && (
        <Box sx={{ paddingX: "20px" }}>
          <Alert severity="error" sx={{ borderRadius: "12px", marginBottom: "16px" }}>
            {errorMessage}
          </Alert>
        </Box>
      )}

      {loading ? (
        <Box sx={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: "16px" }}>
          <CircularProgress sx={{ color: "#FF6B00" }} />
          <Typography sx={{ fontSize: "14px", fontWeight: 600, color: "#64748B" }}>
            {language === "tl" ? "Kinakalkula ang distansya at pamasahe..." : "Calculating distance & fare..."}
          </Typography>
        </Box>
      ) : (
        <Box
          className="hide-scrollbar"
          sx={{
            flexGrow: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
            padding: "0 20px 16px 20px",
          }}
        >
          {/* Route Summary Card */}
          <Paper
            elevation={0}
            sx={{
              padding: "18px",
              borderRadius: "20px",
              border: "1px solid #E2E8F0",
              backgroundColor: "#FFFFFF",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            {/* Pickup Address */}
            <Box sx={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
              <LocationOnIcon sx={{ color: "#34A853", marginTop: "2px" }} />
              <Box>
                <Typography sx={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8" }}>
                  {language === "tl" ? "MULA SA (PICKUP)" : "PICKUP POINT"}
                </Typography>
                <Typography sx={{ fontSize: "14px", fontWeight: 700, color: "#334155" }}>
                  {pickup?.address}
                </Typography>
              </Box>
            </Box>

            <Box sx={{ borderLeft: "2px dashed #CBD5E1", height: "16px", marginLeft: "11px", marginTop: "-12px", marginBottom: "-12px" }} />

            {/* Dropoff Address */}
            <Box sx={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
              <LocationOnIcon sx={{ color: "#EF4444", marginTop: "2px" }} />
              <Box>
                <Typography sx={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8" }}>
                  {language === "tl" ? "PUPUNTA SA (DESTINASYON)" : "DESTINATION"}
                </Typography>
                <Typography sx={{ fontSize: "14px", fontWeight: 700, color: "#334155" }}>
                  {dropoff?.address}
                </Typography>
              </Box>
            </Box>
          </Paper>

          {/* Trip Parameters Info */}
          <Paper
            elevation={0}
            sx={{
              padding: "16px 20px",
              borderRadius: "20px",
              border: "1px solid #E2E8F0",
              backgroundColor: "#FFFFFF",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            {/* Distance Detail */}
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Box sx={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <RouteIcon sx={{ color: "#FF6B00", fontSize: "20px" }} />
                <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "#475569" }}>
                  {language === "tl" ? "Distansya" : "Distance"}
                </Typography>
              </Box>
              <Box sx={{ textAlign: "right" }}>
                <Typography sx={{ fontSize: "14px", fontWeight: 800, color: "#0F172A" }}>
                  {distance !== null ? distance + " km" : "—"}
                </Typography>
                <Typography sx={{ fontSize: "9px", color: "#94A3B8", fontWeight: 600 }}>
                  via OSRM road-network
                </Typography>
              </Box>
            </Box>

            <Box sx={{ borderBottom: "1px solid #F1F5F9" }} />

            {/* Service Type Detail & Interactive Toggle */}
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Box sx={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <LocalTaxiIcon sx={{ color: "#FF6B00", fontSize: "20px" }} />
                <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "#475569" }}>
                  {language === "tl" ? "Uri ng Biyahe" : "Trip Type"}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", gap: "6px" }}>
                <Button
                  size="small"
                  onClick={() => handleToggleTripType("Solo")}
                  startIcon={<PersonIcon sx={{ fontSize: "14px !important" }} />}
                  sx={{
                    borderRadius: "12px",
                    px: "10px",
                    py: "3px",
                    fontSize: "12px",
                    fontWeight: 700,
                    textTransform: "none",
                    backgroundColor: tripType === "Solo" ? "#FF6B00" : "#F1F5F9",
                    color: tripType === "Solo" ? "#FFFFFF" : "#64748B",
                    "&:hover": { backgroundColor: tripType === "Solo" ? "#E66000" : "#E2E8F0" },
                  }}
                >
                  Solo
                </Button>
                <Button
                  size="small"
                  onClick={() => handleToggleTripType("Shared")}
                  startIcon={<GroupsIcon sx={{ fontSize: "14px !important" }} />}
                  sx={{
                    borderRadius: "12px",
                    px: "10px",
                    py: "3px",
                    fontSize: "12px",
                    fontWeight: 700,
                    textTransform: "none",
                    backgroundColor: tripType === "Shared" ? "#10B981" : "#F1F5F9",
                    color: tripType === "Shared" ? "#FFFFFF" : "#64748B",
                    "&:hover": { backgroundColor: tripType === "Shared" ? "#059669" : "#E2E8F0" },
                  }}
                >
                  Shared
                </Button>
              </Box>
            </Box>

            <Box sx={{ borderBottom: "1px solid #F1F5F9" }} />

            {/* Passenger Detail & Dynamic +/- Counter */}
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Box sx={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <PersonIcon sx={{ color: "#FF6B00", fontSize: "20px" }} />
                <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "#475569" }}>
                  {language === "tl" ? "Bilang ng Pasahero" : "Passenger Count"}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <IconButton
                  size="small"
                  disabled={passengers <= 1}
                  onClick={() => handleChangePassengers(-1)}
                  sx={{
                    width: 24,
                    height: 24,
                    backgroundColor: "#F1F5F9",
                    color: "#0F172A",
                    "&:hover": { backgroundColor: "#E2E8F0" },
                  }}
                >
                  <RemoveIcon sx={{ fontSize: 14 }} />
                </IconButton>
                <Typography sx={{ fontSize: "13px", fontWeight: 800, color: "#0F172A", minWidth: "16px", textAlign: "center" }}>
                  {passengers}
                </Typography>
                <IconButton
                  size="small"
                  disabled={tripType === "Shared" ? passengers >= 2 : passengers >= 4}
                  onClick={() => handleChangePassengers(1)}
                  sx={{
                    width: 24,
                    height: 24,
                    backgroundColor: "#F1F5F9",
                    color: "#0F172A",
                    "&:hover": { backgroundColor: "#E2E8F0" },
                  }}
                >
                  <AddIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Box>
            </Box>
          </Paper>

          {/* Fare Presentation Box */}
          <Paper
            elevation={0}
            sx={{
              padding: "20px",
              borderRadius: "24px",
              background: "linear-gradient(135deg, #1F1F1F 0%, #0A0A0A 100%)",
              color: "#FFFFFF",
              boxShadow: "0 12px 24px rgba(0,0,0,0.15)",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Graphic background highlights */}
            <Box
              sx={{
                position: "absolute",
                right: "-20px",
                top: "-20px",
                width: "120px",
                height: "120px",
                borderRadius: "50%",
                backgroundColor: "rgba(255, 107, 0, 0.1)",
                filter: "blur(10px)",
              }}
            />

            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <Box sx={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <AccountBalanceWalletIcon sx={{ color: "#FF6B00" }} />
                <Typography sx={{ fontSize: "14px", fontWeight: 700, color: "#94A3B8" }}>
                  {tripType === "Shared"
                    ? language === "tl" ? "ESTIMASYON NG SHARED FARE" : "SHARED FARE ESTIMATE"
                    : language === "tl" ? "ESTIMASYON NG PAMASAHE" : "ESTIMATED FARE"}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
                <Typography sx={{ fontSize: "16px", fontWeight: 800, color: "#FF6B00" }}>
                  ₱
                </Typography>
                <Typography sx={{ fontSize: "32px", fontWeight: 800, color: "#FFFFFF", lineHeight: 1 }}>
                  {fare !== null ? fare.toFixed(2) : "—"}
                </Typography>
              </Box>
            </Box>

            <Box sx={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }} />

            {/* Fare conditions, straight from the database quote */}
            <Box sx={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {quote && tripType === "Solo" && (
                <>
                  <Box sx={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#94A3B8" }}>
                    <Typography>{language === "tl" ? "Bawat Upuan (Seat Fare):" : "Fare per seat:"}</Typography>
                    <Typography>₱{quote.seat_fare.toFixed(2)}</Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#94A3B8" }}>
                    <Typography>{language === "tl" ? "Solo Trip multiplier (Buong Kapasidad):" : "Full capacity multiplier:"}</Typography>
                    <Typography>× {quote.seat_capacity}</Typography>
                  </Box>
                  <Box sx={{ display: "flex", gap: "6px", alignItems: "flex-start", marginTop: "4px", backgroundColor: "rgba(255, 107, 0, 0.08)", padding: "10px", borderRadius: "12px" }}>
                    <InfoIcon sx={{ color: "#FF6B00", fontSize: "16px", marginTop: "2px" }} />
                    <Typography sx={{ fontSize: "10.5px", color: "#FF8533", lineHeight: 1.4 }}>
                      {language === "tl"
                        ? "Dahil ito ay Solo Trip, sisingilin ang kabuuang pamasahe para sa buong kapasidad ng tricycle (" + quote.seat_capacity + " na upuan), kahit ilan pa ang sumakay."
                        : "As a Solo Trip, the total fare represents the exclusive capacity of the tricycle (" + quote.seat_capacity + " seats multiplied), regardless of passenger headcount entered."}
                    </Typography>
                  </Box>
                </>
              )}
              {quote && tripType === "Shared" && (
                <SharedFareNotice
                  language={language}
                  tone="dark"
                  matchedEstimate={quote.shared_matched_estimate}
                  maxUnmatchedFare={quote.max_unmatched_fare}
                  partnerAssumptionPassengers={quote.partner_assumption_passengers}
                />
              )}
            </Box>
          </Paper>
        </Box>
      )}

      {/* Action Button respecting safe-area-inset-bottom */}
      {!loading && (
        <Box sx={{ padding: "0 20px calc(var(--safe-area-bottom) + 16px) 20px" }}>
          <Button
            variant="contained"
            onClick={handleConfirmBooking}
            disabled={bookingLoading || fare === null}
            sx={{
              height: "56px",
              borderRadius: "16px",
              fontWeight: 700,
              fontSize: "1rem",
              backgroundColor: "#FF6B00",
              color: "#FFFFFF",
              "&:hover": {
                backgroundColor: "#E66000",
                boxShadow: "none",
              },
              boxShadow: "none",
              textTransform: "none",
              width: "100%",
            }}
          >
            {bookingLoading ? (
              <CircularProgress size={24} color="inherit" />
            ) : language === "tl" ? (
              "Kumpirmahin ang Booking"
            ) : (
              "Confirm & Book Tricycle"
            )}
          </Button>
        </Box>
      )}

      {/* Success Modal Popup */}
      <SuccessModal
        open={successOpen}
        title={language === "tl" ? "Nahanap na ang Drayber!" : "Booking Request Sent!"}
        message={
          language === "tl"
            ? "Matagumpay na naipadala ang iyong booking. Naghahanap na kami ng tricycle drayber na malapit sa iyo."
            : "Your tricycle booking has been registered. We are locating the nearest TODA driver to assign to your ride."
        }
      />

      {/* Action helper button inside success screen overlay to redirect back */}
      {successOpen && (
        <Button
          onClick={handleSuccessClose}
          sx={{
            position: "absolute",
            bottom: "calc(var(--safe-area-bottom) + 40px)",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 99999,
            color: "#FFFFFF",
            fontWeight: 700,
            backgroundColor: "#FF6B00",
            padding: "10px 24px",
            borderRadius: "10px",
            boxShadow: "none",
            "&:hover": { backgroundColor: "#E66000", boxShadow: "none" },
            textTransform: "none",
          }}
        >
          {language === "tl" ? "Pumunta sa Dashboard" : "Go to Dashboard"}
        </Button>
      )}
    </Box>
  );
};

export default BookSummary;
