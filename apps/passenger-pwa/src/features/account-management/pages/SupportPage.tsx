import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PhoneIcon from "@mui/icons-material/Phone";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import TrackChangesOutlinedIcon from "@mui/icons-material/TrackChangesOutlined";
import HelpOutlinedIcon from "@mui/icons-material/HelpOutlined";
import FeedbackOutlinedIcon from "@mui/icons-material/FeedbackOutlined";

import PageHeader from "../../../common/components/PageHeader";
import { useLanguage } from "../../../utils/LanguageContext";

const FAQS_TL = [
  {
    q: "Paano kinakalkula ang pamasahe sa SAKAY?",
    a: "Ang pamasahe ay nakabatay sa Opisyal na Calapan City TODA Fare Matrix. Ang Solo Ride (Charter) ay may base fare na ₱15 na minumultiplicar sa 4 (kabuuang ₱60 para sa buong sakay) dagdag ang karagdagang distansya. Ang Shared Ride naman ay ipinapamahagi nang patas batay sa aktwal na sakay.",
  },
  {
    q: "Paano mag-report ng drayber o nawalang gamit?",
    a: "Maaari kang magpasa ng opisyal na ulat gamit ang 'Mag-report ng Insidente' button sa ibaba. Siguraduhing ilagay ang Body Number o Plate Number ng tricycle.",
  },
  {
    q: "Ano ang dapat gawin kung magkaroon ng emergency habang bumabiyahe?",
    a: "Tumawag agad sa TODA Hotline o Calapan Transport Office sa pamamagitan ng mabilis na call button sa itaas.",
  },
  {
    q: "Maaari ko bang baguhin ang aking paboritong ruta?",
    a: "Opo, sa 'Mga Naka-save na Lugar' maaari mong i-update o baguhin ang iyong mga paboritong lokasyon anumang oras.",
  },
];

const FAQS_EN = [
  {
    q: "How are SAKAY fares calculated?",
    a: "Fares strictly adhere to the Official Calapan City TODA Fare Matrix. Solo Charter rides start at a base fare of ₱15 multiplied by 4 (total ₱60 for chartering the full vehicle) plus distance. Shared rides divide the tariff proportionately among passengers.",
  },
  {
    q: "How do I report a driver or lost item?",
    a: "You can submit an official report using the 'Report an Incident' button below. Be sure to provide the Tricycle Body Number or Plate Number.",
  },
  {
    q: "What should I do during an emergency trip?",
    a: "Immediately contact the TODA Hotline or Calapan Transport Office using the quick call button above.",
  },
  {
    q: "Can I update my favorite saved routes?",
    a: "Yes, under 'Saved Places' you can add, edit, or delete your frequent destinations anytime.",
  },
];

