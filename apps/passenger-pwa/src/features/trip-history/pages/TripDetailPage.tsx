import React from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Rating from "@mui/material/Rating";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import PaidOutlinedIcon from "@mui/icons-material/PaidOutlined";
import PaymentsOutlinedIcon from "@mui/icons-material/PaymentsOutlined";

import appIconImg from "@sakay/shared/src/assets/icons/app-icon-toto.webp";
import { ContactCard, ReportIssueButton, TripRoute, TripStatusChip, formatTripWhen, formatShortBookingId, type FareBreakdown, activateWithKeyboard, FareLine, formatPeso, describePayment, earlyEndReasonLabel } from "@sakay/shared";
import PageHeader from "../../../common/components/PageHeader";
import SakayToast from "../../../common/components/SakayToast";
import { useLanguage } from "../../../utils/LanguageContext";
import { supabase } from "../../../services/supabaseClient";
import { fetchTripHistory } from "../../../services/tripService";
import type { HistoryTrip } from "../../../services/tripService";
import { fetchReportableTrips } from "../../../services/incidentService";
import { driverSummary, stashRebook, tripTypeLabel } from "../tripFormat";

const ReceiptLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography sx={{ fontSize: "13px", fontWeight: 600, color: "#64748B", fontFamily: "Poppins, sans-serif" }}>{children}</Typography>
);

