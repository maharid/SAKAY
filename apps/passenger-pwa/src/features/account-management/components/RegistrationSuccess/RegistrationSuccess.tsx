import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useLanguage } from "../../../../utils/LanguageContext";
import PrimaryButton from "../../../../common/components/PrimaryButton";

import totoHead from "@sakay/shared/src/assets/icons/toto_head.png";

const RegistrationSuccess: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();

  // Retrieve state passed from VerifyOtp page
  const state = location.state as {
    name?: string;
    role?: string;
  };

  const userName = state?.name ? `, ${state.name}` : "";

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        padding: "32px 24px",
        paddingTop: "calc(var(--safe-area-top) + 24px)",
        paddingBottom: "calc(var(--safe-area-bottom) + 32px)",
        backgroundColor: "#FFFFFF",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {/* Toto Head Mascot Illustration */}
      <Box
        className="anim-scale-in"
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          marginBottom: "24px",
        }}
      >
        <Box
          component="img"
          src={totoHead}
          alt="Toto Mascot"
          sx={{
            width: "120px",
            height: "120px",
            objectFit: "contain",
          }}
        />
      </Box>

      {/* Text Area */}
      <Box sx={{ textAlign: "center", marginBottom: "48px" }}>
        <Typography
          component="h2"
          sx={{
            fontSize: "26px",
            fontWeight: 800,
            color: "#0F172A",
            lineHeight: 1.3,
          }}
        >
          {language === "tl" ? `Maligayang Pagdating${userName}!` : `Welcome${userName}!`}
        </Typography>
        <Typography
          sx={{
            fontSize: "15px",
            color: "#64748B",
            marginTop: "12px",
            lineHeight: 1.6,
            padding: "0 12px",
          }}
        >
          {language === "tl"
            ? "Matagumpay na nagawa ang iyong account. Maaari ka nang mag-log in o pumunta sa iyong dashboard upang mag-book ng biyahe."
            : "Your account has been created successfully. You can now log in or proceed to your dashboard to book a ride."}
        </Typography>
      </Box>

      {/* Action Button */}
      <Box sx={{ width: "100%", padding: "0 12px" }}>
        <PrimaryButton
          fullWidth
          onClick={() => {
            localStorage.removeItem("gps_permission");
            sessionStorage.removeItem("gps_permission_session");
            navigate("/dashboard", {
              replace: true,
              state: { userName: state?.name, freshLogin: true },
            });
          }}
        >
          {language === "tl" ? "Pumunta sa Dashboard" : "Go to Dashboard"}
        </PrimaryButton>
      </Box>
    </Box>
  );
};

export default RegistrationSuccess;