const SupportPage: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<string | false>(false);

  const faqs = language === "tl" ? FAQS_TL : FAQS_EN;

  const handleChange = (panel: string) => (_: React.SyntheticEvent, isExpanded: boolean) => {
    setExpanded(isExpanded ? panel : false);
  };

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        backgroundColor: "#FAFAFA",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <PageHeader
        title={language === "tl" ? "Tulong at Suporta" : "Help & Support"}
        onBack={() => navigate("/dashboard")}
      />

      <Box
        className="hide-scrollbar"
        sx={{
          flexGrow: 1,
          overflowY: "auto",
          p: 2.5,
          display: "flex",
          flexDirection: "column",
          gap: 2.5,
        }}
      >
        {/* Emergency Hotline Card */}
        <Paper
          elevation={0}
          sx={{
            p: 2.5,
            borderRadius: "20px",
            background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)",
            color: "#FFFFFF",
            boxShadow: "0 4px 16px rgba(15, 23, 42, 0.15)",
            display: "flex",
            flexDirection: "column",
            gap: 1.5,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: "14px",
                backgroundColor: "rgba(255, 107, 0, 0.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <PhoneIcon sx={{ color: "#FF6B00", fontSize: 24 }} />
            </Box>
            <Box>
              <Typography sx={{ fontSize: "15px", fontWeight: 700, fontFamily: "Poppins, sans-serif" }}>
                {language === "tl" ? "TODA & Transport Hotline" : "TODA & Transport Hotline"}
              </Typography>
              <Typography sx={{ fontSize: "12px", color: "#94A3B8", fontFamily: "Poppins, sans-serif" }}>
                {language === "tl" ? "Calapan City Public Safety Office" : "Calapan City Public Safety Office"}
              </Typography>
            </Box>
          </Box>

          <Button
            component="a"
            href="tel:09171234567"
            variant="contained"
            startIcon={<PhoneIcon />}
            sx={{
              backgroundColor: "#FF6B00",
              color: "#FFFFFF",
              borderRadius: "12px",
              height: "44px",
              fontSize: "14px",
              fontWeight: 700,
              textTransform: "none",
              fontFamily: "Poppins, sans-serif",
              boxShadow: "none",
              "&:hover": { backgroundColor: "#E66000", boxShadow: "none" },
            }}
          >
            {language === "tl" ? "Tumawag Ngayon: 0917-123-4567" : "Call Hotline: 0917-123-4567"}
          </Button>
        </Paper>

        {/* Action Buttons for Incident Reporting & Tracking */}
        <Box sx={{ display: "flex", gap: 1.5 }}>
          <Paper
            elevation={0}
            onClick={() => navigate("/incident-report")}
            sx={{
              flex: 1,
              p: 2,
              borderRadius: "16px",
              backgroundColor: "#FFFFFF",
              border: "1px solid #F1F5F9",
              cursor: "pointer",
              transition: "transform 0.15s ease",
              "&:active": { transform: "scale(0.98)" },
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              gap: 1,
            }}
          >
            <ReportProblemOutlinedIcon sx={{ color: "#EF4444", fontSize: 32 }} />
            <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
              {language === "tl" ? "Mag-report ng Insidente" : "Report Incident"}
            </Typography>
          </Paper>

          <Paper
            elevation={0}
            onClick={() => navigate("/track-reports")}
            sx={{
              flex: 1,
              p: 2,
              borderRadius: "16px",
              backgroundColor: "#FFFFFF",
              border: "1px solid #F1F5F9",
              cursor: "pointer",
              transition: "transform 0.15s ease",
              "&:active": { transform: "scale(0.98)" },
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              gap: 1,
            }}
          >
            <TrackChangesOutlinedIcon sx={{ color: "#FF6B00", fontSize: 32 }} />
            <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
              {language === "tl" ? "Subaybayan ang Ulat" : "Track Reports"}
            </Typography>
          </Paper>
        </Box>

        <Paper
          elevation={0}
          onClick={() => navigate("/app-feedback")}
          sx={{
            p: 2,
            borderRadius: "16px",
            backgroundColor: "#FFFFFF",
            border: "1px solid #F1F5F9",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 1.5,
          }}
        >
          <FeedbackOutlinedIcon sx={{ color: "#FF6B00", fontSize: 24 }} />
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontSize: "14px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
              {language === "tl" ? "Magbigay ng App Feedback" : "Give App Feedback"}
            </Typography>
            <Typography sx={{ fontSize: "12px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
              {language === "tl" ? "Ibahagi ang iyong karanasan sa paggamit ng SAKAY" : "Share your experience using SAKAY app"}
            </Typography>
          </Box>
        </Paper>

        {/* FAQs Section */}
        <Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
            <HelpOutlinedIcon sx={{ color: "#FF6B00", fontSize: 20 }} />
            <Typography sx={{ fontSize: "15px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
              {language === "tl" ? "Mga Madalas Itanong (FAQ)" : "Frequently Asked Questions"}
            </Typography>
          </Box>

          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {faqs.map((faq, idx) => {
              const panelId = `panel_${idx}`;
              return (
                <Accordion
                  key={idx}
                  expanded={expanded === panelId}
                  onChange={handleChange(panelId)}
                  elevation={0}
                  sx={{
                    borderRadius: "14px !important",
                    border: "1px solid #F1F5F9",
                    "&:before": { display: "none" },
                    backgroundColor: "#FFFFFF",
                    overflow: "hidden",
                  }}
                >
                  <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: "#64748B" }} />}>
                    <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
                      {faq.q}
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails sx={{ borderTop: "1px solid #F8FAFC", pt: 1.5 }}>
                    <Typography sx={{ fontSize: "12px", color: "#475569", lineHeight: 1.5, fontFamily: "Poppins, sans-serif" }}>
                      {faq.a}
                    </Typography>
                  </AccordionDetails>
                </Accordion>
              );
            })}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default SupportPage;
