import React from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import Alert from "@mui/material/Alert";
import { useLanguage } from "../../../../utils/LanguageContext";
import PrimaryButton from "../../../../common/components/PrimaryButton";
import Logo from "../../../../common/components/Logo";

/**
 * Password reset is switched off for now.
 *
 * The old screen looked up whether a mobile number was registered before anything else (anybody could use it to find out who has an
 * account), then "sent" a code through a path that approved any code. A safe reset needs a server-checked code tied to the account;
 * that is the OTP redesign, and until it ships this screen only tells the user where to get help. Nothing here reads or writes data.
 */
const ForgotPassword: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        padding: "24px",
        paddingTop: "calc(var(--safe-area-top) + 16px)",
        paddingBottom: "calc(var(--safe-area-bottom) + 24px)",
        backgroundColor: "#FFFFFF",
        display: "flex",
        flexDirection: "column",
      }}
      className="hide-scrollbar"
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
        }}
      >
        <IconButton
          onClick={() => navigate("/login")}
          sx={{
            backgroundColor: "#FFFFFF",
            border: "1px solid #E2E8F0",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)",
            color: "#1A1A1A",
            borderRadius: "14px",
            width: "44px",
            height: "44px",
            "&:hover": {
              backgroundColor: "#F8FAFC",
            },
          }}
        >
          <ArrowBackIcon sx={{ fontSize: 20 }} />
        </IconButton>

        <Logo color="orange" />
      </Box>

      {/* Title */}
      <Box sx={{ marginTop: "44px", textAlign: "left", width: "100%" }}>
        <Typography
          component="h2"
          sx={{
            fontSize: "26px",
            fontWeight: 800,
            color: "#0F172A",
            lineHeight: 1.3,
          }}
        >
          {language === "tl" ? "Nakalimutan ang Password?" : "Forgot Password?"}
        </Typography>
        <Typography
          sx={{
            fontSize: "15px",
            color: "#64748B",
            marginTop: "8px",
            lineHeight: 1.5,
          }}
        >
          {language === "tl"
            ? "Pansamantalang hindi available ang pag-reset ng password sa app."
            : "Resetting your password in the app is temporarily unavailable."}
        </Typography>
      </Box>

      <Alert severity="info" sx={{ width: "100%", marginTop: "24px", borderRadius: "12px" }}>
        {language === "tl"
          ? "Para mabawi ang iyong account, makipag-ugnayan sa SAKAY support o sa tanggapan ng LGU. Dalhin ang iyong valid ID at ang mobile number na ginamit mo sa pagpaparehistro."
          : "To recover your account, please contact SAKAY support or the LGU transport office. Bring a valid ID and the mobile number you registered with."}
      </Alert>

      <Box sx={{ marginTop: "32px", width: "100%" }}>
        <PrimaryButton fullWidth onClick={() => navigate("/login")}>
          {language === "tl" ? "Bumalik sa Login" : "Back to Log In"}
        </PrimaryButton>
      </Box>
    </Box>
  );
};

export default ForgotPassword;
