import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

interface SuccessModalProps {
  open: boolean;
  title: string;
  message: string;
}

const SuccessModal: React.FC<SuccessModalProps> = ({ open, title, message }) => {
  if (!open) return null;

  return (
    <Box
      sx={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(15, 23, 42, 0.5)",
        backdropFilter: "blur(4px)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 9999,
        padding: "20px",
      }}
    >
      <Box
        className="anim-scale-in"
        sx={{
          backgroundColor: "#FFFFFF",
          borderRadius: "24px",
          padding: "32px 24px",
          width: "100%",
          maxWidth: "340px",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        {/* Success Icon */}
        <Box
          sx={{
            width: "72px",
            height: "72px",
            borderRadius: "50%",
            backgroundColor: "rgba(255, 107, 0, 0.1)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            marginBottom: "20px",
          }}
        >
          <CheckCircleIcon
            sx={{
              fontSize: "44px",
              color: "#FF6B00",
            }}
          />
        </Box>

        {/* Title */}
        <Typography
          sx={{
            fontSize: "20px",
            fontWeight: 800,
            color: "#0F172A",
            lineHeight: 1.3,
          }}
        >
          {title}
        </Typography>

        {/* Message */}
        <Typography
          sx={{
            fontSize: "14px",
            color: "#64748B",
            marginTop: "10px",
            lineHeight: 1.5,
            fontWeight: 500,
          }}
        >
          {message}
        </Typography>
      </Box>
    </Box>
  );
};

export default SuccessModal;
