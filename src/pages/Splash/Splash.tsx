import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import { useLanguage } from "../../utils/LanguageContext";
import LanguageSelector from "../../components/common/LanguageSelector";
import PrimaryButton from "../../components/common/PrimaryButton";
import Logo from "../../components/common/Logo";

// Images
import background from "../../assets/images/splash-bg.png";
import tricycle from "../../assets/icons/tricycle.png";
import onboardingBooking from "../../assets/icons/onboarding_booking.png";
import onboardingFare from "../../assets/icons/onboarding_fare 1.png";
import onboardingToda from "../../assets/icons/onboarding_toda.png";

const Splash: React.FC = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();

  // State to manage onboarding steps:
  // 1: Animated splash sequence (tricycle rides in/out, logo fades in)
  // 4: Onboarding Slide 1 (Mag-book ng Biyahe)
  // 5: Onboarding Slide 2 (Tamang Pamasahe)
  // 6: Onboarding Slide 3 (Ligtas at Maaasahan)
  // 7: Main welcome landing page
  const [step, setStep] = useState(1);

  useEffect(() => {
    if (step === 1) {
      const timer = setTimeout(() => setStep(4), 6700); // 1.5s delay + 4s animation + 1.2s logo pause duration
      return () => clearTimeout(timer);
    }
  }, [step]);

  const handleNextOnboarding = () => {
    if (step === 4) setStep(5);
    else if (step === 5) setStep(6);
    else if (step === 6) setStep(7);
  };

  const handleSkip = () => {
    setStep(7);
  };

  // Helper to render pagination dots
  const renderDots = (activeIdx: number) => {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: "8px",
          marginTop: "auto",
          marginBottom: "24px",
        }}
      >
        {[0, 1, 2].map((idx) => (
          <Box
            key={idx}
            sx={{
              width: idx === activeIdx ? "24px" : "8px",
              height: "8px",
              borderRadius: "4px",
              backgroundColor: idx === activeIdx ? "#FF6B00" : "#E2E8F0",
              transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          />
        ))}
      </Box>
    );
  };

  // RENDER ONBOARDING SLIDES (Steps 4, 5, 6)
  if (step === 4 || step === 5 || step === 6) {
    let slideTitle = "";
    let slideDesc = "";
    let slideImg = onboardingBooking;
    let activeDotIdx = 0;

    if (step === 4) {
      slideTitle = "Mag-book ng Biyahe";
      slideDesc = "Mabilis at madaling pag-book ng traysikel sa isang pindot lang kahit nasaan ka.";
      slideImg = onboardingBooking;
      activeDotIdx = 0;
    } else if (step === 5) {
      slideTitle = "Tamang Pamasahe";
      slideDesc = "Malinaw at tapat na presyo para sa bawat byahe, walang hulaan.";
      slideImg = onboardingFare;
      activeDotIdx = 1;
    } else if (step === 6) {
      slideTitle = "Ligtas at Maaasahan";
      slideDesc = "Siguradong driver na lisensyado at rehistrado sa TODA ang susundo sa iyo.";
      slideImg = onboardingToda;
      activeDotIdx = 2;
    }

    return (
      <Box className="app-container">
        <Box
          component="main"
          className="phone-simulator"
          sx={{
            padding: "24px",
            backgroundColor: "#FFFFFF",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          {/* Header Logo */}
          <Box sx={{ marginTop: "24px", width: "100%", display: "flex", justifyContent: "center" }}>
            <Logo color="orange" />
          </Box>

          {/* Illustration Container */}
          <Box
            className="anim-fade-in"
            key={step} // Force re-render animation on step change
            sx={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              flexGrow: 1,
              maxHeight: "360px",
              marginTop: "20px",
            }}
          >
            <Box
              component="img"
              src={slideImg}
              alt={slideTitle}
              sx={{
                maxWidth: "100%",
                maxHeight: "280px",
                objectFit: "contain",
              }}
            />
          </Box>

          {/* Text Section */}
          <Box sx={{ width: "100%", textAlign: "center", padding: "0 12px" }}>
            <Typography
              component="h2"
              sx={{
                fontSize: "24px",
                fontWeight: 800,
                color: "#0F172A",
              }}
            >
              {slideTitle}
            </Typography>
            <Typography
              sx={{
                fontSize: "14px",
                color: "#64748B",
                marginTop: "12px",
                lineHeight: 1.6,
                fontWeight: 500,
              }}
            >
              {slideDesc}
            </Typography>
          </Box>

          {/* Dots Indicator */}
          {renderDots(activeDotIdx)}

          {/* Action Buttons */}
          <Box sx={{ width: "100%", paddingBottom: "24px", display: "flex", flexDirection: "column" }}>
            <PrimaryButton fullWidth onClick={handleNextOnboarding}>
              Magpatuloy
            </PrimaryButton>

            {step !== 6 && (
              <Button
                variant="text"
                onClick={handleSkip}
                sx={{
                  height: "56px",
                  backgroundColor: "#F1F5F9",
                  color: "#475569",
                  marginTop: "12px",
                  borderRadius: "16px",
                  fontWeight: 700,
                  fontSize: "1rem",
                  "&:hover": {
                    backgroundColor: "#E2E8F0",
                  },
                }}
              >
                Laktawan
              </Button>
            )}
          </Box>
        </Box>
      </Box>
    );
  }

  // RENDER INITIAL SPLASH SCREENS (Step 1)
  if (step === 1) {
    return (
      <Box className="app-container">
        <Box
          component="main"
          className="phone-simulator"
          sx={{
            backgroundImage: `url(${background})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            position: "relative",
          }}
        >
          {/* Tricycle riding across the screen */}
          <Box
            component="img"
            src={tricycle}
            alt="Tricycle"
            className="anim-tricycle-splash"
          />

          {/* Logo overlay fading in as the tricycle exits */}
          <Box className="anim-logo-splash-overlay">
            <Logo color="white" width={220} />
          </Box>
        </Box>
      </Box>
    );
  }

  // RENDER FINAL WELCOME / AUTH LANDING PAGE (Step 7)
  return (
    <Box className="app-container">
      <Box
        component="main"
        className="phone-simulator"
        sx={{
          backgroundImage: `url(${background})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {/* Language Selector centered horizontally */}
        <Box sx={{ position: "absolute", top: 40, left: "50%", transform: "translateX(-50%)", zIndex: 10 }}>
          <LanguageSelector />
        </Box>

        {/* White Logo Text */}
        <Box className="anim-fade-in-down" sx={{ mt: "140px", zIndex: 2 }}>
          <Logo color="white" width={220} />
        </Box>

        {/* Tricycle Illustration */}
        <Box
          className="anim-float-tricycle"
          sx={{
            mt: "40px",
            zIndex: 2,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Box
            component="img"
            src={tricycle}
            alt="Tricycle"
            sx={{
              width: "250px",
              height: "auto",
              objectFit: "contain",
            }}
          />
        </Box>

        {/* Bottom Actions Area */}
        <Box
          className="anim-fade-in-up"
          sx={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: "320px",
            background:
              "linear-gradient(to top, #ffffff 20%, rgba(255, 255, 255, 0.98) 45%, rgba(255, 255, 255, 0.8) 65%, rgba(255, 255, 255, 0) 100%)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            padding: "32px 28px 48px 28px",
            zIndex: 5,
          }}
        >
          <PrimaryButton
            fullWidth
            onClick={() => navigate("/account-selection")}
          >
            {t.start}
          </PrimaryButton>

          <Typography
            sx={{
              mt: "20px",
              textAlign: "center",
              fontSize: "15px",
              fontWeight: 500,
              color: "#64748B",
            }}
          >
            {t.hasAccount}
            <Box
              component="span"
              onClick={() => navigate("/login")}
              sx={{
                color: "#FF6B00",
                fontWeight: 600,
                cursor: "pointer",
                ml: "4px",
                transition: "color 0.2s",
                "&:hover": {
                  color: "#E66000",
                  textDecoration: "underline",
                },
              }}
            >
              {t.loginLink}
            </Box>
          </Typography>
        </Box>
      </Box>
    </Box>
  );
};

export default Splash;