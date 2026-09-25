import React, { useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import CloseIcon from "@mui/icons-material/Close";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { useLanguage } from "../../utils/LanguageContext";

export interface PassengerCancelModalProps {
  open: boolean;
  onClose: () => void;
  onConfirmCancel: (reasonText: string) => void | Promise<void>;
  language?: "tl" | "en";
  loading?: boolean;
}

interface CancelOption {
  id: string;
  tl: string;
  en: string;
}

const CANCEL_OPTIONS: CancelOption[] = [
  {
    id: "driver_delayed",
    tl: "Matagal dumating ang driver",
    en: "Driver is taking too long",
  },
  {
    id: "no_longer_needed",
    tl: "Hindi ko na kailangan ang biyahe",
    en: "I no longer need the ride",
  },
  {
    id: "wrong_location",
    tl: "Nagkamali ako ng pickup o destination",
    en: "Wrong pickup or destination",
  },
  {
    id: "found_another_ride",
    tl: "May ibang nasakyan na ako",
    en: "Found another ride",
  },
  {
    id: "other",
    tl: "Iba pa",
    en: "Other reason",
  },
];

/**
 * PassengerCancelModal - Refined aesthetic cancel booking modal for Passenger PWA
 * Features balanced typography sizing, smooth option highlights, and Apple/SAKAY styling.
 */
export const PassengerCancelModal: React.FC<PassengerCancelModalProps> = ({
  open,
  onClose,
  onConfirmCancel,
  language: propLanguage,
  loading = false,
}) => {
  const { language: contextLanguage } = useLanguage();
  const effectiveLanguage = propLanguage || contextLanguage || "tl";

  const [selectedOptionId, setSelectedOptionId] = useState<string>("no_longer_needed");

  if (!open) return null;

  const handleConfirm = async () => {
    const selected = CANCEL_OPTIONS.find((opt) => opt.id === selectedOptionId);
    const reasonText = selected
      ? effectiveLanguage === "tl"
        ? selected.tl
        : selected.en
      : "Cancelled by Passenger";

    await onConfirmCancel(reasonText);
  };

  return (
    <Box
      sx={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(15, 23, 42, 0.45)",
        backdropFilter: "blur(6px)",
        zIndex: 2500,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        p: "calc(var(--safe-area-top) + 16px) 16px calc(var(--safe-area-bottom) + 20px) 16px",
        boxSizing: "border-box",
        overflowY: "auto",
        animation: "fadeIn 0.2s ease-out",
      }}
    >
      {/* 1. Top-Left Close Button */}
      <Box sx={{ display: "flex", justifyContent: "flex-start", width: "100%", pt: 0.5 }}>
        <IconButton
          onClick={onClose}
          disabled={loading}
          aria-label="close"
          sx={{
            width: 42,
            height: 42,
            borderRadius: "14px",
            backgroundColor: "#FFFFFF",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.08)",
            color: "#0F172A",
            border: "1px solid #F1F5F9",
            transition: "all 0.15s ease",
            "&:hover": {
              backgroundColor: "#F8FAFC",
              transform: "scale(1.02)",
            },
            "&:active": {
              transform: "scale(0.96)",
            },
          }}
        >
          <CloseIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </Box>

      {/* 2. Aesthetic White Reasons Card */}
      <Box
        sx={{
          backgroundColor: "#FFFFFF",
          borderRadius: "24px",
          p: { xs: "22px 18px", sm: "24px 22px" },
          width: "100%",
          maxWidth: "380px",
          mx: "auto",
          my: "auto",
          boxShadow: "0 20px 45px rgba(15, 23, 42, 0.12)",
          border: "1px solid #F1F5F9",
          boxSizing: "border-box",
        }}
      >
        {/* Header Title */}
        <Typography
          sx={{
            fontSize: "16.5px",
            fontWeight: 800,
            color: "#0F172A",
            textAlign: "center",
            fontFamily: "Poppins, sans-serif",
            mb: "16px",
            letterSpacing: "-0.2px",
          }}
        >
          {effectiveLanguage === "tl" ? "Bakit mo gustong i-cancel?" : "Why do you want to cancel?"}
        </Typography>

        {/* Divider */}
        <Box sx={{ height: "1px", backgroundColor: "#F1F5F9", mb: "12px" }} />

        {/* Radio Options List */}
        <Box sx={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {CANCEL_OPTIONS.map((option) => {
            const isSelected = selectedOptionId === option.id;
            const label = effectiveLanguage === "tl" ? option.tl : option.en;

            return (
              <Box
                key={option.id}
                onClick={() => !loading && setSelectedOptionId(option.id)}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  py: "10px",
                  px: "14px",
                  cursor: loading ? "default" : "pointer",
                  userSelect: "none",
                  borderRadius: "14px",
                  backgroundColor: isSelected ? "#FFF7ED" : "#FFFFFF",
                  border: isSelected ? "1.5px solid #FF6B00" : "1px solid #F1F5F9",
                  transition: "all 0.15s ease",
                  "&:hover": {
                    backgroundColor: isSelected ? "#FFF7ED" : "#F8FAFC",
                  },
                  "&:active": {
                    transform: loading ? "none" : "scale(0.99)",
                  },
                }}
              >
                {/* Option Text */}
                <Typography
                  sx={{
                    fontSize: "13.5px",
                    fontWeight: isSelected ? 700 : 500,
                    color: isSelected ? "#0F172A" : "#475569",
                    fontFamily: "Poppins, sans-serif",
                    pr: 1,
                    lineHeight: 1.35,
                  }}
                >
                  {label}
                </Typography>

                {/* Styled Radio Indicator */}
                {isSelected ? (
                  <Box
                    sx={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      border: "2px solid #FF6B00",
                      backgroundColor: "#FFFFFF",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Box
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        backgroundColor: "#FF6B00",
                      }}
                    />
                  </Box>
                ) : (
                  <Box
                    sx={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      border: "2px solid #CBD5E1",
                      backgroundColor: "transparent",
                      flexShrink: 0,
                    }}
                  />
                )}
              </Box>
            );
          })}
        </Box>

        {/* Divider */}
        <Box sx={{ height: "1px", backgroundColor: "#F1F5F9", mt: "14px", mb: "14px" }} />

        {/* Reminder Box */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.25,
            p: "10px 12px",
            borderRadius: "12px",
            backgroundColor: "#F8FAFC",
            border: "1px solid #F1F5F9",
            mb: "18px",
          }}
        >
          <InfoOutlinedIcon sx={{ fontSize: 18, color: "#64748B", flexShrink: 0 }} />
          <Typography
            sx={{
              fontSize: "11.5px",
              color: "#64748B",
              lineHeight: 1.4,
              fontFamily: "Poppins, sans-serif",
            }}
          >
            <Box component="span" sx={{ fontWeight: 700, color: "#475569" }}>
              {effectiveLanguage === "tl" ? "PAALALA:" : "REMINDER:"}
            </Box>{" "}
            {effectiveLanguage === "tl"
              ? "Ang pag-cancel ay maaaring makaapekto sa iyong passenger rating."
              : "Cancelling your booking increases your cancellation rate."}
          </Typography>
        </Box>

        {/* Action Button */}
        <Button
          fullWidth
          onClick={handleConfirm}
          disabled={loading}
          sx={{
            height: "48px",
            borderRadius: "14px",
            backgroundColor: "#FF6B00",
            color: "#FFFFFF",
            fontWeight: 800,
            fontSize: "14.5px",
            textTransform: "none",
            fontFamily: "Poppins, sans-serif",
            boxShadow: "0 4px 14px rgba(255, 107, 0, 0.25)",
            transition: "all 0.15s ease",
            "&:hover": {
              backgroundColor: "#E66000",
              boxShadow: "0 6px 18px rgba(255, 107, 0, 0.35)",
            },
            "&:active": {
              transform: "scale(0.98)",
            },
            "&.Mui-disabled": {
              backgroundColor: "#FFB380",
              color: "#FFFFFF",
            },
          }}
        >
          {loading ? (
            <CircularProgress size={22} sx={{ color: "#FFFFFF" }} />
          ) : effectiveLanguage === "tl" ? (
            "Ikansela ang booking"
          ) : (
            "Cancel booking"
          )}
        </Button>
      </Box>

      {/* Bottom Spacer */}
      <Box sx={{ height: 12 }} />
    </Box>
  );
};

export default PassengerCancelModal;
