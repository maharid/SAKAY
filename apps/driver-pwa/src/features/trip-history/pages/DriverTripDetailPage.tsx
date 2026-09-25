import React, { useState, useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Avatar from "@mui/material/Avatar";
import Rating from "@mui/material/Rating";
import ChatOutlinedIcon from "@mui/icons-material/ChatOutlined";
import PhoneOutlinedIcon from "@mui/icons-material/PhoneOutlined";
import PlaceIcon from "@mui/icons-material/Place";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import StarIcon from "@mui/icons-material/Star";

import appIconImg from "@sakay/shared/src/assets/icons/app-icon-toto.webp";
import { formatShortBookingId } from "@sakay/shared";
import PageHeader from "../../../common/components/PageHeader";
import SakayToast from "../../../common/components/SakayToast";
import { useLanguage } from "../../../utils/LanguageContext";
import { supabase } from "../../../services/supabaseClient";
import { DriverFeedbackModal } from "../../feedback/components/DriverFeedbackModal";

export const DriverTripDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ id: string }>();
  const { language } = useLanguage();

  const stateTrip = (location.state as { trip?: any })?.trip;

  const rawTripId = params.id || stateTrip?.id || stateTrip?.bookingCode || "BKG-DEMO-001";
  const passengerName = stateTrip?.passengerName || stateTrip?.passenger_name || "Juan Dela Cruz";
  const passengerPhone = stateTrip?.passengerPhone || stateTrip?.passenger_phone || "+63 917 123 4567";
  const pickupAddress = stateTrip?.pickupLocation || stateTrip?.pickup || "Rizal Ave, Batangas City, Batangas, Philippines";
  const dropoffAddress = stateTrip?.dropoffLocation || stateTrip?.dropoff || "Batangas State University-Alangilan Campus";
  const dateString = stateTrip?.date || "22 Sep 2026";
  const timeString = stateTrip?.time || "07:49 PM";
  const fareAmount = Number(stateTrip?.fareAmount || stateTrip?.actual_fare || stateTrip?.estimated_fare || 60);
  const tripMode = stateTrip?.tripMode || (stateTrip?.is_shared_trip ? "Shared Ride" : "Solo Trip");
  const distanceKm = Number(stateTrip?.distanceKm || stateTrip?.estimated_distance_km || 2.4);

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

  const handleOpenSMS = () => {
    window.location.href = `sms:${passengerPhone}`;
  };

  const handleCallPassenger = () => {
    window.location.href = `tel:${passengerPhone}`;
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
        title={language === "tl" ? "Detalyadong Biyahe" : "Trip Details"}
        onBack={() => navigate(-1)}
      />

      {/* Scrollable Content */}
      <Box
        className="hide-scrollbar"
        sx={{
          flex: 1,
          overflowY: "auto",
          p: 2,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          pb: "calc(var(--safe-area-bottom) + 24px)",
        }}
      >
        {/* Main Trip Overview Card */}
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
            boxShadow: "0 4px 20px rgba(255, 107, 0, 0.05)",
          }}
        >
          <Chip
            label={language === "tl" ? "Nakumpleto" : "Completed"}
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

          <Typography sx={{ fontSize: "12px", color: "#94A3B8", fontFamily: "Poppins, sans-serif" }}>
            Booking ID
          </Typography>
          <Typography
            onClick={handleCopyTripId}
            sx={{
              fontSize: "14px",
              fontWeight: 800,
              color: "#0F172A",
              fontFamily: "Poppins, sans-serif",
              mb: 0.5,
              cursor: "pointer",
              "&:active": { opacity: 0.7 },
            }}
          >
            {formatShortBookingId(rawTripId)}
          </Typography>
          <Typography sx={{ fontSize: "12px", fontWeight: 600, color: "#64748B", fontFamily: "Poppins, sans-serif", mb: 2 }}>
            {dateString}{timeString ? `, ${timeString}` : ""}
          </Typography>

          <Divider sx={{ width: "100%", borderColor: "#F1F5F9", mb: 2 }} />

          {/* Vehicle Info */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, width: "100%", mb: 2 }}>
            <Box component="img" src={appIconImg} alt="SAKAY Tricycle" sx={{ width: 36, height: 36, objectFit: "contain" }} />
            <Box>
              <Typography sx={{ fontSize: "15px", fontWeight: 800, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
                SAKAY Tricycle Service
              </Typography>
              <Typography sx={{ fontSize: "12px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
                {tripMode === "Shared Ride" ? (language === "tl" ? "Shared Commuter Mode" : "Shared Ride Mode") : (language === "tl" ? "Solo Trip Mode" : "Solo Trip Mode")}
              </Typography>
            </Box>
          </Box>

          <Divider sx={{ width: "100%", borderColor: "#F1F5F9", borderStyle: "dashed", mb: 2 }} />

          {/* Pickup & Dropoff Route Timeline (Requirement 5) */}
          <Box sx={{ width: "100%", display: "flex", gap: 2, mb: 1 }}>
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", pt: 0.5 }}>
              {/* Pickup location orange circle marker */}
              <RadioButtonUncheckedIcon sx={{ fontSize: 18, color: "#FF6B00", stroke: "#FF6B00", strokeWidth: 1.5 }} />
              <Box
                sx={{
                  height: 38,
                  borderLeft: "2px dotted #FFD8BE",
                  my: 0.5,
                }}
              />
              {/* Dropoff location orange pin icon */}
              <PlaceIcon sx={{ fontSize: 20, color: "#FF6B00" }} />
            </Box>

            <Box sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 1.5 }}>
              <Box>
                <Typography sx={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", fontFamily: "Poppins, sans-serif", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  {language === "tl" ? "PINANGGALINGAN (PICKUP)" : "PICKUP LOCATION"}
                </Typography>
                <Typography sx={{ fontSize: "13.5px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif", lineHeight: 1.3 }}>
                  {pickupAddress}
                </Typography>
              </Box>

              <Box>
                <Typography sx={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", fontFamily: "Poppins, sans-serif", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  {language === "tl" ? "DESTINASYON (DROP-OFF)" : "DROP-OFF LOCATION"}
                </Typography>
                <Typography sx={{ fontSize: "13.5px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif", lineHeight: 1.3 }}>
                  {dropoffAddress}
                </Typography>
                <Typography sx={{ fontSize: "11.5px", color: "#94A3B8", fontFamily: "Poppins, sans-serif" }}>
                  Calapan City, Oriental Mindoro {distanceKm > 0 ? `• ${distanceKm} km` : ""}
                </Typography>
              </Box>
            </Box>
          </Box>
        </Paper>

        {/* Passenger Info Card */}
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
            <Avatar sx={{ width: 44, height: 44, backgroundColor: "#FF6B00", fontWeight: 800, fontSize: "16px" }}>
              {passengerName.charAt(0)}
            </Avatar>
            <Box>
              <Typography sx={{ fontSize: "14.5px", fontWeight: 800, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
                {passengerName}
              </Typography>
              <Typography sx={{ fontSize: "11.5px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
                {passengerPhone}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: "flex", gap: 1 }}>
            <IconButton onClick={handleCallPassenger} sx={{ backgroundColor: "#E6F4EA", color: "#1E8E3E" }}>
              <PhoneOutlinedIcon fontSize="small" />
            </IconButton>
            <IconButton onClick={handleOpenSMS} sx={{ backgroundColor: "#FFF8F0", color: "#FF6B00" }}>
              <ChatOutlinedIcon fontSize="small" />
            </IconButton>
          </Box>
        </Paper>

        {/* Driver Earnings Breakdown Card */}
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
          <Typography sx={{ fontSize: "14px", fontWeight: 800, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
            {language === "tl" ? "Kabuuan ng Kita sa Biyahe" : "Trip Earnings Breakdown"}
          </Typography>

          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Typography sx={{ fontSize: "13.5px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
              {language === "tl" ? "Uri ng Biyahe" : "Trip Mode"}
            </Typography>
            <Chip
              label={tripMode}
              size="small"
              sx={{ backgroundColor: tripMode.includes("Shared") ? "#E6F4EA" : "#FFF8F0", color: tripMode.includes("Shared") ? "#1E8E3E" : "#FF6B00", fontWeight: 700, fontSize: "11px" }}
            />
          </Box>

          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Typography sx={{ fontSize: "13.5px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
              {language === "tl" ? "Distansya" : "Distance"}
            </Typography>
            <Typography sx={{ fontSize: "14px", fontWeight: 600, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
              {distanceKm.toFixed(1)} km
            </Typography>
          </Box>

          <Divider sx={{ borderColor: "#F1F5F9", my: 0.5 }} />

          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Typography sx={{ fontSize: "15px", fontWeight: 800, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
              {language === "tl" ? "Kabuuang Nakolekta (Gross)" : "Gross Fare Collected"}
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <AccountBalanceWalletIcon sx={{ color: "#10B981", fontSize: 20 }} />
              <Typography sx={{ fontSize: "18px", fontWeight: 900, color: "#10B981", fontFamily: "Poppins, sans-serif" }}>
                ₱{fareAmount.toFixed(2)}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", pt: 1, borderTop: "1px border-dashed #F1F5F9" }}>
            <Typography sx={{ fontSize: "12.5px", fontWeight: 700, color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
              {language === "tl" ? "Paraan ng Pagbayad" : "Payment Method"}
            </Typography>
            <Chip
              label="₱ Cash"
              size="small"
              sx={{ backgroundColor: "#FF6B00", color: "#FFFFFF", fontWeight: 800, fontSize: "12px", height: "26px" }}
            />
          </Box>
        </Paper>

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
          <Typography sx={{ fontSize: "14px", fontWeight: 800, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
            {language === "tl" ? "Mga Rating at Feedback" : "Ratings & Feedback"}
          </Typography>

          {/* Rating Received from Passenger */}
          <Box>
            <Typography sx={{ fontSize: "12px", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.5px", mb: 1, fontFamily: "Poppins, sans-serif" }}>
              {language === "tl" ? "RATING MULA SA PASAHERO" : "RATING FROM PASSENGER"}
            </Typography>

            {passengerRatingReceived ? (
              <Box sx={{ p: 1.5, borderRadius: "14px", backgroundColor: "#F8FAFC", border: "1px solid #E2E8F0", display: "flex", flexDirection: "column", gap: 0.75 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Rating value={passengerRatingReceived.stars || 5} readOnly size="small" sx={{ color: "#FF6B00" }} />
                  <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "#FF6B00" }}>
                    {(passengerRatingReceived.stars || 5).toFixed(1)} / 5.0
                  </Typography>
                </Box>
                {passengerRatingReceived.tags && passengerRatingReceived.tags.length > 0 && (
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
                    {passengerRatingReceived.tags.map((tag: string) => (
                      <Chip key={tag} label={tag} size="small" sx={{ fontSize: "11px", backgroundColor: "#FFF8F0", color: "#FF6B00", height: 22 }} />
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
              <Typography sx={{ fontSize: "12.5px", color: "#94A3B8", fontStyle: "italic" }}>
                {language === "tl" ? "Wala pang naitatalang rating mula sa pasahero" : "No rating received from passenger yet"}
              </Typography>
            )}
          </Box>

          <Divider sx={{ borderColor: "#F1F5F9" }} />

          {/* Rating Given to Passenger */}
          <Box>
            <Typography sx={{ fontSize: "12px", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.5px", mb: 1, fontFamily: "Poppins, sans-serif" }}>
              {language === "tl" ? "IYONG RATING SA PASAHERO" : "YOUR RATING TO PASSENGER"}
            </Typography>

            {driverRatingGiven ? (
              <Box sx={{ p: 1.5, borderRadius: "14px", backgroundColor: "#F8FAFC", border: "1px solid #E2E8F0", display: "flex", flexDirection: "column", gap: 0.75 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Rating value={driverRatingGiven.stars || driverRatingGiven.rating || 5} readOnly size="small" sx={{ color: "#FF6B00" }} />
                  <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "#FF6B00" }}>
                    {(driverRatingGiven.stars || driverRatingGiven.rating || 5).toFixed(1)} / 5.0
                  </Typography>
                </Box>
                {driverRatingGiven.tags && driverRatingGiven.tags.length > 0 && (
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
                    {driverRatingGiven.tags.map((tag: string) => (
                      <Chip key={tag} label={tag} size="small" sx={{ fontSize: "11px", backgroundColor: "#FFF8F0", color: "#FF6B00", height: 22 }} />
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
                  borderColor: "#FF6B00",
                  color: "#FF6B00",
                  fontSize: "12.5px",
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
