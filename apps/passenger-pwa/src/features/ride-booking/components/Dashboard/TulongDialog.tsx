import React from "react";
import { useNavigate } from "react-router-dom";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import CloseIcon from "@mui/icons-material/Close";
import PhoneIcon from "@mui/icons-material/Phone";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";
import ReportProblemIcon from "@mui/icons-material/ReportProblem";

import { useLanguage } from "../../../../utils/LanguageContext";
import { TYPOGRAPHY_TOKENS } from "@sakay/shared";

interface TulongDialogProps {
  open: boolean;
  onClose: () => void;
}

const TulongDialog: React.FC<TulongDialogProps> = ({ open, onClose }) => {
  const { language } = useLanguage();
  const navigate = useNavigate();

  const handleOpenIncidentReport = () => {
    onClose();
    navigate('/incident-report', { state: { from: '/dashboard' } });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            borderRadius: "20px",
            padding: "8px",
            maxWidth: "360px",
            width: "92%",
          },
        },
      }}
    >
      {/* Modal Header: Title + Top-Right X Close Icon */}
      <DialogTitle
        sx={{
          fontWeight: 700,
          fontSize: TYPOGRAPHY_TOKENS.fontSize.pageTitle,
          color: "#0F172A",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontFamily: "Poppins, sans-serif",
          pb: 1,
          px: 2.5,
          pt: 2,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <SupportAgentIcon sx={{ color: "#FF6B00", fontSize: 22 }} />
          <span>{language === "tl" ? "Tulong at Suporta" : "Help & Support"}</span>
        </Box>
        <IconButton size="small" onClick={onClose} sx={{ color: "#64748B" }}>
          <CloseIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </DialogTitle>

      {/* Modal Content: Shared left/right margins (px: 2.5) for all internal cards/buttons */}
      <DialogContent sx={{ px: 2.5, py: 1, display: "flex", flexDirection: "column", gap: 2 }}>
        <Typography
          sx={{
            fontSize: TYPOGRAPHY_TOKENS.fontSize.bodyMobile,
            color: "#64748B",
            fontFamily: "Poppins, sans-serif",
            lineHeight: 1.45,
          }}
        >
          {language === "tl"
            ? "May katanungan o kailangan ng tulong sa iyong biyahe sa Calapan City? Makipag-ugnayan sa amin:"
            : "Have questions or need assistance with your ride in Calapan City? Contact us:"}
        </Typography>

        {/* 1. Calapan TODA Hotline Card */}
        <Paper
          elevation={0}
          sx={{
            padding: "14px 16px",
            backgroundColor: "#F8FAFC",
            borderRadius: "14px",
            border: "1px solid #E2E8F0",
            display: "flex",
            alignItems: "center",
            gap: "14px",
            width: "100%",
            boxSizing: "border-box",
          }}
        >
          <Box
            sx={{
              width: "40px",
              height: "40px",
              borderRadius: "12px",
              backgroundColor: "#FFF7ED",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <PhoneIcon sx={{ color: "#FF6B00", fontSize: "20px" }} />
          </Box>
          <Box>
            <Typography
              sx={{
                fontSize: TYPOGRAPHY_TOKENS.fontSize.caption,
                fontWeight: 700,
                color: "#94A3B8",
                letterSpacing: "0.5px",
                fontFamily: "Poppins, sans-serif",
              }}
            >
              CALAPAN TODA HOTLINE
            </Typography>
            <Typography
              sx={{
                fontSize: TYPOGRAPHY_TOKENS.fontSize.section,
                fontWeight: 800,
                color: "#0F172A",
                fontFamily: "Poppins, sans-serif",
                mt: "2px",
              }}
            >
              (043) 288-7000 / 0917-812-3456
            </Typography>
          </Box>
        </Paper>

        {/* 2. Mag-ulat ng Reklamo o Insidente Button (Aligned to same content boundaries) */}
        <Button
          fullWidth
          variant="outlined"
          startIcon={<ReportProblemIcon sx={{ fontSize: "20px !important" }} />}
          onClick={handleOpenIncidentReport}
          sx={{
            borderColor: "#EF4444",
            color: "#EF4444",
            borderRadius: "14px",
            fontWeight: 700,
            textTransform: "none",
            minHeight: "44px",
            py: "10px",
            px: "16px",
            fontSize: TYPOGRAPHY_TOKENS.fontSize.buttonMobile,
            fontFamily: "Poppins, sans-serif",
            lineHeight: 1.25,
            width: "100%",
            boxSizing: "border-box",
            mb: 1.5,
            "&:hover": { borderColor: "#DC2626", backgroundColor: "#FEF2F2" },
          }}
        >
          {language === "tl" ? "Mag-ulat ng Reklamo o Insidente" : "Report a Complaint or Incident"}
        </Button>
      </DialogContent>
    </Dialog>
  );
};

export default TulongDialog;
