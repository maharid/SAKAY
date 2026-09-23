import React from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Avatar from "@mui/material/Avatar";
import ChatOutlinedIcon from "@mui/icons-material/ChatOutlined";
import HeadsetMicOutlinedIcon from "@mui/icons-material/HeadsetMicOutlined";
import PlaceIcon from "@mui/icons-material/Place";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";

import appIconImg from "@sakay/shared/src/assets/icons/app-icon-toto.webp";
import PageHeader from "../../../common/components/PageHeader";
import { useLanguage } from "../../../utils/LanguageContext";

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
  const driverName = stateTrip?.driverName || "Aurelio Bautista";
  const driverPhone = stateTrip?.driverPhone || "+639171234567";
  const price = stateTrip?.price || "₱110.00";
  const status = stateTrip?.status || "Completed";

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

  const handleOpenSMS = () => {
    window.location.href = `sms:${driverPhone}`;
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
            boxShadow: "0 4px 20px rgba(255, 107, 0, 0.05)",
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

          <Typography sx={{ fontSize: "12px", color: "#94A3B8", fontFamily: "Poppins, sans-serif" }}>
            Booking ID
          </Typography>
          <Typography
            sx={{
              fontSize: "14px",
              fontWeight: 800,
              color: "#0F172A",
              fontFamily: "Poppins, sans-serif",
              mb: 0.5,
            }}
          >
            {tripId}
          </Typography>
          <Typography sx={{ fontSize: "12px", fontWeight: 600, color: "#64748B", fontFamily: "Poppins, sans-serif", mb: 2 }}>
            {dateString}, {timeString}
          </Typography>

          <Divider sx={{ width: "100%", borderColor: "#F1F5F9", mb: 2 }} />

          {/* Vehicle Info with App Icon */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, width: "100%", mb: 2 }}>
            <Box component="img" src={appIconImg} alt="SAKAY Tricycle" sx={{ width: 36, height: 36, objectFit: "contain" }} />
            <Box>
              <Typography sx={{ fontSize: "15px", fontWeight: 800, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
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
              <RadioButtonUncheckedIcon sx={{ fontSize: 18, color: "#FF6B00" }} />
              <Box
                sx={{
                  height: 38,
                  borderLeft: "2px dotted #FFD8BE",
                  my: 0.5,
                }}
              />
              <PlaceIcon sx={{ fontSize: 20, color: "#FF6B00" }} />
            </Box>

            {/* Address Labels */}
            <Box sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 1.5 }}>
              <Box>
                <Typography sx={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", fontFamily: "Poppins, sans-serif", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  {language === "tl" ? "PINANGGALINGAN" : "PICKUP LOCATION"}
                </Typography>
                <Typography sx={{ fontSize: "13.5px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif", lineHeight: 1.3 }}>
                  {pickupAddress}
                </Typography>
              </Box>

              <Box>
                <Typography sx={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", fontFamily: "Poppins, sans-serif", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  {language === "tl" ? "DESTINASYON" : "DROP-OFF LOCATION"}
                </Typography>
                <Typography sx={{ fontSize: "13.5px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif", lineHeight: 1.3 }}>
                  {dropoffAddress}
                </Typography>
                <Typography sx={{ fontSize: "11.5px", color: "#94A3B8", fontFamily: "Poppins, sans-serif" }}>
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
              backgroundColor: "#FF6B00",
              color: "#FFFFFF",
              borderRadius: "14px",
              height: "48px",
              fontWeight: 800,
              fontSize: "15px",
              textTransform: "none",
              fontFamily: "Poppins, sans-serif",
              boxShadow: "0 4px 12px rgba(255, 107, 0, 0.2)",
              "&:hover": { backgroundColor: "#E66000", boxShadow: "0 6px 16px rgba(255, 107, 0, 0.3)" },
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
          <Typography sx={{ fontSize: "14px", fontWeight: 800, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
            {language === "tl" ? "Kalkulasyon ng Pamasahe" : "Fare Breakdown"}
          </Typography>

          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Typography sx={{ fontSize: "13.5px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
              {language === "tl" ? "Unang 2.0 km (Base Fare)" : "Base Fare (First 2.0 km)"}
            </Typography>
            <Typography sx={{ fontSize: "14px", fontWeight: 600, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
              ₱20.00
            </Typography>
          </Box>

          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Typography sx={{ fontSize: "13.5px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
              {language === "tl" ? "Dagdag na Distansya" : "Distance Charge"}
            </Typography>
            <Typography sx={{ fontSize: "14px", fontWeight: 600, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
              ₱{Math.max(0, (parseFloat(price.replace(/[^0-9.]/g, "")) || 35) - 20).toFixed(2)}
            </Typography>
          </Box>

          <Divider sx={{ borderColor: "#F1F5F9", my: 0.5 }} />

          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Typography sx={{ fontSize: "15px", fontWeight: 800, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
              {language === "tl" ? "Kabuuan" : "Total Fare"}
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <AccountBalanceWalletIcon sx={{ color: "#FF6B00", fontSize: 20 }} />
              <Typography sx={{ fontSize: "18px", fontWeight: 900, color: "#FF6B00", fontFamily: "Poppins, sans-serif" }}>
                {price}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", pt: 1, borderTop: "1px border-dashed #F1F5F9" }}>
            <Typography sx={{ fontSize: "12.5px", fontWeight: 700, color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
              {language === "tl" ? "Paraan ng Pagbayad" : "Pay Using"}
            </Typography>
            <Chip
              label="₱ Cash"
              size="small"
              sx={{ backgroundColor: "#FF6B00", color: "#FFFFFF", fontWeight: 800, fontSize: "12px", height: "26px" }}
            />
          </Box>
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
            <Avatar sx={{ width: 44, height: 44, backgroundColor: "#FF6B00", fontWeight: 800, fontSize: "16px" }}>
              {driverName.charAt(0)}
            </Avatar>
            <Box>
              <Typography sx={{ fontSize: "14.5px", fontWeight: 800, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
                {driverName}
              </Typography>
              <Typography sx={{ fontSize: "11.5px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
                {driverPhone}
              </Typography>
            </Box>
          </Box>

          <Button
            variant="outlined"
            startIcon={<ChatOutlinedIcon />}
            onClick={handleOpenSMS}
            sx={{
              borderRadius: "999px",
              borderColor: "#FF6B00",
              color: "#FF6B00",
              fontSize: "12.5px",
              fontWeight: 700,
              textTransform: "none",
              fontFamily: "Poppins, sans-serif",
              px: 2,
              py: 0.75,
              "&:hover": { borderColor: "#E66000", backgroundColor: "#FFF7ED" },
            }}
          >
            {language === "tl" ? "Mag-SMS" : "SMS Driver"}
          </Button>
        </Paper>

        {/* Bottom Report Issue Link */}
        <Box sx={{ textAlign: "center", pt: 0.5 }}>
          <Button
            startIcon={<HeadsetMicOutlinedIcon />}
            onClick={() => navigate("/incident-report", { state: { bookingId: tripId } })}
            sx={{
              color: "#FF6B00",
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
    </Box>
  );
};

export default TripDetailPage;
