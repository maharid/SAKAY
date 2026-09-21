import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Rating from "@mui/material/Rating";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";

import PageHeader from "../../../common/components/PageHeader";
import { useLanguage } from "../../../utils/LanguageContext";

const CATEGORIES = [
  { key: "usability", labelTl: "Gamit ng App", labelEn: "App Usability" },
  { key: "speed", labelTl: "Bilis ng Booking", labelEn: "Booking Speed" },
  { key: "map", labelTl: "Mapa at Lokasyon", labelEn: "Map & Navigation" },
  { key: "driver", labelTl: "Pakikitungo ng Drayber", labelEn: "Driver Behavior" },
  { key: "general", labelTl: "Pangkalahatan", labelEn: "General Feedback" },
];

const AppFeedbackPage: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();

  const [rating, setRating] = useState<number | null>(5);
  const [selectedCategory, setSelectedCategory] = useState<string>("usability");
  const [feedbackText, setFeedbackText] = useState("");
  const [successDialogOpen, setSuccessDialogOpen] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackText.trim()) return;

    setSuccessDialogOpen(true);
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
        title={language === "tl" ? "App & Service Feedback" : "App & Service Feedback"}
        onBack={() => navigate(-1)}
      />

      <Box
        component="form"
        onSubmit={handleSubmit}
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
        <Paper
          elevation={0}
          sx={{
            p: 2.5,
            borderRadius: "20px",
            backgroundColor: "#FFFFFF",
            border: "1px solid #F1F5F9",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 1,
          }}
        >
          <Typography sx={{ fontSize: "15px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
            {language === "tl"
              ? "Kamusta ang iyong karanasan sa SAKAY?"
              : "How was your experience using SAKAY?"}
          </Typography>
          <Typography sx={{ fontSize: "12px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
            {language === "tl"
              ? "Tulungan kaming mapabuti ang serbisyo para sa buong Calapan City."
              : "Help us improve our service for all of Calapan City."}
          </Typography>

          <Rating
            value={rating}
            onChange={(_, newValue) => setRating(newValue)}
            size="large"
            sx={{ my: 1, color: "#FF6B00" }}
          />
        </Paper>

        <Paper
          elevation={0}
          sx={{
            p: 2.5,
            borderRadius: "20px",
            backgroundColor: "#FFFFFF",
            border: "1px solid #F1F5F9",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <Box>
            <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "#0F172A", mb: 1, fontFamily: "Poppins, sans-serif" }}>
              {language === "tl" ? "Kategorya ng Feedback:" : "Feedback Category:"}
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
              {CATEGORIES.map((cat) => {
                const isSelected = selectedCategory === cat.key;
                return (
                  <Chip
                    key={cat.key}
                    label={language === "tl" ? cat.labelTl : cat.labelEn}
                    onClick={() => setSelectedCategory(cat.key)}
                    sx={{
                      fontSize: "12px",
                      fontWeight: isSelected ? 700 : 500,
                      fontFamily: "Poppins, sans-serif",
                      backgroundColor: isSelected ? "#FF6B00" : "#F1F5F9",
                      color: isSelected ? "#FFFFFF" : "#64748B",
                      cursor: "pointer",
                      "&:hover": { backgroundColor: isSelected ? "#E66000" : "#E2E8F0" },
                    }}
                  />
                );
              })}
            </Box>
          </Box>

          <TextField
            fullWidth
            multiline
            rows={4}
            placeholder={
              language === "tl"
                ? "Isulat dito ang iyong komento o suhestiyon..."
                : "Type your comment or suggestion here..."
            }
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            sx={{
              "& .MuiOutlinedInput-root": {
                borderRadius: "14px",
                fontSize: "13px",
                fontFamily: "Poppins, sans-serif",
              },
            }}
          />

          <Button
            type="submit"
            fullWidth
            variant="contained"
            disabled={!feedbackText.trim()}
            sx={{
              backgroundColor: "#FF6B00",
              color: "#FFFFFF",
              borderRadius: "14px",
              height: "46px",
              fontSize: "14px",
              fontWeight: 700,
              textTransform: "none",
              fontFamily: "Poppins, sans-serif",
              boxShadow: "none",
              "&:hover": { backgroundColor: "#E66000", boxShadow: "none" },
            }}
          >
            {language === "tl" ? "Ipadala ang Feedback" : "Submit Feedback"}
          </Button>
        </Paper>
      </Box>

      {/* Success Dialog */}
      <Dialog
        open={successDialogOpen}
        onClose={() => {
          setSuccessDialogOpen(false);
          navigate(-1);
        }}
        slotProps={{
          paper: { sx: { borderRadius: "20px", p: 1, textAlign: "center", width: "90%", maxWidth: "340px" } },
        }}
      >
        <DialogTitle sx={{ pt: 3 }}>
          <CheckCircleOutlinedIcon sx={{ fontSize: 56, color: "#10B981" }} />
          <Typography sx={{ fontSize: "18px", fontWeight: 700, color: "#0F172A", mt: 1, fontFamily: "Poppins, sans-serif" }}>
            {language === "tl" ? "Salamat sa Feedback!" : "Thank You for Your Feedback!"}
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: "13px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
            {language === "tl"
              ? "Ang iyong opinyon ay napakahalaga upang mas mapaganda ang serbisyo ng SAKAY."
              : "Your feedback is essential in helping us build a better transport app."}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ pb: 3, justifyContent: "center" }}>
          <Button
            variant="contained"
            onClick={() => {
              setSuccessDialogOpen(false);
              navigate(-1);
            }}
            sx={{
              backgroundColor: "#FF6B00",
              color: "#FFFFFF",
              borderRadius: "12px",
              px: 4,
              fontWeight: 700,
              textTransform: "none",
              boxShadow: "none",
              "&:hover": { backgroundColor: "#E66000", boxShadow: "none" },
            }}
          >
            {language === "tl" ? "Bumalik" : "Done"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AppFeedbackPage;
