import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PersonOutlinedIcon from "@mui/icons-material/PersonOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import Alert from "@mui/material/Alert";
import { useLanguage } from "../../../../utils/LanguageContext";
import PrimaryButton from "../../../../common/components/PrimaryButton";
import Logo from "../../../../common/components/Logo";
import SuccessModal from "../../../../common/components/SuccessModal";

const Login: React.FC = () => {
  const { language, t } = useLanguage();
  const navigate = useNavigate();

  // Form State
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // Validation / Message State
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Form Validations
    if (!identifier.trim()) {
      setError(t.phoneRequired);
      return;
    }
    if (!password) {
      setError(t.passwordRequired);
      return;
    }

    // Simulate login request
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setSuccess(true);
      setTimeout(() => {
        navigate("/");
      }, 1500);
    }, 1200);
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
            onClick={() => navigate("/")}
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
        <Box sx={{ marginTop: "44px", textAlign: "left", width: "100%" }}>
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
            }}
          >
            {t.loginSubtitle}
          </Typography>
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
            marginTop: "32px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            width: "100%",
          }}
        >
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
                      <PersonOutlinedIcon sx={{ color: "#94A3B8" }} />
                    </InputAdornment>
                  ),
                  sx: {
                    height: "56px",
                    backgroundColor: "#F8FAFC",
                    borderRadius: "14px",
                    "& fieldset": {
                      borderColor: "#F1F5F9",
                    },
                    "&:hover fieldset": {
                      borderColor: "#CBD5E1",
                    },
                    "&.Mui-focused fieldset": {
                      borderColor: "#FF6B00",
                    },
                  },
                },
              }}
            />
          </Box>

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
                    "& fieldset": {
                      borderColor: "#F1F5F9",
                    },
                    "&:hover fieldset": {
                      borderColor: "#CBD5E1",
                    },
                    "&.Mui-focused fieldset": {
                      borderColor: "#FF6B00",
                    },
                  },
                },
              }}
            />
          </Box>

          {/* Forgot Password Link */}
          <Box sx={{ width: "100%", display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
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

          <Box sx={{ marginTop: "24px", width: "100%" }}>
            <PrimaryButton type="submit" fullWidth loading={loading}>
              {t.loginLink.trim()}
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
            {t.dontHaveAccount}
            <Box
              component="span"
              onClick={() => navigate("/account-selection")}
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

        {/* Success Modal */}
        <SuccessModal
          open={success}
          title={language === "tl" ? "Matagumpay na Login!" : "Login Successful!"}
          message={t.successLogin}
        />
      </Box>
    </Box>
  );
};

export default Login;
