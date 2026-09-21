import React from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useLanguage } from "../../utils/LanguageContext";
import PrimaryButton from "./PrimaryButton";
import somethingWentWrongToto from "@sakay/shared/src/assets/icons/something-went-wrong-toto.webp";

export const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();
  const { language } = useLanguage();

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        padding: "32px 24px",
        backgroundColor: "#FFFFFF",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
      }}
    >
      <Box
        component="img"
        src={somethingWentWrongToto}
        alt="Something Went Wrong"
        sx={{
          width: "180px",
          height: "auto",
          maxHeight: "180px",
          objectFit: "contain",
          mb: 3,
        }}
      />

      <Typography
        sx={{
          fontSize: "24px",
          fontWeight: 800,
          color: "#0F172A",
          mb: 1,
        }}
      >
        {language === "tl" ? "May Hindi Inaasahang Aberya" : "Page Not Found"}
      </Typography>

      <Typography
        sx={{
          fontSize: "14px",
          color: "#64748B",
          mb: 4,
          maxWidth: "300px",
          lineHeight: 1.5,
        }}
      >
        {language === "tl"
          ? "Hindi mahanap ang pahinang iyong hinahanap. Bumalik sa Home upang magpatuloy."
          : "The page you are looking for does not exist. Return to Home to continue."}
      </Typography>

      <Box sx={{ width: "100%", maxWidth: "320px" }}>
        <PrimaryButton fullWidth onClick={() => navigate("/dashboard")}>
          {language === "tl" ? "Bumalik sa Dashboard" : "Return to Dashboard"}
        </PrimaryButton>
      </Box>
    </Box>
  );
};

export default NotFoundPage;
