import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Rating from "@mui/material/Rating";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";

import PageHeader from "../../../common/components/PageHeader";
import { useLanguage } from "../../../utils/LanguageContext";

const AppFeedbackPage: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();

  const [rating, setRating] = useState<number | null>(5);
  const [feedbackText, setFeedbackText] = useState("");
  const [successDialogOpen, setSuccessDialogOpen] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
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
        title={language === "tl" ? "I-rate ang App" : "Rate the App"}
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
          pb: "calc(var(--safe-area-bottom) + 24px)",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <Paper
          elevation={0}
          sx={{
            p: 3,
            borderRadius: "20px",
            backgroundColor: "#FFFFFF",
            border: "1px solid #F1F5F9",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 1.5,
          }}
        >
          <Typography sx={{ fontSize: "16px", fontWeight: 800, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
            {language === "tl"
              ? "Kamusta ang iyong karanasan sa SAKAY?"
              : "How was your experience using SAKAY?"}
          </Typography>
          <Typography sx={{ fontSize: "12.5px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
            {language === "tl"
              ? "Tulungan kaming mapabuti ang serbisyo para sa buong Calapan City."
              : "Help us improve our service for all of Calapan City."}
          </Typography>

          <Rating
            value={rating}
            onChange={(_, newValue) => setRating(newValue)}
            sx={{
              my: 1.5,
              color: "#FF6B00",
              "& .MuiRating-icon": {
                fontSize: "44px",
                mx: 0.5,
              },
            }}
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
            gap: 1.5,
          }}
        >
          <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
            {language === "tl" ? "Karagdagang Komento (Opsyonal)" : "Additional Comments (Optional)"}
          </Typography>

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
        </Paper>

        {/* Submit Button at Bottom */}
        <Box sx={{ mt: "auto", pt: 1 }}>
          <Button
            type="submit"
            fullWidth
            variant="contained"
            sx={{
              backgroundColor: "#FF6B00",
              color: "#FFFFFF",
              borderRadius: "14px",
              height: "52px",
              fontSize: "15px",
              fontWeight: 800,
              textTransform: "none",
              fontFamily: "Poppins, sans-serif",
              boxShadow: "none",
              "&:hover": { backgroundColor: "#E66000", boxShadow: "none" },
            }}
          >
            {language === "tl" ? "Isumite ang Rating" : "Submit Rating"}
          </Button>
        </Box>
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
            {language === "tl" ? "Salamat sa Rating!" : "Thank You for Your Rating!"}
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
