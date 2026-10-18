import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { usePasswordRecovery } from "@sakay/shared";
import { useLanguage } from "../../../../utils/LanguageContext";
import PrimaryButton from "../../../../common/components/PrimaryButton";
import Logo from "../../../../common/components/Logo";
import SakayToast from "../../../../common/components/SakayToast";
import { SakayPhoneInput } from "../../../../common/components/SakayPhoneInput";
import { getPhoneLookupCandidates } from "../../../../services/passengerApiService";

/**
 * Step 1 of password recovery (Rule 4.2 sends a person whose number is already registered here): the mobile number. The server texts a
 * 6-digit code to the number of an existing passenger account (and says the same thing whether or not there is one), then the next screen
 * takes the code and the new password.
 */
const ForgotPassword: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const recovery = usePasswordRecovery("passenger", language);

  // Registration sends a person whose number is taken here with the number she typed (Rule 4.2)
  const [phone, setPhone] = useState(() => (location.state as { phone?: string } | null)?.phone ?? "");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [toastOpen, setToastOpen] = useState(false);

  const candidates = getPhoneLookupCandidates(phone);
  const isValidPhone = candidates.phoneRaw.length === 10 && candidates.phoneRaw.startsWith("9");
  const showPhoneError = phoneTouched && !isValidPhone;
  const tl = language === "tl";

  const goToCode = (justSent: boolean) =>
    navigate("/reset-password", { state: { phone: candidates.e164, justSent } });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (recovery.busy) return;
    if (!isValidPhone) {
      setPhoneTouched(true);
      return;
    }
    const sent = await recovery.requestCode(candidates.e164);
    if (sent) goToCode(true);
    else setToastOpen(true);
  };

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        backgroundColor: "#FFFFFF",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <SakayToast
        open={toastOpen}
        message={recovery.message}
        severity="error"
        onClose={() => setToastOpen(false)}
      />

      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          padding: "16px 24px 12px 24px",
          paddingTop: "calc(var(--safe-area-top) + 16px)",
          backgroundColor: "#FFFFFF",
          flexShrink: 0,
          borderBottom: "1px solid rgba(226, 232, 240, 0.6)",
        }}
      >
        <IconButton
          aria-label={tl ? "Bumalik" : "Back"}
          onClick={() => navigate("/login")}
          sx={{
            backgroundColor: "#FFFFFF",
            border: "1px solid #E2E8F0",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)",
            color: "#1A1A1A",
            borderRadius: "14px",
            width: "44px",
            height: "44px",
            "&:hover": { backgroundColor: "#F8FAFC" },
          }}
        >
          <ArrowBackIcon sx={{ fontSize: 20 }} />
        </IconButton>
        <Logo color="orange" />
      </Box>

      <Box
        component="form"
        onSubmit={handleSubmit}
        noValidate
        className="anim-fade-in hide-scrollbar"
        sx={{
          flexGrow: 1,
          overflowY: "auto",
          "& > *": { flexShrink: 0 },
          padding: "24px 24px calc(var(--safe-area-bottom) + 24px) 24px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Box sx={{ marginTop: "8px", textAlign: "left", width: "100%" }}>
          <Typography component="h2" sx={{ fontSize: "24px", fontWeight: 700, color: "#0F172A", lineHeight: 1.3 }}>
            {tl ? "Nakalimutan ang Password?" : "Forgot Password?"}
          </Typography>
          <Typography sx={{ fontSize: "15px", color: "#64748B", marginTop: "8px", lineHeight: 1.5, fontWeight: 500 }}>
            {tl
              ? "Ilagay ang numero ng telepono ng iyong account. Magpapadala kami ng 6-digit na code sa SMS."
              : "Enter the mobile number of your account. We will text you a 6-digit code."}
          </Typography>
        </Box>

        <Box sx={{ marginTop: "24px", width: "100%" }}>
          <SakayPhoneInput
            label={tl ? "Numero ng telepono" : "Mobile number"}
            value={phone}
            onChange={(fullVal) => setPhone(fullVal)}
            onFocus={() => setPhoneTouched(true)}
            onBlur={() => setPhoneTouched(true)}
            required
            error={showPhoneError}
            helperText={
              showPhoneError
                ? tl
                  ? "Pakikumpleto ang 10-digit mobile number na nagsisimula sa 9."
                  : "Please enter a valid 10-digit mobile number starting with 9."
                : ""
            }
          />
        </Box>

        <Box sx={{ marginTop: "32px", width: "100%" }}>
          <PrimaryButton type="submit" fullWidth loading={recovery.busy} disabled={!isValidPhone}>
            {tl ? "Ipadala ang Code" : "Send Code"}
          </PrimaryButton>
        </Box>

        {/* The code may already be on the phone (this screen was left, or the code was asked for a moment ago) */}
        <Box sx={{ marginTop: "12px", width: "100%", display: "flex", justifyContent: "center" }}>
          <Button
            type="button"
            disabled={!isValidPhone || recovery.busy}
            onClick={() => goToCode(false)}
            sx={{ textTransform: "none", fontWeight: 600, color: "#FF6600", minHeight: 44 }}
          >
            {tl ? "May code na ako" : "I already have a code"}
          </Button>
        </Box>
      </Box>
    </Box>
  );
};

export default ForgotPassword;
