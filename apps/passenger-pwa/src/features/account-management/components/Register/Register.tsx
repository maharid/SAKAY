import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PersonOutlinedIcon from "@mui/icons-material/PersonOutlined";
import EmailOutlinedIcon from "@mui/icons-material/EmailOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import BadgeIcon from "@mui/icons-material/Badge";
import AssignmentIcon from "@mui/icons-material/Assignment";
import ContactPageIcon from "@mui/icons-material/ContactPage";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
import PersonIcon from "@mui/icons-material/Person";
import SportsMotorsportsIcon from "@mui/icons-material/SportsMotorsports";
import { useLanguage } from "../../../../utils/LanguageContext";
import PrimaryButton from "../../../../common/components/PrimaryButton";
import Logo from "../../../../common/components/Logo";
import SuccessModal from "../../../../common/components/SuccessModal";

const Register: React.FC = () => {
  const { language, t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();

  // Retrieve selected role from AccountSelection page state
  const selectedRole = (location.state as { role?: "passenger" | "driver" })?.role || "passenger";

  // Common Form State
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  // Driver Form State
  const [todaName, setTodaName] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [plateNumber, setPlateNumber] = useState("");

  // Loading/Feedback State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Basic Validations
    if (!name.trim()) {
      setError(t.nameRequired);
      return;
    }
    if (!identifier.trim()) {
      setError(t.phoneRequired);
      return;
    }

    // Driver Specific Validations
    if (selectedRole === "driver") {
      if (!todaName.trim()) {
        setError(language === "tl" ? "Kailangan ang TODA Name/Number" : "TODA Name/Number is required");
        return;
      }
      if (!licenseNumber.trim()) {
        setError(language === "tl" ? "Kailangan ang Driver's License" : "Driver's License is required");
        return;
      }
      if (!plateNumber.trim()) {
        setError(language === "tl" ? "Kailangan ang Plate Number" : "Tricycle Plate Number is required");
        return;
      }
    }

    if (!password) {
      setError(t.passwordRequired);
      return;
    }
    if (password !== confirmPassword) {
      setError(t.passwordsMustMatch);
      return;
    }

    // Simulate OTP Code Generation
    const mockOtp = "123456";
    console.log(`[PASADA Auth] OTP Code generated for ${identifier}: ${mockOtp}`);

    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setSuccess(true);
      setTimeout(() => {
        // Navigate to verify OTP, passing signup state to finalize signup on verification success
        navigate("/verify-otp", {
          state: {
            identifier,
            role: selectedRole,
            signupData: {
              name,
              identifier,
              password,
              todaName,
              licenseNumber,
              plateNumber,
              otpCode: mockOtp,
            },
          },
        });
      }, 1200);
    }, 1000);
  };

  return (
    <Box className="app-container">
      <Box
        component="main"
        className="phone-simulator hide-scrollbar"
        sx={{
          padding: "24px",
          backgroundColor: "#FFFFFF",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
        }}
      >
        {/* Header */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: "24px",
            width: "100%",
          }}
        >
          <IconButton
            onClick={() => navigate("/account-selection")}
            sx={{
              backgroundColor: "#FFFFFF",
              border: "1px solid #E2E8F0",
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)",
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

          <Logo color="orange" />
        </Box>

        {/* Title Section */}
        <Box sx={{ marginTop: "24px", textAlign: "left", width: "100%" }}>
          <Typography
            component="h2"
            sx={{
              fontSize: "26px",
              fontWeight: 800,
              color: "#0F172A",
              lineHeight: 1.3,
            }}
          >
            {t.registerTitle}
          </Typography>
          <Typography
            sx={{
              fontSize: "15px",
              color: "#64748B",
              marginTop: "6px",
            }}
          >
            {t.registerSubtitle}
          </Typography>
        </Box>

        {/* Selected Role Badge */}
        <Box className="anim-scale-in" sx={{ marginTop: "16px", display: "flex", justifyContent: "flex-start", width: "100%" }}>
          <Chip
            icon={selectedRole === "passenger" ? <PersonIcon /> : <SportsMotorsportsIcon />}
            label={`${selectedRole === "passenger" ? t.passenger : t.driver} Account`}
            color="primary"
            variant="outlined"
            sx={{
              fontWeight: 600,
              borderRadius: "10px",
              backgroundColor: "rgba(255, 107, 0, 0.05)",
              borderColor: "rgba(255, 107, 0, 0.3)",
              color: "#FF6B00",
              "& .MuiChip-icon": { color: "#FF6B00" },
              height: "36px",
              padding: "4px 8px",
            }}
          />
        </Box>

        {/* Error Alert */}
        {error && (
          <Alert severity="error" sx={{ width: "100%", marginTop: "16px", borderRadius: "12px" }}>
            {error}
          </Alert>
        )}

        {/* Form */}
        <Box
          component="form"
          onSubmit={handleSubmit}
          className="anim-fade-in"
          sx={{
            marginTop: "24px",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
            width: "100%",
          }}
        >
          {/* Full Name */}
          <Box sx={{ width: "100%" }}>
            <TextField
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
              placeholder={t.fullName}
              type="text"
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <PersonOutlinedIcon sx={{ color: "#94A3B8" }} />
                    </InputAdornment>
                  ),
                  sx: {
                    height: "56px",
                    backgroundColor: "#F8FAFC",
                    borderRadius: "14px",
                    "& fieldset": { borderColor: "#F1F5F9" },
                    "&:hover fieldset": { borderColor: "#CBD5E1" },
                    "&.Mui-focused fieldset": { borderColor: "#FF6B00" },
                  },
                },
              }}
            />
          </Box>

          {/* Email or Mobile Number */}
          <Box sx={{ width: "100%" }}>
            <TextField
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              disabled={loading}
              placeholder={t.phoneOrEmail}
              type="text"
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <EmailOutlinedIcon sx={{ color: "#94A3B8" }} />
                    </InputAdornment>
                  ),
                  sx: {
                    height: "56px",
                    backgroundColor: "#F8FAFC",
                    borderRadius: "14px",
                    "& fieldset": { borderColor: "#F1F5F9" },
                    "&:hover fieldset": { borderColor: "#CBD5E1" },
                    "&.Mui-focused fieldset": { borderColor: "#FF6B00" },
                  },
                },
              }}
            />
          </Box>

          {/* Driver Specific Fields */}
          {selectedRole === "driver" && (
            <>
              {/* TODA Number / Name */}
              <Box sx={{ width: "100%" }}>
                <TextField
                  value={todaName}
                  onChange={(e) => setTodaName(e.target.value)}
                  disabled={loading}
                  placeholder={language === "tl" ? "TODA Name / Operator No." : "TODA Name / Operator No."}
                  type="text"
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <AssignmentIcon sx={{ color: "#94A3B8" }} />
                        </InputAdornment>
                      ),
                      sx: {
                        height: "56px",
                        backgroundColor: "#F8FAFC",
                        borderRadius: "14px",
                        "& fieldset": { borderColor: "#F1F5F9" },
                        "&:hover fieldset": { borderColor: "#CBD5E1" },
                        "&.Mui-focused fieldset": { borderColor: "#FF6B00" },
                      },
                    },
                  }}
                />
              </Box>

              {/* Driver's License Number */}
              <Box sx={{ width: "100%" }}>
                <TextField
                  value={licenseNumber}
                  onChange={(e) => setLicenseNumber(e.target.value)}
                  disabled={loading}
                  placeholder={language === "tl" ? "Driver's License Number" : "Driver's License Number"}
                  type="text"
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <BadgeIcon sx={{ color: "#94A3B8" }} />
                        </InputAdornment>
                      ),
                      sx: {
                        height: "56px",
                        backgroundColor: "#F8FAFC",
                        borderRadius: "14px",
                        "& fieldset": { borderColor: "#F1F5F9" },
                        "&:hover fieldset": { borderColor: "#CBD5E1" },
                        "&.Mui-focused fieldset": { borderColor: "#FF6B00" },
                      },
                    },
                  }}
                />
              </Box>

              {/* Tricycle Plate Number */}
              <Box sx={{ width: "100%" }}>
                <TextField
                  value={plateNumber}
                  onChange={(e) => setPlateNumber(e.target.value)}
                  disabled={loading}
                  placeholder={language === "tl" ? "Tricycle Plate Number" : "Tricycle Plate Number"}
                  type="text"
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <ContactPageIcon sx={{ color: "#94A3B8" }} />
                        </InputAdornment>
                      ),
                      sx: {
                        height: "56px",
                        backgroundColor: "#F8FAFC",
                        borderRadius: "14px",
                        "& fieldset": { borderColor: "#F1F5F9" },
                        "&:hover fieldset": { borderColor: "#CBD5E1" },
                        "&.Mui-focused fieldset": { borderColor: "#FF6B00" },
                      },
                    },
                  }}
                />
              </Box>
            </>
          )}

          {/* Password */}
          <Box sx={{ width: "100%" }}>
            <TextField
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              placeholder={t.password}
              type={showPassword ? "text" : "password"}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <LockOutlinedIcon sx={{ color: "#94A3B8" }} />
                    </InputAdornment>
                  ),
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowPassword(!showPassword)}
                        edge="end"
                        disabled={loading}
                      >
                        {showPassword ? <VisibilityOff sx={{ color: "#94A3B8" }} /> : <Visibility sx={{ color: "#94A3B8" }} />}
                      </IconButton>
                    </InputAdornment>
                  ),
                  sx: {
                    height: "56px",
                    backgroundColor: "#F8FAFC",
                    borderRadius: "14px",
                    "& fieldset": { borderColor: "#F1F5F9" },
                    "&:hover fieldset": { borderColor: "#CBD5E1" },
                    "&.Mui-focused fieldset": { borderColor: "#FF6B00" },
                  },
                },
              }}
            />
          </Box>

          {/* Confirm Password */}
          <Box sx={{ width: "100%" }}>
            <TextField
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading}
              placeholder={t.confirmPassword}
              type={showConfirmPassword ? "text" : "password"}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <LockOutlinedIcon sx={{ color: "#94A3B8" }} />
                    </InputAdornment>
                  ),
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        edge="end"
                        disabled={loading}
                      >
                        {showConfirmPassword ? <VisibilityOff sx={{ color: "#94A3B8" }} /> : <Visibility sx={{ color: "#94A3B8" }} />}
                      </IconButton>
                    </InputAdornment>
                  ),
                  sx: {
                    height: "56px",
                    backgroundColor: "#F8FAFC",
                    borderRadius: "14px",
                    "& fieldset": { borderColor: "#F1F5F9" },
                    "&:hover fieldset": { borderColor: "#CBD5E1" },
                    "&.Mui-focused fieldset": { borderColor: "#FF6B00" },
                  },
                },
              }}
            />
          </Box>

          {/* Signup Button */}
          <Box sx={{ marginTop: "16px", width: "100%" }}>
            <PrimaryButton type="submit" fullWidth loading={loading}>
              {t.createAccountBtn}
            </PrimaryButton>
          </Box>
        </Box>

        {/* Bottom Link */}
        <Box
          className="anim-fade-in-up"
          sx={{
            marginTop: "auto",
            paddingBottom: "24px",
            textAlign: "center",
            width: "100%",
          }}
        >
          <Typography
            sx={{
              fontSize: "14px",
              color: "#0F172A",
              fontWeight: 600,
            }}
          >
            {t.hasAccount}
            <Box
              component="span"
              onClick={() => navigate("/login")}
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
              {t.loginLink.trim()}
            </Box>
          </Typography>
        </Box>

        {/* Success Modal */}
        <SuccessModal
          open={success}
          title={language === "tl" ? "Matagumpay na Pagrehistro!" : "Registration Successful!"}
          message={t.successRegister}
        />
      </Box>
    </Box>
  );
};

export default Register;
