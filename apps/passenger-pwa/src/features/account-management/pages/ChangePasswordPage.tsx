import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import IconButton from "@mui/material/IconButton";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";

import PageHeader from "../../../common/components/PageHeader";
import { useLanguage } from "../../../utils/LanguageContext";
import { supabase } from "../../../services/supabaseClient";

const ChangePasswordPage: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    if (!newPassword || newPassword.length < 6) {
      setErrorMsg(
        language === "tl"
          ? "Ang bagong password ay dapat mayroong hindi bababa sa 6 na karakter."
          : "New password must be at least 6 characters."
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg(
        language === "tl"
          ? "Hindi magkatugma ang bagong password at kumpirmasyon."
          : "New password and confirm password do not match."
      );
      return;
    }

    setLoading(true);
    try {
      if (supabase && supabase.auth) {
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw error;
      }
      setSuccessMsg(
        language === "tl"
          ? "Matagumpay na nanalitan ang iyong password!"
          : "Password successfully updated!"
      );
      setTimeout(() => {
        navigate("/settings");
      }, 1500);
    } catch (err: any) {
      console.warn("Change password error:", err);
      setErrorMsg(
        err?.message ||
          (language === "tl"
            ? "Nagkaroon ng problema sa pagpapalit ng password."
            : "Failed to update password. Please try again.")
      );
    } finally {
      setLoading(false);
    }
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
        title={language === "tl" ? "Palitan ang Password" : "Change Password"}
        onBack={() => navigate("/settings")}
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
            gap: 2,
          }}
        >
          {errorMsg && (
            <Alert severity="error" sx={{ borderRadius: "12px", fontSize: "12px", fontFamily: "Poppins, sans-serif" }}>
              {errorMsg}
            </Alert>
          )}

          {successMsg && (
            <Alert severity="success" sx={{ borderRadius: "12px", fontSize: "12px", fontFamily: "Poppins, sans-serif" }}>
              {successMsg}
            </Alert>
          )}

          <TextField
            fullWidth
            type={showCurrentPassword ? "text" : "password"}
            label={language === "tl" ? "Kasalukuyang Password" : "Current Password"}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={() => setShowCurrentPassword(!showCurrentPassword)} edge="end">
                      {showCurrentPassword ? <VisibilityOffIcon sx={{ fontSize: 20 }} /> : <VisibilityIcon sx={{ fontSize: 20 }} />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
            sx={{
              "& .MuiOutlinedInput-root": {
                borderRadius: "14px",
                fontSize: "13px",
                fontFamily: "Poppins, sans-serif",
              },
            }}
          />

          <TextField
            fullWidth
            type={showNewPassword ? "text" : "password"}
            label={language === "tl" ? "Bagong Password" : "New Password"}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={() => setShowNewPassword(!showNewPassword)} edge="end">
                      {showNewPassword ? <VisibilityOffIcon sx={{ fontSize: 20 }} /> : <VisibilityIcon sx={{ fontSize: 20 }} />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
            sx={{
              "& .MuiOutlinedInput-root": {
                borderRadius: "14px",
                fontSize: "13px",
                fontFamily: "Poppins, sans-serif",
              },
            }}
          />

          <TextField
            fullWidth
            type={showConfirmPassword ? "text" : "password"}
            label={language === "tl" ? "Kumpirmahin ang Bagong Password" : "Confirm New Password"}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={() => setShowConfirmPassword(!showConfirmPassword)} edge="end">
                      {showConfirmPassword ? <VisibilityOffIcon sx={{ fontSize: 20 }} /> : <VisibilityIcon sx={{ fontSize: 20 }} />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
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
            disabled={loading || !newPassword || !confirmPassword}
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
              mt: 1,
              "&:hover": { backgroundColor: "#E66000", boxShadow: "none" },
            }}
          >
            {loading ? (
              <CircularProgress size={22} sx={{ color: "#FFFFFF" }} />
            ) : language === "tl" ? (
              "I-save ang Bagong Password"
            ) : (
              "Update Password"
            )}
          </Button>
        </Paper>
      </Box>
    </Box>
  );
};

export default ChangePasswordPage;
