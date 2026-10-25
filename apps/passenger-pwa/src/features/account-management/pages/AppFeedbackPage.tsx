import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";

import PageHeader from "../../../common/components/PageHeader";
import { useLanguage } from "../../../utils/LanguageContext";
import { RateAppForm } from '@sakay/shared';

const AppFeedbackPage: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();

  const [rating, setRating] = useState<number | null>(5);
  const [feedbackText, setFeedbackText] = useState("");
  const [successDialogOpen, setSuccessDialogOpen] = useState(false);


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

      <Box className="hide-scrollbar" sx={{ flexGrow: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', p: 2.5, pb: 'calc(var(--safe-area-bottom) + 24px)' }}>
        <RateAppForm
          language={language === 'tl' ? 'tl' : 'en'}
          audience="passenger"
          rating={rating}
          onRatingChange={setRating}
          comment={feedbackText}
          onCommentChange={setFeedbackText}
          commentLabel={language === 'tl' ? 'Karagdagang Komento (Opsyonal)' : 'Additional Comments (Optional)'}
          commentPlaceholder={language === 'tl' ? 'Isulat dito ang iyong komento o suhestiyon...' : 'Type your comment or suggestion here...'}
          onSubmit={() => setSuccessDialogOpen(true)}
        />
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
              backgroundColor: "#FF6600",
              color: "#FFFFFF",
              borderRadius: "12px",
              px: 4,
              fontWeight: 700,
              textTransform: "none",
              boxShadow: "none",
              "&:hover": { backgroundColor: "#E65C00", boxShadow: "none" },
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
