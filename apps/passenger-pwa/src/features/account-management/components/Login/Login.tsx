import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";

import { useLanguage } from "../../../../utils/LanguageContext";
import PrimaryButton from "../../../../common/components/PrimaryButton";
import Logo from "../../../../common/components/Logo";
import SuccessModal from "../../../../common/components/SuccessModal";
import SakayToast from "../../../../common/components/SakayToast";
import { SakayPhoneInput } from "../../../../common/components/SakayPhoneInput";
import { RegisterInput } from "../../../../common/components/RegisterInput";
import { supabase } from "../../../../services/supabaseClient";
import { describeRestriction } from "@sakay/shared";
import { getOwnAccountRestriction, getPhoneLookupCandidates, rotatePassengerSession } from "../../../../services/passengerApiService";

const Login: React.FC = () => {
  const { language, t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();

  // Form State
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(false);

  // Toast and Modal State
  const [toastOpen, setToastOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const candidates = getPhoneLookupCandidates(phone);
  const isValidPhone = candidates.phoneRaw.length === 10 && candidates.phoneRaw.startsWith("9");
  const showPhoneError = phoneTouched && !isValidPhone;

  // Disabled if mobile number or password is empty or loading
  const isLoginDisabled = !phone.trim() || !password.trim() || loading;

  const triggerErrorToast = (msg: string) => {
    setToastMessage(msg);
    setToastOpen(true);
  };

  // The code screen sends a signed-out visitor here (its session ended): say why, once.
  useEffect(() => {
    if ((location.state as { otpSessionEnded?: boolean } | null)?.otpSessionEnded) {
      triggerErrorToast(
        language === "tl"
          ? "Natapos ang iyong session. Mag-log in upang ipagpatuloy ang pag-verify ng iyong numero."
          : "Your session ended. Log in to continue verifying your number."
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const handleBack = () => {
    navigate("/get-started");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoginDisabled) return;

    if (!isValidPhone) {
      triggerErrorToast(
        language === "tl"
          ? "Pakikumpleto ang 10-digit mobile number na nagsisimula sa 9."
          : "Please enter a valid 10-digit mobile number starting with 9."
      );
      return;
    }

    setLoading(true);

    try {
      // The login address is derived from the mobile number (the same one registration created). There is no lookup of
      // somebody's email before signing in, and no built-in test account: a login either works with real credentials or it does not.
      const signInResponse: any = await supabase.auth.signInWithPassword({
        email: `passenger_${candidates.phone63NoPlus}@sakay.ph`,
        password: password,
      });

      if (signInResponse?.error) {
        console.warn("Supabase signIn warning:", signInResponse.error.message);
        triggerErrorToast(
          language === "tl"
            ? "Mali ang numero o password. Pakisubukang muli."
            : "Invalid mobile number or password."
        );
        setLoading(false);
        return;
      }

      const user = signInResponse?.data?.user;

      if (user?.id) {
        // What this account IS is decided by its passenger record in the database, not by anything the account says about itself.
        const { data: profile } = await supabase
          .from("passenger")
          .select("passenger_id, account_status, full_name, date_of_birth, contact_number")
          .eq("auth_user_id", user.id)
          .maybeSingle();

        if (!profile) {
          triggerErrorToast(
            language === "tl"
              ? "Walang passenger account para sa numerong ito. Magparehistro muna."
              : "No passenger account was found for this number. Please register first."
          );
          setLoading(false);
          await supabase.auth.signOut();
          return;
        }

        // BATCH 2 FIX: Update single-session token upon new login
        try {
          await rotatePassengerSession(profile.passenger_id);
        } catch (err) {
          console.warn("Failed to rotate session:", err);
        }

        if (profile.account_status === "Pending OTP Verification") {
          // Not an error and not a dead end: the password was right, only the phone number is still unverified. Stay signed in and go
          // to the code screen (it needs this session to send and check the code). Signing the user out here is what made the two
          // screens send each other back and forth.
          setLoading(false);
          const pendingPhone = profile.contact_number || candidates.e164;
          navigate("/verify-otp", {
            replace: true,
            state: {
              phone: pendingPhone,
              identifier: pendingPhone,
              passengerName: profile.full_name || "Passenger",
              fullName: profile.full_name || "Passenger",
              role: "passenger",
              date_of_birth: profile.date_of_birth || undefined,
              isRecovery: false,
              fromLogin: true,
            },
          });
          return;
        }

        // The database decides suspension / deactivation (and lifts a suspension whose
        // period has ended). Falls back to the status column if the check is unavailable.
        const restriction = await getOwnAccountRestriction("passenger");
        const isRestricted = restriction
          ? restriction.restricted
          : profile.account_status === "Suspended" || profile.account_status === "Deactivated";
        if (isRestricted) {
          triggerErrorToast(
            restriction
              ? describeRestriction(restriction, language === "tl" ? "tl" : "en")
              : language === "tl"
                ? "Ang inyong account ay suspendido o na-deactivate."
                : "Your account has been suspended or deactivated."
          );
          setLoading(false);
          await supabase.auth.signOut();
          return;
        }
      } else {
        triggerErrorToast(
          language === "tl"
            ? "Hindi matagumpay ang pag-login. Pakisubukang muli."
            : "Login failed. Please try again."
        );
        setLoading(false);
        return;
      }

      setLoading(false);
      setSuccess(true);
      setTimeout(() => {
        navigate("/dashboard", {
          replace: true,
          state: {
            name: user?.user_metadata?.full_name || "Passenger",
          },
        });
      }, 1200);
    } catch (err: unknown) {
      const errMsg =
        err instanceof Error ? err.message : "An unexpected error occurred during login.";
      triggerErrorToast(errMsg);
      setLoading(false);
    }
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
      {/* Toast Error Notification */}
      <SakayToast
        open={toastOpen}
        message={toastMessage}
        severity="error"
        onClose={() => setToastOpen(false)}
      />

      {/* Sticky Fixed Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          padding: "16px 24px 12px 24px",
          paddingTop: "calc(var(--safe-area-top) + 16px)",
          backgroundColor: "#FFFFFF",
          zIndex: 20,
          flexShrink: 0,
          borderBottom: "1px solid rgba(226, 232, 240, 0.6)",
        }}
      >
        <IconButton
          onClick={handleBack}
          sx={{
            backgroundColor: "#FFFFFF",
            border: "1px solid #E2E8F0",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
            color: "#1A1A1A",
            borderRadius: "14px",
            width: "44px",
            height: "44px",
            "&:hover": {
              backgroundColor: "#F8FAFC",
            },
          }}
        >
          <ArrowBackIcon sx={{ fontSize: 20 }} />
        </IconButton>

        <Logo color="orange" width={110} />
      </Box>

      {/* Scrollable Form Body */}
      <Box
        component="form"
        onSubmit={handleSubmit}
        className="anim-fade-in hide-scrollbar"
        sx={{
          flexGrow: 1,
          overflowY: "auto",
          padding: "24px 24px calc(var(--safe-area-bottom) + 24px) 24px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <Box sx={{ width: "100%" }}>
          {/* Title Section */}
          <Box sx={{ marginTop: "8px", textAlign: "left", width: "100%" }}>
            <Typography
              component="h2"
              sx={{
                fontSize: "26px",
                fontWeight: 800,
                color: "#0F172A",
                lineHeight: 1.3,
              }}
            >
              {t.loginTitle}
            </Typography>
            <Typography
              sx={{
                fontSize: "15px",
                color: "#64748B",
                marginTop: "8px",
                lineHeight: 1.5,
                fontWeight: 500,
              }}
            >
              {language === "tl"
                ? "Ilagay ang inyong numero ng telepono at password upang mag-login."
                : "Enter your mobile number and password to log in."}
            </Typography>
          </Box>

          {/* Form Fields */}
          <Box
            sx={{
              marginTop: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
              width: "100%",
            }}
          >
            {/* Mobile Number with SakayPhoneInput */}
            <SakayPhoneInput
              label={language === "tl" ? "NUMERO NG TELEPONO" : "MOBILE NUMBER"}
              value={phone}
              onChange={(fullVal) => setPhone(fullVal)}
              onFocus={() => setPhoneTouched(true)}
              onBlur={() => setPhoneTouched(true)}
              required
              error={showPhoneError}
              helperText={
                showPhoneError
                  ? language === "tl"
                    ? "Pakikumpleto ang 10-digit mobile number na nagsisimula sa 9."
                    : "Please enter a valid 10-digit mobile number starting with 9."
                  : ""
              }
            />

            {/* Password Input with RegisterInput */}
            <RegisterInput
              label="PASSWORD"
              required
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(val) => setPassword(val)}
              endAdornment={
                <IconButton
                  onClick={() => setShowPassword(!showPassword)}
                  edge="end"
                  size="small"
                  sx={{ color: "#64748B" }}
                >
                  {showPassword ? (
                    <VisibilityOffOutlinedIcon fontSize="small" />
                  ) : (
                    <VisibilityOutlinedIcon fontSize="small" />
                  )}
                </IconButton>
              }
            />

            {/* Forgot Password Link */}
            <Box sx={{ width: "100%", display: "flex", justifyContent: "flex-end", marginTop: "4px" }}>
              <Typography
                onClick={() => navigate("/forgot-password")}
                sx={{
                  fontSize: "14px",
                  color: "#FF6B00",
                  fontWeight: 600,
                  cursor: "pointer",
                  "&:hover": {
                    textDecoration: "underline",
                    color: "#E66000",
                  },
                }}
              >
                {t.forgotPassword}
              </Typography>
            </Box>
          </Box>
        </Box>

        {/* Bottom Actions: Mag-login Button + Register Link */}
        <Box
          sx={{
            marginTop: "auto",
            paddingTop: "24px",
            width: "100%",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          <PrimaryButton type="submit" fullWidth disabled={isLoginDisabled} loading={loading}>
            {t.loginLink.trim()}
          </PrimaryButton>

          <Typography
            sx={{
              textAlign: "center",
              fontSize: "14px",
              color: "#0F172A",
              fontWeight: 600,
            }}
          >
            {t.dontHaveAccount}
            <Box
              component="span"
              onClick={() => navigate("/register")}
              sx={{
                color: "#FF6B00",
                fontWeight: 700,
                cursor: "pointer",
                marginLeft: "6px",
                transition: "color 0.2s",
                "&:hover": {
                  color: "#E66000",
                  textDecoration: "underline",
                },
              }}
            >
              {t.registerLink.trim()}
            </Box>
          </Typography>
        </Box>
      </Box>

      {/* Success Modal */}
      <SuccessModal
        open={success}
        title={language === "tl" ? "Matagumpay na Login!" : "Login Successful!"}
        message={t.successLogin}
      />
    </Box>
  );
};

export default Login;
