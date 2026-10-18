import React, { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import { checkPassword, extendTapArea, usePasswordRecovery } from "@sakay/shared";
import { useLanguage } from "../../../../utils/LanguageContext";
import PrimaryButton from "../../../../common/components/PrimaryButton";
import Logo from "../../../../common/components/Logo";
import SuccessModal from "../../../../common/components/SuccessModal";
import SakayToast from "../../../../common/components/SakayToast";
import { RegisterInput } from "../../../../common/components/RegisterInput";

/**
 * Step 2 of password recovery: the 6-digit code that was texted, and the new password. The server checks the password rules first (a weak
 * password does not use up the code), then the code (five wrong ones lock the number for 15 minutes), then sets the password. The person
 * is NOT signed in by this: she logs in with the new password, which ends her login on any other phone.
 */
const ResetPassword: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const recovery = usePasswordRecovery("passenger", language);
  const tl = language === "tl";

  const state = location.state as { phone?: string; justSent?: boolean } | null;
  const phone = state?.phone ?? "";

  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [toastOpen, setToastOpen] = useState(false);
  const [success, setSuccess] = useState(false);

  // A code was just sent by the screen before this one: the next may be asked for after the usual wait
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (state?.justSent) recovery.startResendWait();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Without a number (this page was opened directly, or reloaded) there is nothing to finish: start from the number
  if (!phone) return <Navigate to="/forgot-password" replace />;

  const check = checkPassword(password);
  const matches = password.length > 0 && password === confirmPassword;
  const locked = recovery.lockedMinutes > 0;
  const canSubmit = code.length === 6 && check.ok && matches && !locked && !recovery.busy;

  const criteria = [
    { met: check.length, label: tl ? "Hindi bababa sa 8 karakter" : "At least 8 characters" },
    { met: check.letters, label: tl ? "Malalaking (A-Z) at maliliit (a-z) na titik" : "Upper (A-Z) and lower case (a-z) letters" },
    { met: check.digit, label: tl ? "May numero (0-9)" : "A number (0-9)" },
    { met: check.symbol, label: tl ? "May simbolo (@, #, $, atbp.)" : "A symbol (@, #, $, etc.)" },
  ];

  const maskedPhone = phone.length > 6 ? `${phone.slice(0, 5)}*****${phone.slice(-2)}` : phone;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const ok = await recovery.changePassword(phone, code, password);
    if (ok) {
      setSuccess(true);
      setTimeout(() => navigate("/login", { replace: true }), 1800);
      return;
    }
    // a code that is wrong, spent or expired is not worth keeping on screen
    setCode("");
    setToastOpen(true);
  };

  const handleResend = async () => {
    if (recovery.resendSeconds > 0 || recovery.busy) return;
    const sent = await recovery.requestCode(phone);
    if (sent) setCode("");
    setToastOpen(!sent);
  };

  const eye = (shown: boolean, toggle: () => void, labelOn: string, labelOff: string) => (
    <IconButton aria-label={shown ? labelOff : labelOn} onClick={toggle} edge="end" size="small" sx={{ ...extendTapArea(8), color: "#64748B" }}>
      {shown ? <VisibilityOffOutlinedIcon fontSize="small" /> : <VisibilityOutlinedIcon fontSize="small" />}
    </IconButton>
  );

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
      <SakayToast open={toastOpen} message={recovery.message} severity="error" onClose={() => setToastOpen(false)} />

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
          onClick={() => navigate("/forgot-password")}
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
            {tl ? "I-reset ang Password" : "Reset Password"}
          </Typography>
          <Typography sx={{ fontSize: "15px", color: "#64748B", marginTop: "8px", lineHeight: 1.5, fontWeight: 500 }}>
            {tl
              ? `Ilagay ang 6-digit na code na ipinadala sa ${maskedPhone} at gumawa ng bagong password.`
              : `Enter the 6-digit code we texted to ${maskedPhone}, then choose a new password.`}
          </Typography>
        </Box>

        {locked && (
          <Alert severity="warning" sx={{ width: "100%", marginTop: "20px", borderRadius: "12px" }}>
            {tl
              ? `Masyadong maraming maling code. Subukan muli pagkalipas ng ${recovery.lockedMinutes} minuto.`
              : `Too many wrong codes. Please try again in ${recovery.lockedMinutes} minute${recovery.lockedMinutes === 1 ? "" : "s"}.`}
          </Alert>
        )}

        <Box sx={{ marginTop: "24px", display: "flex", flexDirection: "column", gap: "16px", width: "100%" }}>
          <RegisterInput
            label={tl ? "6-digit na code" : "6-digit code"}
            required
            value={code}
            onChange={(val) => setCode(val.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            readOnly={locked}
          />

          <RegisterInput
            label={tl ? "Bagong password" : "New password"}
            required
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            endAdornment={eye(
              showPassword,
              () => setShowPassword(!showPassword),
              tl ? "Ipakita ang password" : "Show password",
              tl ? "Itago ang password" : "Hide password"
            )}
          />

          <Box component="ul" aria-label={tl ? "Mga patakaran sa password" : "Password rules"} sx={{ listStyle: "none", m: 0, p: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
            {criteria.map((c) => (
              <Box component="li" key={c.label} sx={{ display: "flex", alignItems: "center", gap: "8px", color: c.met ? "#15803D" : "#64748B", fontSize: "13px", fontWeight: 500 }}>
                {c.met ? <CheckCircleIcon sx={{ fontSize: 16 }} aria-label={tl ? "Natupad" : "Met"} /> : <RadioButtonUncheckedIcon sx={{ fontSize: 16 }} aria-label={tl ? "Hindi pa natutupad" : "Not met yet"} />}
                {c.label}
              </Box>
            ))}
          </Box>

          <RegisterInput
            label={tl ? "Kumpirmahin ang bagong password" : "Confirm new password"}
            required
            type={showConfirm ? "text" : "password"}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            error={confirmPassword.length > 0 && !matches}
            helperText={confirmPassword.length > 0 && !matches ? (tl ? "Dapat magtugma ang password" : "Passwords must match") : ""}
            endAdornment={eye(
              showConfirm,
              () => setShowConfirm(!showConfirm),
              tl ? "Ipakita ang kumpirmadong password" : "Show confirmed password",
              tl ? "Itago ang kumpirmadong password" : "Hide confirmed password"
            )}
          />
        </Box>

        <Box sx={{ marginTop: "28px", width: "100%" }}>
          <PrimaryButton type="submit" fullWidth loading={recovery.busy} disabled={!canSubmit}>
            {tl ? "I-update ang Password" : "Update Password"}
          </PrimaryButton>
        </Box>

        <Box sx={{ marginTop: "12px", width: "100%", display: "flex", justifyContent: "center" }}>
          <Button
            type="button"
            onClick={handleResend}
            disabled={recovery.resendSeconds > 0 || recovery.busy || locked}
            sx={{ textTransform: "none", fontWeight: 600, color: "#FF6600", minHeight: 44 }}
          >
            {recovery.resendSeconds > 0
              ? tl
                ? `Humiling muli ng code (${recovery.resendSeconds}s)`
                : `Send a new code (${recovery.resendSeconds}s)`
              : tl
                ? "Humiling muli ng code"
                : "Send a new code"}
          </Button>
        </Box>
      </Box>

      <SuccessModal
        open={success}
        title={tl ? "Napalitan na ang Password!" : "Password Changed!"}
        message={tl ? "Mag-login gamit ang iyong bagong password." : "Log in with your new password."}
      />
    </Box>
  );
};

export default ResetPassword;
