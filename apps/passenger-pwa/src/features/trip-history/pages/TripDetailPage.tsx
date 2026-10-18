import React from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Avatar from "@mui/material/Avatar";
import HeadsetMicOutlinedIcon from "@mui/icons-material/HeadsetMicOutlined";
import PlaceIcon from "@mui/icons-material/Place";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";

import Rating from "@mui/material/Rating";

import appIconImg from "@sakay/shared/src/assets/icons/app-icon-toto.webp";
import { formatShortBookingId, type FareBreakdown, activateWithKeyboard, FareLine, formatPeso, describePayment, earlyEndReasonLabel } from "@sakay/shared";
import PageHeader from "../../../common/components/PageHeader";
import SakayToast from "../../../common/components/SakayToast";
import { useLanguage } from "../../../utils/LanguageContext";
import { supabase } from "../../../services/supabaseClient";

export const TripDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ id: string }>();
  const { language } = useLanguage();

  const stateTrip = (location.state as { trip?: any })?.trip;

  const tripId = params.id || stateTrip?.id || "BKG-2026-8891";
  const dateString = stateTrip?.dateString || "22 Sep 2026";
  const timeString = stateTrip?.time || "07:49 PM";
  const pickupAddress = stateTrip?.pickup || "Rizal Ave, Batangas City, Batangas, Philippines";
  const dropoffAddress = stateTrip?.dropoff || "Batangas State University-Alangilan Campus";
  const driverName = stateTrip?.driverName || (language === "tl" ? "Walang drayber" : "No driver assigned");
  // The driver's number is shown only when the server gave it (while the trip is live); never an invented one.
  const driverPhone: string = stateTrip?.driverPhone || "";
  const price = stateTrip?.price || "₱110.00";
  const manilaTime = (iso: string) => new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });
  const status = stateTrip?.status || "Completed";

  const [toastMessage, setToastMessage] = React.useState<string | null>(null);
  const [passengerRatingGiven, setPassengerRatingGiven] = React.useState<any>(null);
  const [driverRatingReceived, setDriverRatingReceived] = React.useState<any>(null);

  React.useEffect(() => {
    let isMounted = true;
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

  const handleRebook = () => {
    sessionStorage.setItem(
      "trip_pickup",
      JSON.stringify({ address: pickupAddress, lat: 13.4124, lng: 121.1834 })
    );
    sessionStorage.setItem(
      "trip_dropoff",
      JSON.stringify({ address: dropoffAddress, lat: 13.4150, lng: 121.1810 })
    );
    navigate("/new-trip");
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
      {/* Reused Settings PageHeader */}
      <PageHeader
        title={language === "tl" ? "Detalyadong Biyahe" : "Trip Details"}
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
        {/* Main SAKAY Trip Card */}
        <Paper
          elevation={0}
          sx={{
            borderRadius: "20px",
            backgroundColor: "#FFFFFF",
            p: 2.5,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            border: "1px solid #F1F5F9",
            boxShadow: "0 4px 20px rgba(255, 102, 0, 0.05)",
          }}
        >
          {/* Status Badge */}
          <Chip
            label={status === "Completed" ? (language === "tl" ? "Nakumpleto" : "Completed") : status}
            sx={{
              backgroundColor: "#10B981",
              color: "#FFFFFF",
              fontWeight: 700,
              fontSize: "12px",
              height: "26px",
              px: 1,
              mb: 1,
            }}
          />

          <Typography sx={{ fontSize: "12px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
            Booking ID
          </Typography>
          <Typography
            role="button"
            tabIndex={0}
            onKeyDown={activateWithKeyboard}
            onClick={handleCopyTripId}
            sx={{
              fontSize: "14px",
              fontWeight: 700,
              color: "#0F172A",
              fontFamily: "Poppins, sans-serif",
              mb: 0.5,
              cursor: "pointer",
              "&:active": { opacity: 0.7 },
            }}
          >
            {formatShortBookingId(tripId)}
          </Typography>
          <Typography sx={{ fontSize: "12px", fontWeight: 600, color: "#64748B", fontFamily: "Poppins, sans-serif", mb: 2 }}>
            {dateString}, {timeString}
          </Typography>

          <Divider sx={{ width: "100%", borderColor: "#F1F5F9", mb: 2 }} />

          {/* Vehicle Info with App Icon */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, width: "100%", mb: 2 }}>
            <Box component="img" src={appIconImg} alt="SAKAY Tricycle" sx={{ width: 36, height: 36, objectFit: "contain" }} />
            <Box>
              <Typography sx={{ fontSize: "15px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
                SAKAY Tricycle Service
              </Typography>
              <Typography sx={{ fontSize: "12px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
                Official City Tariff Fare Rate
              </Typography>
            </Box>
          </Box>

          <Divider sx={{ width: "100%", borderColor: "#F1F5F9", borderStyle: "dashed", mb: 2 }} />

          {/* Pickup & Dropoff Route Timeline */}
          <Box sx={{ width: "100%", display: "flex", gap: 2, mb: 2 }}>
            {/* Timeline Graphic */}
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", pt: 0.5 }}>
              <RadioButtonUncheckedIcon sx={{ fontSize: 18, color: "#FF6600" }} />
              <Box
                sx={{
                  height: 38,
                  borderLeft: "2px dotted #FFD8BE",
                  my: 0.5,
                }}
              />
              <PlaceIcon sx={{ fontSize: 20, color: "#FF6600" }} />
            </Box>

            {/* Address Labels */}
            <Box sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 1.5 }}>
              <Box>
                <Typography sx={{ fontSize: "12px", fontWeight: 700, color: "#64748B", fontFamily: "Poppins, sans-serif", }}>
                  {language === "tl" ? "Pinanggalingan" : "Pickup location"}
                </Typography>
                <Typography sx={{ fontSize: "14px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif", lineHeight: 1.3 }}>
                  {pickupAddress}
                </Typography>
              </Box>

              <Box>
                <Typography sx={{ fontSize: "12px", fontWeight: 700, color: "#64748B", fontFamily: "Poppins, sans-serif", }}>
                  {language === "tl" ? "Destinasyon" : "Drop-off location"}
                </Typography>
                <Typography sx={{ fontSize: "14px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif", lineHeight: 1.3 }}>
                  {dropoffAddress}
                </Typography>
                <Typography sx={{ fontSize: "12px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
                  Calapan City, Oriental Mindoro
                </Typography>
              </Box>
            </Box>
          </Box>

          <Divider sx={{ width: "100%", borderColor: "#F1F5F9", mb: 2 }} />

          {/* Prominent Rebook Button */}
          <Button
            variant="contained"
            fullWidth
            onClick={handleRebook}
            sx={{
              backgroundColor: "#FF6600",
              color: "#FFFFFF",
              borderRadius: "14px",
              height: "48px",
              fontWeight: 700,
              fontSize: "15px",
              textTransform: "none",
              fontFamily: "Poppins, sans-serif",
              boxShadow: "0 4px 12px rgba(255, 102, 0, 0.2)",
              "&:hover": { backgroundColor: "#E65C00", boxShadow: "0 6px 16px rgba(255, 102, 0, 0.3)" },
              "&:active": { transform: "scale(0.98)" },
            }}
          >
            {language === "tl" ? "Muling Mag-book ng Biyahe" : "Rebook Ride"}
          </Button>
        </Paper>

        {/* SAKAY Fare Breakdown Section */}
        <Paper
          elevation={0}
          sx={{
            borderRadius: "20px",
            backgroundColor: "#FFFFFF",
            p: 2.5,
            border: "1px solid #F1F5F9",
            display: "flex",
            flexDirection: "column",
            gap: 1.5,
          }}
        >
          <Typography sx={{ fontSize: "14px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
            {language === "tl" ? "Kalkulasyon ng pamasahe" : "Fare breakdown"}
          </Typography>

          {(() => {
            // The lines come from the fare breakdown the database stored when the trip arrived (Rule 6.2);
            // nothing is derived here. Demo and older records have no breakdown, so only the total is shown.
            const fb = stateTrip?.fareBreakdown as FareBreakdown | null | undefined;
            const fin = fb?.final;
            if (!fb || !fin) return null;
            const money = formatPeso;
            const matched = fin.basis === "matched_estimate_pending_segments";
            const noteSx = { fontSize: "12px", color: "#64748B", fontFamily: "Poppins, sans-serif" } as const;
            return (
              <>
                <FareLine label={language === "tl" ? "Distansyang siningil" : "Distance billed"} amount={`${fin.billed_distance_km.toFixed(1)}\u00A0km`} />

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
              </>
            );
          })()}

          <Divider sx={{ borderColor: "#F1F5F9", my: 0.5 }} />

          <FareLine emphasis="total" label={language === "tl" ? "Kabuuan" : "Total fare"} amount={price} />
          {/* The database charges whole pesos (Rule 6.1.2): when the lines above differ from the total, say why in one quiet line */}
          {(stateTrip?.fareBreakdown as FareBreakdown | null | undefined)?.final?.components.adjustment ? (
            <Typography sx={{ fontSize: "12px", lineHeight: 1.4, color: "#64748B", fontFamily: "Poppins, sans-serif", textAlign: "right" }}>
              {language === "tl" ? "Buong piso ang singil ayon sa fare rule ng LGU." : "Charged in whole pesos under the LGU fare rule."}
            </Typography>
          ) : null}

          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", pt: 1, borderTop: "1px border-dashed #F1F5F9" }}>
            <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
              {language === "tl" ? "Paraan ng pagbayad" : "Pay using"}
            </Typography>
            <Chip
              label="₱ Cash"
              size="small"
              sx={{ backgroundColor: "#FF6600", color: "#FFFFFF", fontWeight: 700, fontSize: "12px", height: "26px" }}
            />
          </Box>

          {/* The receipt (Rules 16.2 / 18.3): the payment as the database recorded it, the moments, and how the trip ended. Nothing here is typed on a phone. */}
          {status === "Completed" && stateTrip?.paymentStatus && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, pt: 1.25, borderTop: "1px dashed #E2E8F0" }}>
              <FareLine label={language === "tl" ? "Resibo bilang" : "Receipt no."} amount={formatShortBookingId(tripId)} />
              <FareLine
                label={language === "tl" ? "Bayad" : "Payment"}
                amount={describePayment({ paymentStatus: stateTrip.paymentStatus, fareUnconfirmed: Boolean(stateTrip.fareUnconfirmed) }, language === "tl" ? "tl" : "en")}
              />
              {stateTrip.confirmFareAt && <FareLine label={language === "tl" ? "Kinumpirma ang pamasahe" : "Fare confirmed"} amount={manilaTime(stateTrip.confirmFareAt)} />}
              {stateTrip.paymentReceivedAt && <FareLine label={language === "tl" ? "Natanggap ang bayad" : "Payment received"} amount={manilaTime(stateTrip.paymentReceivedAt)} />}
              {stateTrip.tripCompletedAt && <FareLine label={language === "tl" ? "Natapos ang biyahe" : "Trip completed"} amount={manilaTime(stateTrip.tripCompletedAt)} />}
              {stateTrip.earlyEndKind && (
                <FareLine
                  label={language === "tl" ? "Tinapos nang maaga" : "Ended early"}
                  detail={
                    stateTrip.earlyEndKind === "SAFETY"
                      ? language === "tl" ? "Pansamantalang pamasahe habang hinihintay ang pagsusuri" : "Provisional fare until it is reviewed"
                      : stateTrip.earlyEndKind === "DRIVER"
                      ? language === "tl" ? "Layong nalakbay lamang ang sinisingil" : "Only the distance travelled is charged"
                      : language === "tl" ? "Ang mas mataas sa pamasahe noong nag-book at sa layong nalakbay" : "The greater of the booked fare and the distance travelled"
                  }
                  amount={earlyEndReasonLabel(stateTrip.earlyEndReason, language === "tl" ? "tl" : "en")}
                />
              )}
              {(stateTrip.fareBreakdown as FareBreakdown | null | undefined)?.resolution && (
                <FareLine
                  label={language === "tl" ? "Pamasahe pagkatapos ng pagsusuri" : "Fare after review"}
                  detail={language === "tl" ? `Dati: ${formatPeso((stateTrip.fareBreakdown as FareBreakdown).resolution!.previous_fare)}` : `Before: ${formatPeso((stateTrip.fareBreakdown as FareBreakdown).resolution!.previous_fare)}`}
                  amount={formatPeso((stateTrip.fareBreakdown as FareBreakdown).resolution!.final_fare)}
                />
              )}
            </Box>
          )}
        </Paper>

        {/* Driver Card & Actions */}
        <Paper
          elevation={0}
          sx={{
            borderRadius: "20px",
            backgroundColor: "#FFFFFF",
            p: 2,
            border: "1px solid #F1F5F9",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ width: 44, height: 44, backgroundColor: "#FF6600", color: "#FFFFFF", fontWeight: 700, fontSize: "16px" }}>
              {driverName.charAt(0)}
            </Avatar>
            <Box>
              <Typography sx={{ fontSize: "15px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
                {driverName}
              </Typography>
              <Typography sx={{ fontSize: "12px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
                {driverPhone || (language === "tl" ? "Hindi na ibinabahagi ang numero pagkatapos ng biyahe" : "The number is not shared after the trip")}
              </Typography>
            </Box>
          </Box>
        </Paper>

        {/* Bi-directional Ratings & Feedback Section */}
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

        {/* Bottom Report Issue Link */}
        <Box sx={{ textAlign: "center", pt: 0.5 }}>
          <Button
            startIcon={<HeadsetMicOutlinedIcon />}
            onClick={() => navigate("/incident-report", { state: { bookingId: tripId } })}
            sx={{
              color: "#FF6600",
              fontWeight: 700,
              fontSize: "14px",
              textTransform: "none",
              fontFamily: "Poppins, sans-serif",
              "&:hover": { backgroundColor: "#FFF7ED" },
            }}
          >
            {language === "tl" ? "I-ulat ang problema sa biyahe" : "Report a trip issue"}
          </Button>
        </Box>
      </Box>

      {/* Copy Toast */}
      {toastMessage && (
        <SakayToast message={toastMessage} onClose={() => setToastMessage(null)} />
      )}
    </Box>
  );
};

export default TripDetailPage;
