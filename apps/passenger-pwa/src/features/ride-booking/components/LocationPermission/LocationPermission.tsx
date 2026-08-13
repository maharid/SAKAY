import React from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";

import MapView from "../../../../common/components/MapView";
import HomeHeader from "../Dashboard/HomeHeader";

const LocationPermission: React.FC = () => {
  const navigate = useNavigate();

  const handleAllowOnce = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          localStorage.setItem("user_lat", position.coords.latitude.toString());
          localStorage.setItem("user_lng", position.coords.longitude.toString());
          navigate("/new-trip", { state: { hasGps: true } });
        },
        () => {
          navigate("/new-trip", { state: { hasGps: false } });
        }
      );
    } else {
      navigate("/new-trip", { state: { hasGps: false } });
    }
  };

  const handleAllowWhileUsing = () => {
    localStorage.setItem("gps_permission", "true");
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          localStorage.setItem("user_lat", position.coords.latitude.toString());
          localStorage.setItem("user_lng", position.coords.longitude.toString());
          navigate("/new-trip", { state: { hasGps: true } });
        },
        () => {
          navigate("/new-trip", { state: { hasGps: false } });
        }
      );
    } else {
      navigate("/new-trip", { state: { hasGps: false } });
    }
  };

  const handleDeny = () => {
    localStorage.setItem("gps_permission", "false");
    navigate("/new-trip", { state: { hasGps: false } });
  };

  return (
    <Box className="app-container">
      <Box
        component="main"
        className="phone-simulator hide-scrollbar"
        sx={{
          backgroundColor: "#E3ECEF",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          userSelect: "none",
          overflow: "hidden",
        }}
      >
        {/* Background Google Map */}
        <MapView interactive={false} />

        {/* Home Header Controls behind overlay */}
        <HomeHeader
          onOpenDrawer={() => {}}
          onOpenNotifications={() => {}}
          onOpenTulong={() => {}}
        />

        {/* Dark translucent overlay backdrop */}
        <Box
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.4)",
            backdropFilter: "blur(2px)",
            zIndex: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          {/* Permission Modal Card matching PASSENGER LOCATION PERMISSION.png */}
          <Paper
            elevation={8}
            sx={{
              width: "100%",
              maxWidth: "320px",
              backgroundColor: "#FFFFFF",
              borderRadius: "24px",
              overflow: "hidden",
              textAlign: "center",
              boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
            }}
          >
            {/* Modal Title & Description */}
            <Box sx={{ padding: "24px 20px 20px 20px" }}>
              <Typography
                sx={{
                  fontSize: "17px",
                  fontWeight: 800,
                  color: "#0F172A",
                  lineHeight: 1.3,
                  marginBottom: "12px",
                  fontFamily: "Poppins, sans-serif",
                }}
              >
                Payagan ang “SAKAY” na gamitin ang iyong lokasyon?
              </Typography>
              <Typography
                sx={{
                  fontSize: "13px",
                  fontWeight: 400,
                  color: "#475569",
                  lineHeight: 1.5,
                  fontFamily: "Poppins, sans-serif",
                }}
              >
                Ginagamit ang iyong lokasyon para makahanap ng malapit na drayber at masubaybayan ang iyong biyahe.
              </Typography>
            </Box>

            <Divider sx={{ borderColor: "#E2E8F0" }} />

            {/* Action Option 1: Payagan nang isang beses */}
            <Button
              fullWidth
              onClick={handleAllowOnce}
              sx={{
                padding: "14px 16px",
                color: "#0F172A",
                fontWeight: 600,
                fontSize: "14px",
                textTransform: "none",
                fontFamily: "Poppins, sans-serif",
                borderRadius: 0,
                "&:hover": { backgroundColor: "#F8FAFC" },
              }}
            >
              Payagan nang isang beses
            </Button>

            <Divider sx={{ borderColor: "#E2E8F0" }} />

            {/* Action Option 2: Payagan Habang Ginagamit ang App */}
            <Button
              fullWidth
              onClick={handleAllowWhileUsing}
              sx={{
                padding: "14px 16px",
                color: "#0F172A",
                fontWeight: 600,
                fontSize: "14px",
                textTransform: "none",
                fontFamily: "Poppins, sans-serif",
                borderRadius: 0,
                "&:hover": { backgroundColor: "#F8FAFC" },
              }}
            >
              Payagan Habang Ginagamit ang App
            </Button>

            <Divider sx={{ borderColor: "#E2E8F0" }} />

            {/* Action Option 3: Huwag payagan */}
            <Button
              fullWidth
              onClick={handleDeny}
              sx={{
                padding: "14px 16px",
                color: "#0F172A",
                fontWeight: 600,
                fontSize: "14px",
                textTransform: "none",
                fontFamily: "Poppins, sans-serif",
                borderRadius: 0,
                "&:hover": { backgroundColor: "#F8FAFC" },
              }}
            >
              Huwag payagan
            </Button>
          </Paper>
        </Box>
      </Box>
    </Box>
  );
};

export default LocationPermission;
