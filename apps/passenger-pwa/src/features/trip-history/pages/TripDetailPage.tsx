import React from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Avatar from "@mui/material/Avatar";
import CloseIcon from "@mui/icons-material/Close";
import ChatOutlinedIcon from "@mui/icons-material/ChatOutlined";
import HeadsetMicOutlinedIcon from "@mui/icons-material/HeadsetMicOutlined";
import PlaceIcon from "@mui/icons-material/Place";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";

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

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        backgroundColor: "#EBF5FB",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {/* Cyan/Teal Header Bar matching Angkas */}
      <Box
        sx={{
          backgroundColor: "#00A3E0",
          pt: "calc(var(--safe-area-top) + 12px)",
          pb: 1.5,
          px: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          color: "#FFFFFF",
          flexShrink: 0,
        }}
      >
        <IconButton
          onClick={() => navigate("/history")}
          sx={{ color: "#FFFFFF", padding: 0.5 }}
        >
          <CloseIcon sx={{ fontSize: 24 }} />
        </IconButton>

        <Typography
          sx={{
            fontSize: "15px",
            fontWeight: 700,
            fontFamily: "Poppins, sans-serif",
          }}
        >
          {dateString}, {timeString}
        </Typography>

        <Box sx={{ width: 32 }} />
      </Box>

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
        {/* Main Angkas-Style Card */}
        <Paper
          elevation={0}
          sx={{
            borderRadius: "24px",
            backgroundColor: "#FFFFFF",
            p: 2.5,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            boxShadow: "0 4px 20px rgba(0, 163, 224, 0.08)",
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
              mb: 2,
            }}
          >
            {tripId}
          </Typography>

          <Divider sx={{ width: "100%", borderColor: "#F1F5F9", mb: 2 }} />

          {/* Vehicle Info */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, width: "100%", mb: 2 }}>
            <Typography sx={{ fontSize: "24px" }}>🛺</Typography>
            <Typography sx={{ fontSize: "16px", fontWeight: 800, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
              {language === "tl" ? "Tricycle Service" : "Tricycle"}
            </Typography>
          </Box>

          <Divider sx={{ width: "100%", borderColor: "#F1F5F9", borderStyle: "dashed", mb: 2 }} />

          {/* Pickup & Dropoff Route Timeline */}
          <Box sx={{ width: "100%", display: "flex", gap: 2, mb: 2 }}>
            {/* Timeline Graphic */}
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", pt: 0.5 }}>
              <RadioButtonUncheckedIcon sx={{ fontSize: 18, color: "#94A3B8" }} />
              <Box
                sx={{
                  height: 38,
                  borderLeft: "2px dotted #CBD5E1",
                  my: 0.5,
                }}
              />
              <PlaceIcon sx={{ fontSize: 20, color: "#94A3B8" }} />
            </Box>

            {/* Address Labels */}
            <Box sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 1.5 }}>
              <Box>
                <Typography sx={{ fontSize: "14px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif", lineHeight: 1.3 }}>
                  {pickupAddress}
                </Typography>
              </Box>

              <Box>
                <Typography sx={{ fontSize: "14px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif", lineHeight: 1.3 }}>
                  {dropoffAddress}
                </Typography>
                <Typography sx={{ fontSize: "11.5px", color: "#94A3B8", fontFamily: "Poppins, sans-serif" }}>
                  Calapan City, Oriental Mindoro
                </Typography>
              </Box>
            </Box>
          </Box>

          <Divider sx={{ width: "100%", borderColor: "#F1F5F9", mb: 1.5 }} />

          {/* Rebook Button */}
          <Button
            onClick={handleRebook}
            sx={{
              color: "#00A3E0",
              fontWeight: 800,
              fontSize: "15px",
              textTransform: "none",
              fontFamily: "Poppins, sans-serif",
            }}
          >
            {language === "tl" ? "Muling mag-book" : "Rebook"}
          </Button>
        </Paper>

        {/* Breakdown List Section */}
        <Box sx={{ px: 1, display: "flex", flexDirection: "column", gap: 1.25 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Typography sx={{ fontSize: "13.5px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
              Standard Fare (w/ Cash Discount)
            </Typography>
            <Typography sx={{ fontSize: "14px", fontWeight: 600, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
              ₱78.00
            </Typography>
          </Box>

          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Typography sx={{ fontSize: "13.5px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
                Add-ons
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Typography sx={{ fontSize: "14px", fontWeight: 600, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
                ₱5.00
              </Typography>
              <KeyboardArrowDownIcon sx={{ fontSize: 18, color: "#00A3E0" }} />
            </Box>
          </Box>

          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Typography sx={{ fontSize: "13.5px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
              Tip
            </Typography>
            <Typography sx={{ fontSize: "14px", fontWeight: 600, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
              ₱27.00
            </Typography>
          </Box>

          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", pt: 0.5 }}>
            <Typography sx={{ fontSize: "15px", fontWeight: 800, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
              Total Fare
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <AccountBalanceWalletIcon sx={{ color: "#00A3E0", fontSize: 20 }} />
              <Typography sx={{ fontSize: "17px", fontWeight: 900, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
                {price}
              </Typography>
            </Box>
          </Box>
        </Box>

        <Divider sx={{ borderColor: "#CBD5E1", my: 1 }} />

        {/* Driver Card & Actions */}
        <Box sx={{ px: 1, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ width: 44, height: 44, backgroundColor: "#00A3E0", fontWeight: 800, fontSize: "16px" }}>
              {driverName.charAt(0)}
            </Avatar>
            <Typography sx={{ fontSize: "14.5px", fontWeight: 800, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
              {driverName}
            </Typography>
          </Box>

          <Button
            variant="outlined"
            startIcon={<ChatOutlinedIcon />}
            onClick={() => navigate("/support")}
            sx={{
              borderRadius: "999px",
              borderColor: "#00A3E0",
              color: "#00A3E0",
              fontSize: "12.5px",
              fontWeight: 700,
              textTransform: "none",
              fontFamily: "Poppins, sans-serif",
              px: 2,
              py: 0.75,
            }}
          >
            {language === "tl" ? "Chat History" : "Chat History"}
          </Button>
        </Box>

        <Divider sx={{ borderColor: "#CBD5E1", my: 1 }} />

        {/* Bottom Report Issue Link */}
        <Box sx={{ textAlign: "center", pt: 0.5 }}>
          <Button
            startIcon={<HeadsetMicOutlinedIcon />}
            onClick={() => navigate("/incident-report", { state: { bookingId: tripId } })}
            sx={{
              color: "#00A3E0",
              fontWeight: 700,
              fontSize: "14px",
              textTransform: "none",
              fontFamily: "Poppins, sans-serif",
            }}
          >
            {language === "tl" ? "I-ulat ang problema" : "Report an issue"}
          </Button>
        </Box>
      </Box>
    </Box>
  );
};

export default TripDetailPage;
