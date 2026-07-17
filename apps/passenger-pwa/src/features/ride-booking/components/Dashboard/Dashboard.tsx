import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Avatar from "@mui/material/Avatar";
import SearchIcon from "@mui/icons-material/Search";
import HomeIcon from "@mui/icons-material/Home";
import HistoryIcon from "@mui/icons-material/History";
import PersonIcon from "@mui/icons-material/Person";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import Paper from "@mui/material/Paper";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import StarIcon from "@mui/icons-material/Star";
import ExitToAppIcon from "@mui/icons-material/ExitToApp";
import { useLanguage } from "../../../../utils/LanguageContext";
import tricycleImg from "@sakay/shared/src/assets/icons/app-icon.png";

const Dashboard: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();

  // Retrieve user name from route state or default to Guest
  const state = location.state as { userName?: string };
  const userName = state?.userName || "Juan Dela Cruz";

  // Tab State
  const [activeTab, setActiveTab] = useState<"home" | "trips" | "profile">("home");

  const handleLogout = () => {
    navigate("/"); // Redirect back to the Splash Screen onboarding
  };

  return (
    <Box className="app-container">
      <Box
        component="main"
        className="phone-simulator hide-scrollbar"
        sx={{
          backgroundColor: "#F8FAFC",
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        {/* Render Tabs based on state */}
        {activeTab === "home" && (
          <Box sx={{ flexGrow: 1, padding: "24px 20px 80px 20px" }} className="anim-fade-in">
            {/* Top Bar / Profile Greeting */}
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: "20px",
              }}
            >
              <Box>
                <Typography sx={{ fontSize: "14px", color: "#64748B", fontWeight: 500 }}>
                  {language === "tl" ? "Magandang araw," : "Good day,"}
                </Typography>
                <Typography sx={{ fontSize: "20px", fontWeight: 800, color: "#0F172A" }}>
                  {userName}!
                </Typography>
              </Box>
              <Avatar
                sx={{
                  bgcolor: "#FF6B00",
                  fontWeight: 700,
                  width: "48px",
                  height: "48px",
                  boxShadow: "0 4px 10px rgba(255, 107, 0, 0.2)",
                }}
              >
                {userName.charAt(0).toUpperCase()}
              </Avatar>
            </Box>

            {/* Current Location Display Card */}
            <Paper
              elevation={0}
              sx={{
                marginTop: "24px",
                padding: "16px",
                borderRadius: "16px",
                border: "1px solid #E2E8F0",
                display: "flex",
                alignItems: "center",
                gap: "12px",
                backgroundColor: "#FFFFFF",
              }}
            >
              <Box
                sx={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "50%",
                  backgroundColor: "rgba(255, 107, 0, 0.1)",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <LocationOnIcon sx={{ color: "#FF6B00" }} />
              </Box>
              <Box>
                <Typography sx={{ fontSize: "12px", color: "#94A3B8", fontWeight: 600 }}>
                  {language === "tl" ? "KASALUKUYANG LOKASYON" : "CURRENT LOCATION"}
                </Typography>
                <Typography sx={{ fontSize: "14px", fontWeight: 700, color: "#334155" }}>
                  Calapan City, Oriental Mindoro
                </Typography>
              </Box>
            </Paper>

            {/* Banner Illustration */}
            <Box
              sx={{
                marginTop: "24px",
                padding: "20px",
                borderRadius: "20px",
                background: "linear-gradient(135deg, #FF6B00 0%, #FF8533 100%)",
                position: "relative",
                overflow: "hidden",
                color: "#FFFFFF",
                boxShadow: "0 10px 24px rgba(255, 107, 0, 0.15)",
              }}
            >
              <Typography sx={{ fontSize: "18px", fontWeight: 800, width: "60%", lineHeight: 1.3 }}>
                {language === "tl" ? "Mag-book ng Biyahe nang Mabilis!" : "Book a Tricycle Instantly!"}
              </Typography>
              <Typography sx={{ fontSize: "12px", opacity: 0.9, marginTop: "8px", width: "60%" }}>
                {language === "tl"
                  ? "Tapat na pamasahe, garantisadong drayber"
                  : "Fair fares, verified TODA drivers"}
              </Typography>
              <Box
                component="img"
                src={tricycleImg}
                alt="Tricycle"
                sx={{
                  position: "absolute",
                  right: "-20px",
                  bottom: "-10px",
                  width: "140px",
                  height: "auto",
                  transform: "rotate(-5deg)",
                }}
              />
            </Box>

            {/* Destination Search Section */}
            <Box sx={{ marginTop: "28px" }}>
              <Typography sx={{ fontSize: "16px", fontWeight: 800, color: "#0F172A", marginBottom: "12px" }}>
                {language === "tl" ? "Saan ang iyong biyahe?" : "Where to?"}
              </Typography>
              <TextField
                placeholder={language === "tl" ? "Maghanap ng destinasyon..." : "Search destination..."}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon sx={{ color: "#FF6B00" }} />
                      </InputAdornment>
                    ),
                    sx: {
                      height: "56px",
                      backgroundColor: "#FFFFFF",
                      borderRadius: "14px",
                      "& fieldset": { borderColor: "#E2E8F0" },
                      "&:hover fieldset": { borderColor: "#CBD5E1" },
                      "&.Mui-focused fieldset": { borderColor: "#FF6B00" },
                    },
                  },
                }}
              />
            </Box>

            {/* Favorites / Suggested List */}
            <Box sx={{ marginTop: "24px" }}>
              <Typography sx={{ fontSize: "14px", color: "#64748B", fontWeight: 700, marginBottom: "12px" }}>
                {language === "tl" ? "MGA SUGGESTED NA LUGAR" : "SUGGESTED PLACES"}
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {[
                  { name: "Calapan Public Market", desc: "San Vicente South, Calapan City" },
                  { name: "City Hall of Calapan", desc: "Guinobatan, Calapan City" },
                  { name: "Mindoro State University", desc: "Masipit, Calapan City" },
                ].map((place, idx) => (
                  <Box
                    key={idx}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "12px",
                      backgroundColor: "#FFFFFF",
                      borderRadius: "12px",
                      border: "1px solid #F1F5F9",
                      cursor: "pointer",
                      "&:hover": { backgroundColor: "#F8FAFC" },
                    }}
                  >
                    <Box
                      sx={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "50%",
                        backgroundColor: "#F1F5F9",
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                      }}
                    >
                      <StarIcon sx={{ color: "#FFB000", fontSize: "20px" }} />
                    </Box>
                    <Box>
                      <Typography sx={{ fontSize: "14px", fontWeight: 700, color: "#334155" }}>
                        {place.name}
                      </Typography>
                      <Typography sx={{ fontSize: "11px", color: "#94A3B8" }}>
                        {place.desc}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        )}

        {activeTab === "trips" && (
          <Box sx={{ flexGrow: 1, padding: "24px 20px 80px 20px" }} className="anim-fade-in">
            <Typography sx={{ fontSize: "22px", fontWeight: 800, color: "#0F172A", marginTop: "20px" }}>
              {language === "tl" ? "Mga Biyahe" : "Trips"}
            </Typography>
            <Typography sx={{ fontSize: "14px", color: "#64748B", marginTop: "4px" }}>
              {language === "tl" ? "Tingnan ang iyong mga nakaraang biyahe" : "Review your trip history"}
            </Typography>

            {/* Empty History State */}
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                marginTop: "100px",
                textAlign: "center",
              }}
            >
              <Box
                sx={{
                  width: "120px",
                  height: "120px",
                  borderRadius: "50%",
                  backgroundColor: "#FFFFFF",
                  border: "2px dashed #E2E8F0",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  marginBottom: "20px",
                }}
              >
                <HistoryIcon sx={{ fontSize: "48px", color: "#94A3B8" }} />
              </Box>
              <Typography sx={{ fontSize: "16px", fontWeight: 700, color: "#334155" }}>
                {language === "tl" ? "Walang Biyahe" : "No Trips Yet"}
              </Typography>
              <Typography sx={{ fontSize: "12px", color: "#94A3B8", marginTop: "8px", maxWidth: "200px" }}>
                {language === "tl"
                  ? "Makikita mo rito ang iyong mga nakaraang booking kapag sumakay ka na."
                  : "Your completed rides will appear here once you take a trip."}
              </Typography>
            </Box>
          </Box>
        )}

        {activeTab === "profile" && (
          <Box sx={{ flexGrow: 1, padding: "24px 20px 80px 20px" }} className="anim-fade-in">
            <Typography sx={{ fontSize: "22px", fontWeight: 800, color: "#0F172A", marginTop: "20px" }}>
              {language === "tl" ? "Profile at Account" : "Profile & Account"}
            </Typography>
            <Typography sx={{ fontSize: "14px", color: "#64748B", marginTop: "4px", marginBottom: "32px" }}>
              {language === "tl" ? "Pamahalaan ang iyong account" : "Manage your user account"}
            </Typography>

            <Box
              sx={{
                backgroundColor: "#FFFFFF",
                borderRadius: "16px",
                border: "1px solid #E2E8F0",
                padding: "20px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
              }}
            >
              <Avatar
                sx={{
                  bgcolor: "#FF6B00",
                  fontWeight: 700,
                  width: "72px",
                  height: "72px",
                  fontSize: "28px",
                  boxShadow: "0 6px 14px rgba(255, 107, 0, 0.2)",
                  marginBottom: "16px",
                }}
              >
                {userName.charAt(0).toUpperCase()}
              </Avatar>
              <Typography sx={{ fontSize: "18px", fontWeight: 800, color: "#0F172A" }}>
                {userName}
              </Typography>
              <Typography sx={{ fontSize: "13px", color: "#94A3B8", marginTop: "4px" }}>
                {language === "tl" ? "Passenger Account" : "Passenger Account"}
              </Typography>

              {/* Logout Button */}
              <Button
                variant="outlined"
                color="error"
                onClick={handleLogout}
                startIcon={<ExitToAppIcon />}
                sx={{
                  marginTop: "32px",
                  width: "100%",
                  height: "48px",
                  borderRadius: "12px",
                  textTransform: "none",
                  fontWeight: 700,
                  borderColor: "#EF4444",
                  color: "#EF4444",
                  "&:hover": {
                    backgroundColor: "rgba(239, 68, 68, 0.05)",
                    borderColor: "#DC2626",
                  },
                }}
              >
                {language === "tl" ? "Mag-log Out" : "Log Out"}
              </Button>
            </Box>
          </Box>
        )}

        {/* Fixed Bottom Tab Navigation */}
        <Box
          sx={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "72px",
            backgroundColor: "#FFFFFF",
            borderTop: "1px solid #E2E8F0",
            display: "flex",
            justifyContent: "space-around",
            alignItems: "center",
            zIndex: 10,
          }}
        >
          <Box
            onClick={() => setActiveTab("home")}
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              cursor: "pointer",
              color: activeTab === "home" ? "#FF6B00" : "#94A3B8",
              gap: "4px",
            }}
          >
            <HomeIcon sx={{ fontSize: "24px" }} />
            <Typography sx={{ fontSize: "11px", fontWeight: 700 }}>
              {language === "tl" ? "Home" : "Home"}
            </Typography>
          </Box>

          <Box
            onClick={() => setActiveTab("trips")}
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              cursor: "pointer",
              color: activeTab === "trips" ? "#FF6B00" : "#94A3B8",
              gap: "4px",
            }}
          >
            <HistoryIcon sx={{ fontSize: "24px" }} />
            <Typography sx={{ fontSize: "11px", fontWeight: 700 }}>
              {language === "tl" ? "Biyahe" : "Trips"}
            </Typography>
          </Box>

          <Box
            onClick={() => setActiveTab("profile")}
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              cursor: "pointer",
              color: activeTab === "profile" ? "#FF6B00" : "#94A3B8",
              gap: "4px",
            }}
          >
            <PersonIcon sx={{ fontSize: "24px" }} />
            <Typography sx={{ fontSize: "11px", fontWeight: 700 }}>
              {language === "tl" ? "Profile" : "Profile"}
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default Dashboard;
