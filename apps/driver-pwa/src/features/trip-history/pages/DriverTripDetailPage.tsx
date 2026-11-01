import React, { useState, useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Rating from "@mui/material/Rating";
import CircularProgress from "@mui/material/CircularProgress";
import PaidOutlinedIcon from "@mui/icons-material/PaidOutlined";
import PaymentsOutlinedIcon from "@mui/icons-material/PaymentsOutlined";
import StarIcon from "@mui/icons-material/Star";

import appIconImg from "@sakay/shared/src/assets/icons/app-icon-toto.webp";
import { ContactCard, ReportIssueButton, TripRoute, TripStatusChip, formatShortBookingId, formatTripWhen, activateWithKeyboard, formatPeso } from "@sakay/shared";
import PageHeader from "../../../common/components/PageHeader";
import SakayToast from "../../../common/components/SakayToast";
import { useLanguage } from "../../../utils/LanguageContext";
import { supabase } from "../../../services/supabaseClient";
import { DriverFeedbackModal } from "../../feedback/components/DriverFeedbackModal";
import { fetchDriverTrips } from "../../../services/driverApiService";
import { fetchReportableTrips } from "../../../services/incidentService";

/** What the screen reads of a trip (the history passes the list's row; the full record comes from the database) */
interface DriverTripView {
  id: string;
  passengerName?: string;
  passengerPhone?: string;
  pickupLocation?: string;
  dropoffLocation?: string;
  distanceKm?: number;
  fareAmount?: number;
  fareBreakdown?: any;
  tripMode?: string;
  status?: string;
  date?: string;
  time?: string;
  createdAt?: string;
}

/** A line of a fact (the fare, the payment method) with its icon on the left and its value on the right */
const FactRow: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode }> = ({ icon, label, value }) => (
  <Box sx={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
    <Box aria-hidden sx={{ display: "flex", flexShrink: 0, color: "#FF6600" }}>{icon}</Box>
    <Typography sx={{ flex: 1, minWidth: 0, fontSize: "14px", color: "#475569", fontFamily: "Poppins, sans-serif" }}>{label}</Typography>
    <Typography component="div" sx={{ fontSize: "15px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif", fontVariantNumeric: "tabular-nums", textAlign: "right", flexShrink: 0 }}>{value}</Typography>
  </Box>
);

export const DriverTripDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ id: string }>();
  const { language } = useLanguage();

  // The trip comes with the navigation when it is opened from the history; the full record (the passenger's number, the time) is read from the database. A trip passed
  // along for ANOTHER id is never used, and when the trip cannot be found the screen says so: no sample trip is ever shown.
  const passed = (location.state as { trip?: DriverTripView } | null)?.trip;
  const usable = passed && (!params.id || passed.id === params.id) ? passed : null;
  const [trip, setTrip] = useState<DriverTripView | null>(usable);
  const [lookup, setLookup] = useState<"ready" | "loading" | "missing">(usable ? "ready" : params.id ? "loading" : "missing");
  useEffect(() => {
    if (!params.id) {
      setLookup(usable ? "ready" : "missing");
      return;
    }
    let alive = true;
    fetchDriverTrips()
      .then((list: DriverTripView[]) => {
        if (!alive) return;
        const found = list.find((t) => t.id === params.id) ?? null;
        if (found) {
          setTrip(found);
          setLookup("ready");
        } else if (!usable) {
          setTrip(null);
          setLookup("missing");
        }
      })
      .catch(() => alive && !usable && setLookup("missing"));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const rawTripId = trip?.id ?? params.id ?? "";
  const passengerName = trip?.passengerName ?? "";
  const passengerPhone = trip?.passengerPhone ?? "";
  // The final fare the database wrote (Rule 6.2), else the estimate; exact centavos when components exist.
  const fin = (trip as any)?.fareBreakdown?.final?.components;
  const fareAmount = fin
    ? Math.max(Number((trip as any)?.fareBreakdown?.final?.minimum_fare) || 0, Number((fin.base + fin.distance).toFixed(2)))
    : (Number(trip?.fareAmount ?? 0) || 0);
  const tripMode = trip?.tripMode === "Shared Ride" ? "Shared Ride" : "Solo Trip";
  const lang = language === "tl" ? "tl" : "en";
  const tl = lang === "tl";
  // Whether the driver's incident flow lists this trip (the rule it already applies); unknown until it answers, and a failed answer does not hide the button
  const [reportable, setReportable] = useState<boolean | null>(null);
  useEffect(() => {
    if (!rawTripId || lookup !== "ready") return;
    let alive = true;
    setReportable(null);
    fetchReportableTrips()
      .then((list) => alive && setReportable(list.some((t) => t.bookingId === rawTripId)))
      .catch(() => alive && setReportable(true));
    return () => {
      alive = false;
    };
  }, [rawTripId, lookup]);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [passengerRatingReceived, setPassengerRatingReceived] = useState<any | null>(null);
  const [driverRatingGiven, setDriverRatingGiven] = useState<any | null>(null);
  const [ratingModalOpen, setRatingModalOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadRatings() {
      try {
        // Query rating given by passenger to driver
        const { data: pRating } = await supabase
          .from("rating")
          .select("*")
          .eq("booking_id", rawTripId)
          .eq("rater_role", "Passenger")
          .maybeSingle();

        if (pRating && isMounted) {
          setPassengerRatingReceived(pRating);
        }

        // Query rating given by driver to passenger
        const { data: dRating } = await supabase
          .from("rating")
          .select("*")
          .eq("booking_id", rawTripId)
          .eq("rater_role", "Driver")
          .maybeSingle();

        if (dRating && isMounted) {
          setDriverRatingGiven(dRating);
        } else {
          // Fallback check in localStorage
          try {
            const raw = localStorage.getItem("sakay_driver_passenger_ratings");
            if (raw) {
              const list = JSON.parse(raw);
              const found = list.find((item: any) => item.bookingId === rawTripId || item.id === rawTripId);
              if (found && isMounted) {
                setDriverRatingGiven(found);
              }
            }
          } catch {}
        }
      } catch (err) {
        console.warn("[DriverTripDetailPage] Rating fetch error:", err);
      }
    }

    loadRatings();
    return () => {
      isMounted = false;
    };
  }, [rawTripId]);

  const handleCopyTripId = () => {
    if (rawTripId) {
      navigator.clipboard.writeText(rawTripId);
      setToastMessage(
        language === "tl"
          ? `Na-copy ang Buong Booking ID: ${rawTripId}`
          : `Full Booking ID Copied: ${rawTripId}`
      );
    }
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
      {/* Settings PageHeader */}
      <PageHeader
        title={trip ? formatTripWhen({ createdAt: trip.createdAt, dateString: trip.date, time: trip.time }) || (tl ? "Detalyadong Biyahe" : "Trip Details") : tl ? "Detalyadong Biyahe" : "Trip Details"}
        onBack={() => navigate(-1)}
      />

      {/* Scrollable Content */}
      <Box
        className="hide-scrollbar"
        sx={{
          flex: 1,
          overflowY: "auto",
          "& > *": { flexShrink: 0 },
          p: 2,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          pb: "calc(var(--safe-area-bottom) + 24px)",
        }}
      >
        {lookup === "loading" && (
          <Box role="status" sx={{ display: "flex", justifyContent: "center", p: 6 }}>
            <CircularProgress sx={{ color: "#FF6600" }} aria-label={tl ? "Kinukuha ang biyahe" : "Loading the trip"} />
          </Box>
        )}

        {lookup === "missing" && (
          <Paper elevation={0} sx={{ backgroundColor: "#FFFFFF", border: "1px solid #E8ECF1", borderRadius: "16px", p: 3, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5 }}>
            <Typography sx={{ fontSize: "15px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>{tl ? "Hindi makita ang biyaheng ito" : "This trip could not be found"}</Typography>
            <Typography sx={{ fontSize: "13px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>{tl ? "Buksan ito mula sa iyong Kasaysayan ng Biyahe." : "Open it from your Trip History."}</Typography>
            <Button onClick={() => navigate("/driver/history")} sx={{ height: 44, px: 3, borderRadius: "14px", backgroundColor: "#FF6600", color: "#FFFFFF", fontWeight: 700, textTransform: "none", fontFamily: "Poppins, sans-serif", "&:hover": { backgroundColor: "#E65C00" } }}>
              {tl ? "Kasaysayan ng Biyahe" : "Trip History"}
            </Button>
          </Paper>
        )}

        {trip && lookup !== "missing" && (
          <>
            {/* 1. The passenger comes first, and says so */}
            <ContactCard
              role="passenger"
              language={lang}
              name={passengerName}
              lines={[tripMode === "Shared Ride" ? (tl ? "Shared Trip" : "Shared Trip") : "Solo Trip"]}
              phone={passengerPhone}
              emptyNote={tl ? "Walang pangalan ng pasahero sa talaan." : "No passenger name on the record."}
            />

            {/* 2. The trip: the same card as the passenger's */}
            <Paper elevation={0} sx={{ backgroundColor: "#FFFFFF", border: "1px solid #E8ECF1", borderRadius: "16px", p: 2.5, display: "flex", flexDirection: "column", gap: 2 }}>
              <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.75 }}>
                <TripStatusChip status={trip.status} language={lang} size="medium" />
                <Typography
                  role="button"
                  tabIndex={0}
                  onKeyDown={activateWithKeyboard}
                  onClick={handleCopyTripId}
                  aria-label={tl ? `Booking ID ${formatShortBookingId(rawTripId)}. I-tap para kopyahin` : `Booking ID ${formatShortBookingId(rawTripId)}. Tap to copy`}
                  sx={{ fontSize: "15px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif", cursor: "pointer", "&:active": { opacity: 0.7 }, "&:focus-visible": { outline: "2px solid #E65C00", outlineOffset: 2, borderRadius: "6px" } }}
                >
                  {formatShortBookingId(rawTripId)}
                </Typography>
              </Box>

              <Divider sx={{ borderColor: "#EEF1F5" }} />

              <Box sx={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                <Box component="img" src={appIconImg} alt="" aria-hidden sx={{ width: 34, height: 34, objectFit: "contain", flexShrink: 0 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: "14px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif", lineHeight: 1.3 }}>SAKAY Tricycle</Typography>
                  <Typography sx={{ fontSize: "12px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>{tripMode === "Shared Ride" ? "Shared Trip" : "Solo Trip"}</Typography>
                </Box>
              </Box>

              <Divider sx={{ borderColor: "#EEF1F5" }} />

              <TripRoute pickup={trip.pickupLocation ?? ""} dropoff={trip.dropoffLocation ?? ""} labelled distanceKm={trip.distanceKm ?? null} language={lang} />

              <Divider sx={{ borderColor: "#EEF1F5" }} />

              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                <FactRow icon={<PaidOutlinedIcon />} label={tl ? "Kabuuang nakolekta (gross)" : "Gross fare collected"} value={formatPeso(fareAmount)} />
                <FactRow icon={<PaymentsOutlinedIcon />} label={tl ? "Paraan ng pagbayad" : "Payment method"} value="Cash" />
              </Box>
            </Paper>

            {/* 3. Report an issue: the same button as the passenger's, into the DRIVER's own reporting (a trip its flow lists) */}
            {reportable === true && (
              <ReportIssueButton
                label={tl ? "Mag-ulat ng problema sa biyahe" : "Report an issue"}
                onClick={() => navigate("/driver/report-incident", { state: { bookingId: rawTripId, from: location.pathname } })}
              />
            )}

        {/* Driver & Passenger Ratings Section */}
        <Paper
          elevation={0}
          sx={{
            borderRadius: "20px",
            backgroundColor: "#FFFFFF",
            p: 2.5,
            border: "1px solid #F1F5F9",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <Typography sx={{ fontSize: "14px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
            {language === "tl" ? "Mga Rating at Feedback" : "Ratings & Feedback"}
          </Typography>

          {/* Rating Received from Passenger */}
          <Box>
            <Typography sx={{ fontSize: "12px", fontWeight: 700, color: "#64748B", mb: 1, fontFamily: "Poppins, sans-serif" }}>
              {language === "tl" ? "Rating mula sa pasahero" : "Rating from passenger"}
            </Typography>

            {passengerRatingReceived ? (
              <Box sx={{ p: 1.5, borderRadius: "14px", backgroundColor: "#F8FAFC", border: "1px solid #E2E8F0", display: "flex", flexDirection: "column", gap: 0.75 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Rating value={Number(passengerRatingReceived.stars) || 0} readOnly size="small" sx={{ color: "#FF6600" }} />
                  <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "#FF6600" }}>
                    {(Number(passengerRatingReceived.stars) || 0).toFixed(1)} / 5.0
                  </Typography>
                </Box>
                {passengerRatingReceived.tags && passengerRatingReceived.tags.length > 0 && (
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
                    {passengerRatingReceived.tags.map((tag: string) => (
                      <Chip key={tag} label={tag} size="small" sx={{ fontSize: "12px", backgroundColor: "#FFF8F0", color: "#FF6600", height: 22 }} />
                    ))}
                  </Box>
                )}
                {passengerRatingReceived.comment && (
                  <Typography sx={{ fontSize: "12px", color: "#475569", fontStyle: "italic", mt: 0.5 }}>
                    "{passengerRatingReceived.comment}"
                  </Typography>
                )}
              </Box>
            ) : (
              <Typography sx={{ fontSize: "13px", color: "#64748B", fontStyle: "italic" }}>
                {language === "tl" ? "Wala pang naitatalang rating mula sa pasahero" : "No rating received from passenger yet"}
              </Typography>
            )}
          </Box>

          <Divider sx={{ borderColor: "#F1F5F9" }} />

          {/* Rating Given to Passenger */}
          <Box>
            <Typography sx={{ fontSize: "12px", fontWeight: 700, color: "#64748B", mb: 1, fontFamily: "Poppins, sans-serif" }}>
              {language === "tl" ? "Iyong rating sa pasahero" : "Your rating to passenger"}
            </Typography>

            {driverRatingGiven ? (
              <Box sx={{ p: 1.5, borderRadius: "14px", backgroundColor: "#F8FAFC", border: "1px solid #E2E8F0", display: "flex", flexDirection: "column", gap: 0.75 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Rating value={Number(driverRatingGiven.stars) || 0} readOnly size="small" sx={{ color: "#FF6600" }} />
                  <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "#FF6600" }}>
                    {(Number(driverRatingGiven.stars) || 0).toFixed(1)} / 5.0
                  </Typography>
                </Box>
                {driverRatingGiven.tags && driverRatingGiven.tags.length > 0 && (
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
                    {driverRatingGiven.tags.map((tag: string) => (
                      <Chip key={tag} label={tag} size="small" sx={{ fontSize: "12px", backgroundColor: "#FFF8F0", color: "#FF6600", height: 22 }} />
                    ))}
                  </Box>
                )}
                {driverRatingGiven.comment && (
                  <Typography sx={{ fontSize: "12px", color: "#475569", fontStyle: "italic", mt: 0.5 }}>
                    "{driverRatingGiven.comment}"
                  </Typography>
                )}
              </Box>
            ) : (
              <Button
                variant="outlined"
                startIcon={<StarIcon />}
                onClick={() => setRatingModalOpen(true)}
                sx={{
                  borderRadius: "12px",
                  borderColor: "#FF6600",
                  color: "#FF6600",
                  fontSize: "13px",
                  fontWeight: 700,
                  textTransform: "none",
                  fontFamily: "Poppins, sans-serif",
                  py: 1,
                  px: 2,
                  "&:hover": { backgroundColor: "#FFF8F0" },
                }}
              >
                {language === "tl" ? "I-rate ang Pasahero Ngayon" : "Rate Passenger Now"}
              </Button>
            )}
          </Box>
        </Paper>

          </>
        )}
      </Box>

      {/* Copy Toast */}
      {toastMessage && (
        <SakayToast open={Boolean(toastMessage)} message={toastMessage} onClose={() => setToastMessage(null)} />
      )}

      {/* Rate Passenger Modal Trigger */}
      {ratingModalOpen && (
        <DriverFeedbackModal
          open={ratingModalOpen}
          onClose={() => setRatingModalOpen(false)}
          booking={{
            booking_id: rawTripId,
            id: rawTripId,
            passenger_name: passengerName,
            passengerName: passengerName,
          }}
          onSubmitted={() => {
            setRatingModalOpen(false);
            // Reload given rating
            try {
              const raw = localStorage.getItem("sakay_driver_passenger_ratings");
              if (raw) {
                const list = JSON.parse(raw);
                const found = list.find((item: any) => item.bookingId === rawTripId || item.id === rawTripId);
                if (found) setDriverRatingGiven(found);
              }
            } catch {}
          }}
        />
      )}
    </Box>
  );
};

export default DriverTripDetailPage;
