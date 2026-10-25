import React from "react";
import { useNavigate } from "react-router-dom";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Box from "@mui/material/Box";
import CloseIcon from "@mui/icons-material/Close";
import PhoneIcon from "@mui/icons-material/Phone";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";
import ReportProblemIcon from "@mui/icons-material/ReportProblem";

import { useLanguage } from "../../../../utils/LanguageContext";
import { TYPOGRAPHY_TOKENS, extendTapArea } from "@sakay/shared";

interface TulongDialogProps {
  open: boolean;
  onClose: () => void;
}

interface HotlineNumber {
  /** The number as it is shown to the passenger */
  display: string;
  /** What the dialer is given: the same number, digits only */
  dial: string;
  kind: { tl: string; en: string };
}

// The Calapan TODA hotline: the two numbers this dialog has always shown, now one tap each.
const HOTLINE_NUMBERS: HotlineNumber[] = [
  { display: "(043) 288-7000", dial: "0432887000", kind: { tl: "Landline", en: "Landline" } },
  { display: "0917-812-3456", dial: "09178123456", kind: { tl: "Mobile", en: "Mobile" } },
];

const FONT = "Poppins, sans-serif";

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography
    sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.caption, fontWeight: 700, color: "#64748B", fontFamily: FONT, letterSpacing: "0.02em", mb: 0.75, px: 0.5 }}
  >
    {children}
  </Typography>
);

const TulongDialog: React.FC<TulongDialogProps> = ({ open, onClose }) => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const tl = language === "tl";

  const handleOpenIncidentReport = () => {
    onClose();
    navigate("/incident-report", { state: { from: "/dashboard" } });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            borderRadius: "24px",
            m: 2,
            width: "calc(100% - 32px)",
            maxWidth: "380px",
            maxHeight: "calc(100% - 32px)",
            overflow: "hidden",
          },
        },
      }}
    >
      {/* Header: what this is, and the way out */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2.5, pt: 2.5, pb: 1.5 }}>
        <Box
          aria-hidden
          sx={{ width: 44, height: 44, borderRadius: "14px", backgroundColor: "#FFF2E9", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
        >
          <SupportAgentIcon sx={{ color: "#FF6600", fontSize: 26 }} />
        </Box>
        <Typography
          component="h2"
          sx={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: TYPOGRAPHY_TOKENS.fontSize.pageTitle, color: "#0F172A", fontFamily: FONT, lineHeight: 1.2 }}
        >
          {tl ? "Tulong at Suporta" : "Help & Support"}
        </Typography>
        <IconButton aria-label={tl ? "Isara" : "Close"} size="small" onClick={onClose} sx={{ ...extendTapArea(7), color: "#64748B", alignSelf: "flex-start" }}>
          <CloseIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </Box>

      <DialogContent sx={{ px: 2.5, pt: 0.5, pb: 2.5, display: "flex", flexDirection: "column", gap: 2.25 }}>
        <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.bodyMobile, color: "#64748B", fontFamily: FONT, lineHeight: 1.5 }}>
          {tl
            ? "May katanungan o kailangan ng tulong sa iyong biyahe sa Calapan City? Makipag-ugnayan sa amin:"
            : "Have questions or need assistance with your ride in Calapan City? Contact us:"}
        </Typography>

        {/* Calapan TODA hotline: each number is its own tap-to-call row (opens the dialer; nothing is dialled until the passenger presses call) */}
        <Box component="section" aria-label="Calapan TODA hotline">
          <SectionLabel>Calapan TODA hotline</SectionLabel>
          <Box sx={{ border: "1px solid #E2E8F0", borderRadius: "16px", overflow: "hidden", backgroundColor: "#FFFFFF" }}>
            {HOTLINE_NUMBERS.map((number, index) => (
              <Box
                key={number.dial}
                component="a"
                href={`tel:${number.dial}`}
                aria-label={`${tl ? "Tawagan" : "Call"} ${number.display}`}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.5,
                  minHeight: 68,
                  px: 1.75,
                  py: 1.25,
                  boxSizing: "border-box",
                  textDecoration: "none",
                  color: "inherit",
                  borderTop: index === 0 ? "none" : "1px solid #F1F5F9",
                  WebkitTapHighlightColor: "transparent",
                  "&:active": { backgroundColor: "#F8FAFC" },
                  "&:focus-visible": { outline: "2px solid #0F172A", outlineOffset: -2 },
                }}
              >
                <Box
                  aria-hidden
                  sx={{ width: 40, height: 40, borderRadius: "12px", backgroundColor: "#FFF7ED", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                >
                  <PhoneIcon sx={{ color: "#FF6600", fontSize: 20 }} />
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.micro, fontWeight: 600, color: "#64748B", fontFamily: FONT, lineHeight: 1.3 }}>
                    {tl ? number.kind.tl : number.kind.en}
                  </Typography>
                  <Typography
                    sx={{ fontSize: TYPOGRAPHY_TOKENS.fontSize.section, fontWeight: 700, color: "#0F172A", fontFamily: FONT, lineHeight: 1.3, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}
                  >
                    {number.display}
                  </Typography>
                </Box>
                <Box
                  aria-hidden
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                    flexShrink: 0,
                    px: 1.25,
                    py: 0.75,
                    borderRadius: "999px",
                    backgroundColor: "#FFF2E9",
                    color: "#B34700",
                    fontSize: TYPOGRAPHY_TOKENS.fontSize.caption,
                    fontWeight: 700,
                    fontFamily: FONT,
                  }}
                >
                  {tl ? "Tawagan" : "Call"}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>

        {/* Something went wrong on a trip */}
        <Box component="section" aria-label={tl ? "Mag-ulat" : "Report"}>
          <SectionLabel>{tl ? "Mag-ulat" : "Report"}</SectionLabel>
          <Button
            fullWidth
            variant="outlined"
            startIcon={<ReportProblemIcon sx={{ fontSize: "20px !important" }} />}
            onClick={handleOpenIncidentReport}
            sx={{
              borderColor: "#FCA5A5",
              borderWidth: "1.5px",
              color: "#B91C1C",
              backgroundColor: "#FEF2F2",
              borderRadius: "14px",
              fontWeight: 700,
              textTransform: "none",
              minHeight: "48px",
              py: "10px",
              px: "16px",
              fontSize: TYPOGRAPHY_TOKENS.fontSize.buttonMobile,
              fontFamily: FONT,
              lineHeight: 1.25,
              boxSizing: "border-box",
              "&:hover": { borderWidth: "1.5px", borderColor: "#EF4444", backgroundColor: "#FEE2E2" },
            }}
          >
            {tl ? "Mag-ulat ng Reklamo o Insidente" : "Report a Complaint or Incident"}
          </Button>
        </Box>
      </DialogContent>
    </Dialog>
  );
};

export default TulongDialog;