/** One step of the receipt: done (a check), what it was, and when (the time never wraps, the label may) */
const ReceiptStep: React.FC<{ label: string; time: string }> = ({ label, time }) => (
  <Box component="li" sx={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", columnGap: 1.25, alignItems: "baseline" }}>
    <CheckCircleIcon aria-hidden sx={{ fontSize: 17, color: "#16A34A", alignSelf: "center" }} />
    <Typography sx={{ fontSize: "13px", fontWeight: 600, color: "#0F172A", fontFamily: "Poppins, sans-serif", lineHeight: 1.35 }}>{label}</Typography>
    <Typography sx={{ fontSize: "12.5px", color: "#475569", fontFamily: "Poppins, sans-serif", whiteSpace: "nowrap", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{time}</Typography>
  </Box>
);

/** A label with its icon on the left and its value on the right (the fare and the payment method) */
const FactRow: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode }> = ({ icon, label, value }) => (
  <Box sx={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
    <Box aria-hidden sx={{ display: "flex", flexShrink: 0, color: "#FF6600" }}>{icon}</Box>
    <Typography sx={{ flex: 1, minWidth: 0, fontSize: "14px", color: "#475569", fontFamily: "Poppins, sans-serif" }}>{label}</Typography>
    <Typography component="div" sx={{ fontSize: "15px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif", fontVariantNumeric: "tabular-nums", textAlign: "right", flexShrink: 0 }}>{value}</Typography>
  </Box>
);

const cardSx = { backgroundColor: "#FFFFFF", border: "1px solid #E8ECF1", borderRadius: "16px" } as const;

export const TripDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ id: string }>();
  const { language } = useLanguage();
  const tl = language === "tl";
  const lang = tl ? "tl" : "en";

  // The trip comes with the navigation when it is opened from the history. A trip passed along for ANOTHER id (or none at all) is never used, and a trip that was not passed (a
  // refresh, a shared link) is looked up by its id: no sample trip is ever shown.
  const passed = (location.state as { trip?: HistoryTrip } | null)?.trip;
  const usable = passed && (!params.id || passed.id === params.id) ? passed : null;
  const [trip, setTrip] = React.useState<HistoryTrip | null>(usable);
  const [lookup, setLookup] = React.useState<"ready" | "loading" | "missing">(usable ? "ready" : params.id ? "loading" : "missing");

  React.useEffect(() => {
    if (usable) {
      setTrip(usable);
      setLookup("ready");
      return;
    }
    if (!params.id) {
      setTrip(null);
      setLookup("missing");
      return;
    }
    let alive = true;
    setLookup("loading");
    fetchTripHistory()
      .then((list) => {
        if (!alive) return;
        const found = list.find((t) => t.id === params.id) ?? null;
        setTrip(found);
        setLookup(found ? "ready" : "missing");
      })
      .catch(() => alive && setLookup("missing"));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, usable?.id]);

  const tripId = trip?.id ?? "";
  const manilaTime = (iso: string) => new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });
  const paymentText = trip?.paymentStatus
    ? describePayment({ paymentStatus: trip.paymentStatus, fareUnconfirmed: Boolean(trip.fareUnconfirmed) }, tl ? "tl" : "en")
    : "";

  const [toastMessage, setToastMessage] = React.useState<string | null>(null);
  const [passengerRatingGiven, setPassengerRatingGiven] = React.useState<any>(null);
  const [driverRatingReceived, setDriverRatingReceived] = React.useState<any>(null);
  // Whether the incident flow lists this trip (the same rule it uses: a trip that had a driver). Unknown until it answers; a failed answer does not hide the button, the flow itself still checks.
  const [reportable, setReportable] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    if (!tripId) return;
    let isMounted = true;
    setPassengerRatingGiven(null);
    setDriverRatingReceived(null);
    async function loadRatings() {
      try {
        // Query rating given by passenger
        const { data: pData } = await supabase
          .from("rating")
          .select("*")
          .eq("booking_id", tripId)
          .eq("rater_role", "Passenger")
          .maybeSingle();

        if (pData && isMounted) {
          setPassengerRatingGiven(pData);
        } else {
          try {
            const raw = localStorage.getItem("sakay_passenger_ratings");
            if (raw) {
              const list = JSON.parse(raw);
              const found = list.find((item: any) => item.bookingId === tripId || item.id === tripId);
              if (found && isMounted) setPassengerRatingGiven(found);
            }
          } catch {}
        }

        // Query rating received from driver
        const { data: dData } = await supabase
          .from("rating")
          .select("*")
          .eq("booking_id", tripId)
          .eq("rater_role", "Driver")
          .maybeSingle();

        if (dData && isMounted) {
          setDriverRatingReceived(dData);
        } else {
          try {
            const raw = localStorage.getItem("sakay_driver_passenger_ratings");
            if (raw) {
              const list = JSON.parse(raw);
              const found = list.find((item: any) => item.bookingId === tripId || item.id === tripId);
              if (found && isMounted) setDriverRatingReceived(found);
            }
          } catch {}
        }
      } catch (err) {
        console.warn("[TripDetailPage] Rating load note:", err);
      }
    }
    loadRatings();
    return () => {
      isMounted = false;
    };
  }, [tripId]);

  React.useEffect(() => {
    if (!tripId) return;
    let alive = true;
    setReportable(null);
    fetchReportableTrips()
      .then((list) => alive && setReportable(list.some((t) => t.bookingId === tripId)))
      .catch(() => alive && setReportable(true));
    return () => {
      alive = false;
    };
  }, [tripId]);

  const handleCopyTripId = () => {
    if (tripId) {
      navigator.clipboard.writeText(tripId);
      setToastMessage(
        language === "tl"
          ? `Na-copy ang Buong Booking ID: ${tripId}`
          : `Full Booking ID Copied: ${tripId}`
      );
    }
  };

  // Rebook: THIS trip's pickup and destination go to the new-trip screen; the booking is not submitted and the fare is worked out there again
  const handleRebook = () => {
    if (!trip) return;
    stashRebook(trip);
    navigate("/new-trip");
  };

  const fb = trip?.fareBreakdown as FareBreakdown | null | undefined;
  const fin = fb?.final;
  const hasReceipt = trip?.status === "Completed" && Boolean(trip?.paymentStatus);

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
      {/* The header says WHEN: the date and time of the trip */}
      <PageHeader
        title={trip ? formatTripWhen(trip) : tl ? "Detalyadong Biyahe" : "Trip Details"}
        onBack={() => navigate("/history")}
      />

      {/* Main Scrollable Content */}
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
          <Paper elevation={0} sx={{ ...cardSx, p: 3, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5 }}>
            <Typography sx={{ fontSize: "15px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
              {tl ? "Hindi makita ang biyaheng ito" : "This trip could not be found"}
            </Typography>
            <Typography sx={{ fontSize: "13px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
              {tl ? "Buksan ito mula sa iyong Kasaysayan ng Biyahe." : "Open it from your Trip History."}
            </Typography>
            <Button onClick={() => navigate("/history")} sx={{ height: 44, px: 3, borderRadius: "14px", backgroundColor: "#FF6600", color: "#FFFFFF", fontWeight: 700, textTransform: "none", fontFamily: "Poppins, sans-serif", "&:hover": { backgroundColor: "#E65C00" } }}>
              {tl ? "Kasaysayan ng Biyahe" : "Trip History"}
            </Button>
          </Paper>
        )}

        {trip && (
          <>
            {/* 1. The driver comes first */}
            {(() => {
              const d = driverSummary(trip, lang);
              return (
                <ContactCard
                  role="driver"
                  language={lang}
                  name={d.hasDriver ? d.name : ""}
                  lines={[d.todaName, d.vehicleLine]}
                  phone={trip.driverPhone}
                  emptyNote={tl ? "Walang drayber na tumanggap ng biyaheng ito." : "No driver accepted this booking."}
                />
              );
            })()}

            {/* 2. The trip */}
            <Paper elevation={0} sx={{ ...cardSx, p: 2.5, display: "flex", flexDirection: "column", gap: 2 }}>
              <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.75 }}>
                <TripStatusChip status={trip.status} language={lang} size="medium" />
                <Typography
                  role="button"
                  tabIndex={0}
                  onKeyDown={activateWithKeyboard}
                  onClick={handleCopyTripId}
                  aria-label={tl ? `Booking ID ${formatShortBookingId(tripId)}. I-tap para kopyahin` : `Booking ID ${formatShortBookingId(tripId)}. Tap to copy`}
                  sx={{ fontSize: "15px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif", cursor: "pointer", "&:active": { opacity: 0.7 }, "&:focus-visible": { outline: "2px solid #E65C00", outlineOffset: 2, borderRadius: "6px" } }}
                >
                  {formatShortBookingId(tripId)}
                </Typography>
              </Box>

              <Divider sx={{ borderColor: "#EEF1F5" }} />

              {/* the kind of trip and how it was booked */}
              <Box sx={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                <Box component="img" src={appIconImg} alt="" aria-hidden sx={{ width: 34, height: 34, objectFit: "contain", flexShrink: 0 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: "14px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif", lineHeight: 1.3 }}>SAKAY Tricycle</Typography>
                  <Typography sx={{ fontSize: "12px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>{tripTypeLabel(trip.type, lang)}</Typography>
                </Box>
              </Box>

              <Divider sx={{ borderColor: "#EEF1F5" }} />

              <TripRoute pickup={trip.pickup} dropoff={trip.dropoff} labelled distanceKm={trip.distanceKm ?? null} language={lang} />

              {/* Rebook: this trip's route, a new booking the passenger still confirms */}
              <Button
                variant="contained"
                fullWidth
                onClick={handleRebook}
                sx={{
                  backgroundColor: "#FF6600",
                  color: "#FFFFFF",
                  borderRadius: "14px",
                  height: "46px",
                  fontWeight: 700,
                  fontSize: "14px",
                  textTransform: "none",
                  fontFamily: "Poppins, sans-serif",
                  boxShadow: "none",
                  "&:hover": { backgroundColor: "#E65C00", boxShadow: "none" },
                  "&:active": { transform: "scale(0.98)" },
                }}
              >
                {tl ? "Muling Mag-book" : "Rebook"}
              </Button>

              <Divider sx={{ borderColor: "#EEF1F5" }} />

              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                <FactRow icon={<PaidOutlinedIcon />} label={tl ? "Kabuuang pamasahe" : "Total fare"} value={trip.price} />
                <FactRow icon={<PaymentsOutlinedIcon />} label={tl ? "Paraan ng pagbayad" : "Payment method"} value={tl ? "Cash" : "Cash"} />
              </Box>
            </Paper>

            {/* 3. Report an issue: only for a trip the incident flow lists (it decides what can be reported, and when) */}
            {reportable === true && (
              <Box sx={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 0.5 }}>
                <ReportIssueButton
                  label={tl ? "I-ulat ang problema sa biyahe" : "Report an issue"}
                  onClick={() => navigate("/incident-report", { state: { bookingId: tripId } })}
                />
                {/* Rule 5.7: the driver took the booking while carrying other passengers (or was working the terminal queue) */}
                {trip.driverName && (
                  <Button
                    onClick={() => navigate("/report-driver", { state: { bookingId: tripId } })}
                    sx={{ minHeight: 40, color: "#64748B", fontWeight: 600, fontSize: "13px", textTransform: "none", fontFamily: "Poppins, sans-serif" }}
                  >
                    {tl ? "May ibang sakay ang drayber?" : "Did the driver already have other passengers?"}
                  </Button>
                )}
              </Box>
            )}

            {/* 4. How the fare was worked out, and the receipt: what the database stored */}
            {(fin || hasReceipt) && (
              <Paper elevation={0} sx={{ ...cardSx, p: 2.5, display: "flex", flexDirection: "column", gap: 1.5 }}>
                <Typography component="h2" sx={{ fontSize: "14px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
                  {language === "tl" ? "Kalkulasyon ng pamasahe" : "Fare details"}
                </Typography>

                {fb && fin && (() => {
                  // The lines come from the fare breakdown the database stored when the trip arrived (Rule 6.2);
                  // nothing is derived here. Demo and older records have no breakdown, so only the total is shown.
                  const money = formatPeso;
                  const matched = fin.basis === "matched_estimate_pending_segments";
                  const noteSx = { fontSize: "12px", color: "#64748B", fontFamily: "Poppins, sans-serif" } as const;
                  return (
                    <>
                      <FareLine label={language === "tl" ? "Distansyang siningil" : "Distance billed"} amount={`${fin.billed_distance_km.toFixed(1)} km`} />

                      <FareLine
                        label={
                          language === "tl"
                            ? `Unang ${fb.rule.base_distance_km.toFixed(1)} km (base fare)`
                            : `Base fare (first ${fb.rule.base_distance_km.toFixed(1)} km)`
                        }
                        detail={
                          matched
                            ? language === "tl" ? "Hati mo sa buong tricycle" : "Your share of the whole tricycle"
                            : `${money(fb.rule.base_fare)} × ${fin.seat_capacity} ${language === "tl" ? "upuan (Solo)" : "seats (Solo)"}`
                        }
                        amount={money(fin.components.base)}
                      />

                      <FareLine
                        label={
                          language === "tl"
                            ? `Dagdag na distansya (${fin.excess_km.toFixed(1)} km)`
                            : `Distance charge (${fin.excess_km.toFixed(1)} km)`
                        }
                        detail={!matched && fin.excess_km > 0 ? `${fin.excess_km.toFixed(1)} km × ${money(fb.rule.succeeding_rate)} × ${fin.seat_capacity}` : undefined}
                        amount={money(fin.components.distance)}
                      />

                      {fin.basis === "unmatched_solo" && (
                        <Typography sx={noteSx}>
                          {language === "tl"
                            ? "Shared booking na walang nakapares: sinisingil bilang Solo Trip (Pinakamataas na Pamasahe)."
                            : "Shared booking with no matched passenger: billed as a Solo Trip (Maximum Unmatched Fare)."}
                        </Typography>
                      )}
                      {fin.deviation && (
                        <Typography sx={noteSx}>
                          {language === "tl"
                            ? "Batay sa aktwal na distansyang nilakbay (iba ang ruta sa estimasyon)."
                            : "Based on the actual distance travelled (the route differed from the estimate)."}
                        </Typography>
                      )}
                      {/* The database charges whole pesos (Rule 6.1.2): when the lines above differ from the total, say why in one quiet line */}
                      {fin.components.adjustment ? (
                        <Typography sx={noteSx}>
                          {language === "tl" ? "Buong piso ang singil ayon sa fare rule ng LGU." : "Charged in whole pesos under the LGU fare rule."}
                        </Typography>
                      ) : null}
                    </>
                  );
                })()}

                {/* The receipt (Rules 16.2 / 18.3): the payment as the database recorded it, the moments, and how the trip ended. Nothing here is typed on a phone.
                    Three groups: who and how it was paid, what happened and when, and (only when it applies) how the trip ended early. */}
                {hasReceipt && trip.paymentStatus && (
                  <Box component="section" aria-label={tl ? "Resibo" : "Receipt"} sx={{ display: "flex", flexDirection: "column", gap: 1.25, pt: fin ? 1.5 : 0, borderTop: fin ? "1px dashed #E2E8F0" : "none" }}>
                    <Typography component="h3" sx={{ fontSize: "12px", fontWeight: 700, color: "#475569", letterSpacing: "0.04em", textTransform: "uppercase", fontFamily: "Poppins, sans-serif" }}>
                      {tl ? "Resibo" : "Receipt"}
                    </Typography>

                    {/* 1. The receipt number and the payment: the two facts people look for first */}
                    <Box sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", columnGap: 2, rowGap: 1, alignItems: "center", p: 1.5, borderRadius: "14px", backgroundColor: "#F8FAFC", border: "1px solid #E2E8F0" }}>
                      <ReceiptLabel>{tl ? "Resibo bilang" : "Receipt no."}</ReceiptLabel>
                      <Typography sx={{ fontSize: "14px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif", letterSpacing: "0.02em", textAlign: "right", whiteSpace: "nowrap" }}>
                        {formatShortBookingId(tripId)}
                      </Typography>
                      <ReceiptLabel>{tl ? "Bayad" : "Payment"}</ReceiptLabel>
                      <Chip
                        size="small"
                        label={paymentText}
                        sx={{
                          justifySelf: "end",
                          maxWidth: "100%",
                          height: 26,
                          fontWeight: 700,
                          fontSize: "12px",
                          backgroundColor: trip.paymentStatus === "Paid" ? "#DCFCE7" : trip.paymentStatus === "Waived" ? "#E0F2FE" : "#FEF3C7",
                          color: trip.paymentStatus === "Paid" ? "#166534" : trip.paymentStatus === "Waived" ? "#075985" : "#92400E",
                        }}
                      />
                    </Box>

                    {/* 2. What happened and when, as a short list of completed steps */}
                    {(trip.confirmFareAt || trip.paymentReceivedAt || trip.tripCompletedAt) && (
                      <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 1 }}>
                        {trip.confirmFareAt && <ReceiptStep label={tl ? "Kinumpirma ang pamasahe" : "Fare confirmed"} time={manilaTime(trip.confirmFareAt)} />}
                        {trip.paymentReceivedAt && <ReceiptStep label={tl ? "Natanggap ang bayad" : "Payment received"} time={manilaTime(trip.paymentReceivedAt)} />}
                        {trip.tripCompletedAt && <ReceiptStep label={tl ? "Natapos ang biyahe" : "Trip completed"} time={manilaTime(trip.tripCompletedAt)} />}
                      </Box>
                    )}

                    {/* 3. How it ended, only when it ended early: the reason in full and what it means for the fare, in its own quiet note */}
                    {trip.earlyEndKind && (
                      <Box sx={{ p: 1.5, borderRadius: "14px", backgroundColor: "#FFFBEB", border: "1px solid #FDE68A", display: "flex", flexDirection: "column", gap: 0.25 }}>
                        <Typography sx={{ fontSize: "12px", fontWeight: 700, color: "#92400E", fontFamily: "Poppins, sans-serif" }}>{tl ? "Tinapos nang maaga" : "Ended early"}</Typography>
                        <Typography sx={{ fontSize: "14px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif", lineHeight: 1.35, overflowWrap: "anywhere" }}>
                          {earlyEndReasonLabel(trip.earlyEndReason, tl ? "tl" : "en")}
                        </Typography>
                        <Typography sx={{ fontSize: "12.5px", color: "#475569", fontFamily: "Poppins, sans-serif", lineHeight: 1.45 }}>
                          {trip.earlyEndKind === "SAFETY"
                            ? tl ? "Pansamantalang pamasahe habang hinihintay ang pagsusuri" : "Provisional fare until it is reviewed"
                            : trip.earlyEndKind === "DRIVER"
                            ? tl ? "Layong nalakbay lamang ang sinisingil" : "Only the distance travelled is charged"
                            : tl ? "Ang mas mataas sa pamasahe noong nag-book at sa layong nalakbay" : "The greater of the booked fare and the distance travelled"}
                        </Typography>
                      </Box>
                    )}

                    {fb?.resolution && (
                      <FareLine
                        label={tl ? "Pamasahe pagkatapos ng pagsusuri" : "Fare after review"}
                        detail={tl ? `Dati: ${formatPeso(fb.resolution.previous_fare)}` : `Before: ${formatPeso(fb.resolution.previous_fare)}`}
                        amount={formatPeso(fb.resolution.final_fare)}
                      />
                    )}
                  </Box>
                )}
              </Paper>
            )}

            {/* 5. Bi-directional Ratings & Feedback Section */}
            <Paper elevation={0} sx={{ ...cardSx, p: 2.5, display: "flex", flexDirection: "column", gap: 2 }}>
              <Typography component="h2" sx={{ fontSize: "14px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
                {language === "tl" ? "Mga Rating at Feedback" : "Ratings & Feedback"}
              </Typography>

              {/* Rating Given to Driver */}
              <Box>
                <Typography sx={{ fontSize: "12px", fontWeight: 700, color: "#64748B", mb: 1, fontFamily: "Poppins, sans-serif" }}>
                  {language === "tl" ? "Iyong rating sa drayber" : "Your rating to driver"}
                </Typography>

                {passengerRatingGiven ? (
                  <Box sx={{ p: 1.5, borderRadius: "14px", backgroundColor: "#F8FAFC", border: "1px solid #E2E8F0", display: "flex", flexDirection: "column", gap: 0.75 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Rating value={Number(passengerRatingGiven.stars) || 0} readOnly size="small" sx={{ color: "#FF6600" }} />
                      <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "#FF6600" }}>
                        {(Number(passengerRatingGiven.stars) || 0).toFixed(1)} / 5.0
                      </Typography>
                    </Box>
                    {passengerRatingGiven.tags && passengerRatingGiven.tags.length > 0 && (
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
                        {passengerRatingGiven.tags.map((tag: string) => (
                          <Chip key={tag} label={tag} size="small" sx={{ fontSize: "12px", backgroundColor: "#FFF8F0", color: "#FF6600", height: 22 }} />
                        ))}
                      </Box>
                    )}
                    {passengerRatingGiven.comment && (
                      <Typography sx={{ fontSize: "12px", color: "#475569", fontStyle: "italic", mt: 0.5 }}>
                        "{passengerRatingGiven.comment}"
                      </Typography>
                    )}
                  </Box>
                ) : (
                  <Typography sx={{ fontSize: "13px", color: "#64748B", fontStyle: "italic" }}>
                    {language === "tl" ? "Wala pang nabibigay na rating sa drayber" : "No rating given to driver yet"}
                  </Typography>
                )}
              </Box>

              <Divider sx={{ borderColor: "#F1F5F9" }} />

              {/* Rating Received from Driver */}
              <Box>
                <Typography sx={{ fontSize: "12px", fontWeight: 700, color: "#64748B", mb: 1, fontFamily: "Poppins, sans-serif" }}>
                  {language === "tl" ? "Rating mula sa drayber" : "Rating from driver"}
                </Typography>

                {driverRatingReceived ? (
                  <Box sx={{ p: 1.5, borderRadius: "14px", backgroundColor: "#F8FAFC", border: "1px solid #E2E8F0", display: "flex", flexDirection: "column", gap: 0.75 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Rating value={Number(driverRatingReceived.stars) || 0} readOnly size="small" sx={{ color: "#FF6600" }} />
                      <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "#FF6600" }}>
                        {(Number(driverRatingReceived.stars) || 0).toFixed(1)} / 5.0
                      </Typography>
                    </Box>
                    {driverRatingReceived.tags && driverRatingReceived.tags.length > 0 && (
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
                        {driverRatingReceived.tags.map((tag: string) => (
                          <Chip key={tag} label={tag} size="small" sx={{ fontSize: "12px", backgroundColor: "#FFF8F0", color: "#FF6600", height: 22 }} />
                        ))}
                      </Box>
                    )}
                    {driverRatingReceived.comment && (
                      <Typography sx={{ fontSize: "12px", color: "#475569", fontStyle: "italic", mt: 0.5 }}>
                        "{driverRatingReceived.comment}"
                      </Typography>
                    )}
                  </Box>
                ) : (
                  <Typography sx={{ fontSize: "13px", color: "#64748B", fontStyle: "italic" }}>
                    {language === "tl" ? "Wala pang naitatalang rating mula sa drayber" : "No rating received from driver yet"}
                  </Typography>
                )}
              </Box>
            </Paper>
          </>
        )}
      </Box>

      {/* Copy Toast */}
      {toastMessage && (
        <SakayToast message={toastMessage} onClose={() => setToastMessage(null)} />
      )}
    </Box>
  );
};

export default TripDetailPage;
