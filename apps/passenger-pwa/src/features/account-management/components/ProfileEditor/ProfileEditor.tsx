import React, { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import Avatar from "@mui/material/Avatar";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";

import { useLanguage } from "../../../../utils/LanguageContext";
import PrimaryButton from "../../../../common/components/PrimaryButton";
import SuccessModal from "../../../../common/components/SuccessModal";
import PageHeader from "../../../../common/components/PageHeader";
import { RegisterInput } from "../../../../common/components/RegisterInput";
import { SakayPhoneInput } from "../../../../common/components/SakayPhoneInput";
import { supabase } from "../../../../services/supabaseClient";

export const ProfileEditor: React.FC = () => {
  const { language, t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();

  const locationState = location.state as { phoneUpdated?: boolean } | null;

  // Load States
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Profile Form States
  const [fullName, setFullName] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [initialContactNumber, setInitialContactNumber] = useState("");
  const [address, setAddress] = useState("");
  const [profilePhotoUrl, setProfilePhotoUrl] = useState("");

  // Feedback State
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const fetchUserProfile = useCallback(async (showLoading = false) => {
    try {
      const { data: { user }, error: authErr } = await supabase.auth.getUser();

      if (showLoading) {
        setLoadingProfile(true);
      }
      setError(null);

      if (authErr || !user) {
        setError(language === "tl" ? "Mangyaring mag-login muli." : "Please log in again.");
        setLoadingProfile(false);
        navigate("/login");
        return;
      }

      const storedPhone = localStorage.getItem("sakay_passenger_phone") || user.phone || "";
      setContactNumber(storedPhone);
      setInitialContactNumber(storedPhone);

      // Fetch passenger profile from database
      const { data: profile, error: dbErr } = await supabase
        .from("passenger")
        .select("full_name, residential_address, profile_photo_url, contact_number")
        .eq("auth_user_id", user.id)
        .maybeSingle();

      if (dbErr) {
        console.error("Error fetching database profile:", dbErr);
      }

      if (profile) {
        setFullName(profile.full_name || user.user_metadata?.full_name || "");
        setAddress(profile.residential_address || "");
        setProfilePhotoUrl(profile.profile_photo_url || "");
        if (profile.contact_number) {
          setContactNumber(profile.contact_number);
          setInitialContactNumber(profile.contact_number);
        }
      } else {
        setFullName(user.user_metadata?.full_name || "");
      }

      setLoadingProfile(false);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Failed to load user profile.";
      setError(errMsg);
      setLoadingProfile(false);
    }
  }, [language, navigate]);

  useEffect(() => {
    fetchUserProfile();
  }, [fetchUserProfile]);

  useEffect(() => {
    if (locationState?.phoneUpdated) {
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    }
  }, [locationState]);

  // Upload Profile Picture to Supabase Storage
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setUploadingPhoto(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User session not found.");

      const fileExt = file.name.split(".").pop();
      const fileName = `${user.id}-${Date.now()}.${fileExt}`;
      const filePath = `avatars/${fileName}`;

      const { error: uploadErr } = await supabase.storage
        .from("profiles")
        .upload(filePath, file, { upsert: true });

      if (uploadErr) {
        throw new Error(uploadErr.message);
      }

      const { data: { publicUrl } } = supabase.storage
        .from("profiles")
        .getPublicUrl(filePath);

      setProfilePhotoUrl(publicUrl);

      const { error: updateErr } = await supabase
        .from("passenger")
        .update({ profile_photo_url: publicUrl })
        .eq("auth_user_id", user.id);

      if (updateErr) {
        throw new Error(updateErr.message);
      }

      await supabase.auth.updateUser({
        data: { profile_photo_url: publicUrl },
      });
    } catch (err: unknown) {
      const errMsg =
        err instanceof Error
          ? err.message
          : "Failed to upload photo. Make sure a public storage bucket named 'profiles' is configured.";
      setError(errMsg);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const cleanDigits = (num: string) => num.replace(/\D/g, "");

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!fullName.trim()) {
      setError(t.nameRequired || "Name is required");
      return;
    }

    setSaving(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No active user session.");

      // 1. Update name and address in DB
      const { error: dbUpdateErr } = await supabase
        .from("passenger")
        .update({
          full_name: fullName.trim(),
          residential_address: address.trim(),
        })
        .eq("auth_user_id", user.id);

      if (dbUpdateErr) {
        throw new Error(dbUpdateErr.message);
      }

      await supabase.auth.updateUser({
        data: {
          full_name: fullName.trim(),
        },
      });

      const cleanNewPhone = cleanDigits(contactNumber);
      const cleanOldPhone = cleanDigits(initialContactNumber);

      // Check if mobile number changed
      if (cleanNewPhone && cleanNewPhone !== cleanOldPhone) {
        setSaving(false);
        // Navigate to OTP verification for mobile number change
        navigate("/verify-otp", {
          state: {
            phone: contactNumber,
            fullName: fullName.trim(),
            isPhoneChange: true,
            oldPhone: initialContactNumber,
            returnTo: "/profile",
          },
        });
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        fetchUserProfile();
      }, 1500);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Failed to update profile.";
      setError(errMsg);
    } finally {
      setSaving(false);
    }
  };

  if (loadingProfile) {
    return (
      <Box
        sx={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#FFFFFF",
        }}
      >
        <CircularProgress sx={{ color: "#FF6B00" }} />
        <Typography sx={{ marginTop: "16px", color: "#64748B", fontWeight: 500, fontFamily: "Poppins, sans-serif" }}>
          {language === "tl" ? "Kinukuha ang profile..." : "Loading profile..."}
        </Typography>
      </Box>
    );
  }

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
      {/* Header matching Settings header style */}
      <PageHeader
        title={language === "tl" ? "Impormasyon ng Profile" : "Profile Information"}
        onBack={() => navigate("/settings")}
      />

      <Box
        component="form"
        onSubmit={handleSave}
        className="hide-scrollbar"
        sx={{
          flexGrow: 1,
          overflowY: "auto",
          p: 2.5,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {/* Profile Avatar */}
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", my: 1 }}>
          <Box sx={{ position: "relative" }}>
            <Avatar
              src={profilePhotoUrl}
              sx={{
                width: "90px",
                height: "90px",
                boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
                border: "3px solid #FFF",
                outline: "2px solid #E2E8F0",
              }}
            >
              {fullName.charAt(0).toUpperCase()}
            </Avatar>
            <IconButton
              component="label"
              disabled={uploadingPhoto}
              sx={{
                position: "absolute",
                bottom: 0,
                right: 0,
                backgroundColor: "#FF6B00",
                color: "#FFFFFF",
                "&:hover": { backgroundColor: "#E05300" },
                width: "30px",
                height: "30px",
                boxShadow: "none",
              }}
            >
              {uploadingPhoto ? (
                <CircularProgress size={14} sx={{ color: "#FFF" }} />
              ) : (
                <PhotoCameraIcon sx={{ fontSize: 15 }} />
              )}
              <input type="file" accept="image/*" hidden onChange={handlePhotoUpload} />
            </IconButton>
          </Box>
        </Box>

        {error && (
          <Alert severity="error" sx={{ borderRadius: "12px", fontSize: "12px", fontFamily: "Poppins, sans-serif" }}>
            {error}
          </Alert>
        )}

        {/* Full Name */}
        <RegisterInput
          label={language === "tl" ? "Buong Pangalan" : "Full Name"}
          value={fullName}
          onChange={(val) => setFullName(val)}
          required
          placeholder="e.g. Juan Dela Cruz"
        />

        {/* Mobile Number with OTP Note */}
        <Box>
          <SakayPhoneInput
            value={contactNumber}
            onChange={(val) => setContactNumber(val)}
            error={false}
          />
          <Typography sx={{ fontSize: "11px", color: "#64748B", mt: 0.5, ml: 1, fontFamily: "Poppins, sans-serif" }}>
            {language === "tl"
              ? "Ang pagpapalit ng numero ay nangangailangan ng OTP verification."
              : "Changing your mobile number requires OTP verification."}
          </Typography>
        </Box>

        {/* Residential Address */}
        <RegisterInput
          label={language === "tl" ? "Residential Address" : "Residential Address"}
          value={address}
          onChange={(val) => setAddress(val)}
          placeholder="Barangay, Calapan City, Oriental Mindoro"
        />

        {/* Save Button */}
        <Box sx={{ mt: 2 }}>
          <PrimaryButton type="submit" loading={saving} fullWidth>
            {language === "tl" ? "I-save ang mga Pagbabago" : "Save Changes"}
          </PrimaryButton>
        </Box>
      </Box>

      <SuccessModal
        open={success}
        title={language === "tl" ? "Tagumpay!" : "Success!"}
        message={
          language === "tl"
            ? "Matagumpay na na-update ang iyong profile."
            : "Your profile details have been successfully updated."
        }
      />
    </Box>
  );
};

export default ProfileEditor;
