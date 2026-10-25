import React, { useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import CloseIcon from "@mui/icons-material/Close";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { useLanguage } from "../../utils/LanguageContext";
import { PASSENGER_CANCEL_GRACE_SECONDS, PASSENGER_CANCEL_OPTIONS, activateWithKeyboard } from "@sakay/shared";

export interface PassengerCancelModalProps {
  open: boolean;
  onClose: () => void;
  onConfirmCancel: (reasonText: string) => void | Promise<void>;
  language?: "tl" | "en";
  loading?: boolean;
  /** Where the booking is, so the reminder tells the truth about the strike (Rules 12.1 / 12.2): still searching, driver accepted (on the way), driver arrived */
  phase?: "searching" | "accepted" | "arrived";
}

/**
 * What cancelling costs, in the words of Rules 12.1 / 12.2: nothing before a driver accepts, nothing within the grace minute after the acceptance while the driver
 * has not reached the pickup, one strike after that or once the driver has arrived. (The database decides; this only tells the passenger first.)
 */
const reminderText = (phase: "searching" | "accepted" | "arrived", language: "tl" | "en"): string => {
  const minutes = Math.max(1, Math.round(PASSENGER_CANCEL_GRACE_SECONDS / 60));
  if (phase === "searching") {
    return language === "tl" ? "Libre ang pagkansela hangga't wala pang drayber na tumatanggap." : "Free to cancel until a driver accepts.";
  }
  if (phase === "arrived") {
    return language === "tl"
      ? "Nakarating na ang drayber sa pickup. Ang pag-cancel ngayon ay may 1 strike."
      : "Your driver has arrived at the pickup. Cancelling now adds 1 strike.";
  }
  return language === "tl"
    ? `Libre ang pagkansela sa loob ng ${minutes} minuto matapos tumanggap ang drayber, hangga't hindi pa siya nakararating sa pickup. Pagkatapos nito, o kapag nakarating na siya, 1 strike ang idadagdag.`
    : `Free to cancel for ${minutes} minute after your driver accepts, as long as they have not reached the pickup. After that, or once they have arrived, cancelling adds 1 strike.`;
};

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
  phase = "accepted",
}) => {
  const { language: contextLanguage } = useLanguage();
  const effectiveLanguage = propLanguage || contextLanguage || "tl";

  const [selectedOptionId, setSelectedOptionId] = useState<string>("no_longer_needed");

  if (!open) return null;

  const handleConfirm = async () => {
    const selected = PASSENGER_CANCEL_OPTIONS.find((opt) => opt.id === selectedOptionId);
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
        "& > *": { flexShrink: 0 },
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
            fontSize: "17px",
            fontWeight: 700,
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
          {PASSENGER_CANCEL_OPTIONS.map((option) => {
            const isSelected = selectedOptionId === option.id;
            const label = effectiveLanguage === "tl" ? option.tl : option.en;

            return (
              <Box
                key={option.id}
                role="radio"
                tabIndex={0}
                onKeyDown={activateWithKeyboard}
                aria-checked={selectedOptionId === option.id}
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
                  border: isSelected ? "1.5px solid #FF6600" : "1px solid #F1F5F9",
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
                    fontSize: "14px",
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
                      border: "2px solid #FF6600",
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
                        backgroundColor: "#FF6600",
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
              fontSize: "12px",
              color: "#64748B",
              lineHeight: 1.4,
              fontFamily: "Poppins, sans-serif",
            }}
          >
            <Box component="span" sx={{ fontWeight: 700, color: "#475569" }}>
              {effectiveLanguage === "tl" ? "PAALALA:" : "REMINDER:"}
            </Box>{" "}
            {reminderText(phase, effectiveLanguage)}
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
            backgroundColor: "#FF6600",
            color: "#FFFFFF",
            fontWeight: 700,
            fontSize: "15px",
            textTransform: "none",
            fontFamily: "Poppins, sans-serif",
            boxShadow: "0 4px 14px rgba(255, 102, 0, 0.25)",
            transition: "all 0.15s ease",
            "&:hover": {
              backgroundColor: "#E65C00",
              boxShadow: "0 6px 18px rgba(255, 102, 0, 0.35)",
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
