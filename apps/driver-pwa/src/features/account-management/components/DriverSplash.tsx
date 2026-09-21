import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import { useLanguage } from "../../../utils/LanguageContext";
import LanguageSelector from "../../../common/components/LanguageSelector";
import PrimaryButton from "../../../common/components/PrimaryButton";
import Logo from "../../../common/components/Logo";

// Shared branding assets
import background from "@sakay/shared/src/assets/images/splash-bg.png";
import tricycle from "@sakay/shared/src/assets/icons/app-icon-toto.webp";
import driver01 from "@sakay/shared/src/assets/icons/splash-screen/driver-onboarding-01.webp";
import driver02 from "@sakay/shared/src/assets/icons/splash-screen/driver-onboarding-02.webp";
import driver03 from "@sakay/shared/src/assets/icons/splash-screen/driver-onboarding-03.webp";
import driver04 from "@sakay/shared/src/assets/icons/splash-screen/driver-onboarding-04.webp";
import { TYPOGRAPHY_TOKENS } from "@sakay/shared";

import { useLocation } from "react-router-dom";

interface DriverSplashProps {
  initialStep?: number;
}

export const DriverSplash: React.FC<DriverSplashProps> = ({ initialStep }) => {
  const { language, t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();

  // State to manage onboarding steps:
  // 1: Animated splash sequence (tricycle rides in/out, logo fades in)
  // 4: Onboarding Slide 1 — Get Bookings
  // 5: Onboarding Slide 2 — Stay in Control
  // 6: Onboarding Slide 3 — Pick Up and Go
  // 7: Onboarding Slide 4 — Track Your Earnings
  // 8: Main welcome landing page
  const [step, setStep] = useState<number>(() => {
    if (initialStep) return initialStep;
    if (location.pathname === "/get-started" || location.pathname === "/welcome" || location.pathname === "/driver/get-started") return 8;
    const navStep = (location.state as { step?: number })?.step;
    if (navStep) return navStep;
    return 1;
  });

  const [slideDirection, setSlideDirection] = useState<"next" | "prev">("next");

  useEffect(() => {
    if (step === 1) {
      const timer = setTimeout(() => setStep(4), 6700); // 1.5s delay + 4s animation + 1.2s logo pause duration
      return () => clearTimeout(timer);
    }
  }, [step]);

  const handleNextOnboarding = () => {
    setSlideDirection("next");
    if (step === 4) setStep(5);
    else if (step === 5) setStep(6);
    else if (step === 6) setStep(7);
    else if (step === 7) setStep(8);
  };

  const handlePrevOnboarding = () => {
    setSlideDirection("prev");
    if (step === 7) setStep(6);
    else if (step === 6) setStep(5);
    else if (step === 5) setStep(4);
  };

  const touchStartRef = React.useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x;
    const deltaY = e.changedTouches[0].clientY - touchStartRef.current.y;
    touchStartRef.current = null;

    if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
      if (deltaX < 0) {
        handleNextOnboarding();
      } else {
        handlePrevOnboarding();
      }
    }
  };

  const handleSkip = () => {
    setStep(8);
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
        }}
      >
        {[0, 1, 2, 3].map((idx) => (
          <Box
            key={idx}
            sx={{
              width: idx === activeIdx ? "24px" : "8px",
              height: "8px",
              borderRadius: "4px",
              backgroundColor: idx === activeIdx ? "#FF6B00" : "#CBD5E1",
              transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          />
        ))}
      </Box>
    );
  };

  // RENDER ONBOARDING SLIDES (Steps 4, 5, 6, 7)
  if (step === 4 || step === 5 || step === 6 || step === 7) {
    let slideTitle = "";
    let slideDesc = "";
    let slideImg = driver01;
    let activeDotIdx = 0;

    if (step === 4) {
      slideTitle = language === "tl" ? "Tumanggap ng Biyahe" : "More Rides, Right From Your Phone";
      slideDesc =
        language === "tl"
          ? "Mag-online at tumanggap ng mga booking request mula sa pasahero gamit ang SAKAY."
          : "Go online and receive booking requests from passengers through SAKAY.";
      slideImg = driver01;
      activeDotIdx = 0;
    } else if (step === 5) {
      slideTitle = language === "tl" ? "Kontrolado ang Iyong Oras" : "You're in Control of Your Availability";
      slideDesc =
        language === "tl"
          ? "I-set ang status bilang Online kapag handa nang bumiyahe at Offline kapag magpapahinga."
          : "Set your status to Online when you're ready to receive bookings and Offline when you're not.";
      slideImg = driver02;
      activeDotIdx = 1;
    } else if (step === 6) {
      slideTitle = language === "tl" ? "Madaling Navigasyon sa Biyahe" : "Navigate Every Trip With Ease";
      slideDesc =
        language === "tl"
          ? "Kumuha ng malinaw na ruta patungo sa pickup point ng pasahero at sa kanyang destinasyon."
          : "Get route guidance to the passenger's pickup point and keep track of your trip from pickup to destination.";
      slideImg = driver03;
      activeDotIdx = 2;
    } else if (step === 7) {
      slideTitle = language === "tl" ? "Subaybayan ang Iyong Kita" : "Keep Track of Every Trip";
      slideDesc =
        language === "tl"
          ? "Suriin ang iyong mga natapos na biyahe, kabuuang kita, at kasaysayan ng booking sa isang lugar."
          : "Review your completed trips, earnings, and booking history in one place.";
      slideImg = driver04;
      activeDotIdx = 3;
    }

    return (
      <Box
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        sx={{
          width: "100%",
          height: "100%",
          padding: "24px",
          backgroundColor: "#FFFFFF",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          paddingTop: "calc(var(--safe-area-top) + 20px)",
          paddingBottom: "calc(var(--safe-area-bottom) + 24px)",
        }}
      >
        {/* Header Bar with Centered Logo */}
        <Box
          sx={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Logo color="orange" />
        </Box>

        {/* Vertically Centered Onboarding Content Block (PNG + Text) with direction slide transition */}
        <Box
          key={step}
          className={slideDirection === "next" ? "anim-slide-next" : "anim-slide-prev"}
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            py: "12px",
          }}
        >
          {/* Illustration Container — Larger PNG artwork */}
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: "290px",
              maxHeight: "310px",
              width: "100%",
              px: "8px",
              mb: "20px",
            }}
          >
            <Box
              component="img"
              src={slideImg}
              alt={slideTitle}
              sx={{
                maxWidth: "100%",
                maxHeight: "280px",
                width: "auto",
                height: "auto",
                objectFit: "contain",
                display: "block",
                margin: "0 auto",
              }}
            />
          </Box>

          {/* Fixed-position Text Section preventing vertical position shifting */}
          <Box
            sx={{
              width: "100%",
              textAlign: "center",
              padding: "0 12px",
              height: "92px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-start",
            }}
          >
            <Typography
              component="h2"
              sx={{
                fontSize: TYPOGRAPHY_TOKENS.fontSize.display,
                fontWeight: TYPOGRAPHY_TOKENS.fontWeight.bold,
                color: "#0F172A",
                fontFamily: "Poppins, sans-serif",
                lineHeight: 1.25,
              }}
            >
              {slideTitle}
            </Typography>
            <Typography
              sx={{
                fontSize: TYPOGRAPHY_TOKENS.fontSize.bodyMobile,
                color: "#64748B",
                marginTop: "8px",
                lineHeight: 1.45,
                fontWeight: TYPOGRAPHY_TOKENS.fontWeight.medium,
                fontFamily: "Poppins, sans-serif",
              }}
            >
              {slideDesc}
            </Typography>
          </Box>
        </Box>

        {/* Action Buttons & Progress Dots */}
        <Box sx={{ width: "100%", display: "flex", flexDirection: "column", flexShrink: 0 }}>
          {/* Dots Indicator at the bottom above Magpatuloy button */}
          <Box sx={{ display: "flex", justifyContent: "center", mb: "20px" }}>
            {renderDots(activeDotIdx)}
          </Box>

          <PrimaryButton fullWidth onClick={handleNextOnboarding}>
            {language === "tl" ? "Magpatuloy" : "Continue"}
          </PrimaryButton>

          {step !== 7 && (
            <Button
              variant="text"
              onClick={handleSkip}
              sx={{
                height: "48px",
                backgroundColor: "#F1F5F9",
                color: "#475569",
                marginTop: "10px",
                borderRadius: "14px",
                fontWeight: 700,
                fontSize: TYPOGRAPHY_TOKENS.fontSize.buttonMobile,
                fontFamily: "Poppins, sans-serif",
                textTransform: "none",
                "&:hover": {
                  backgroundColor: "#E2E8F0",
                },
              }}
            >
              {language === "tl" ? "Laktawan" : "Skip"}
            </Button>
          )}
        </Box>
      </Box>
    );
  }

  // RENDER INITIAL SPLASH SCREENS (Step 1)
  if (step === 1) {
    return (
      <Box
        sx={{
          width: "100%",
          height: "100%",
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
    );
  }

  // RENDER FINAL WELCOME / AUTH LANDING PAGE (Step 7)
  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        backgroundImage: `url(${background})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        position: "relative",
      }}
    >
      {/* Language Selector centered horizontally respecting safe area */}
      <Box
        sx={{
          position: "absolute",
          top: "calc(var(--safe-area-top) + 24px)",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 10,
        }}
      >
        <LanguageSelector />
      </Box>

      {/* White Logo Text */}
      <Box className="anim-fade-in-down" sx={{ mt: "calc(var(--safe-area-top) + 110px)", zIndex: 2, display: "flex", justifyContent: "center" }}>
        <Logo color="white" width={220} />
      </Box>

      {/* Tricycle Illustration */}
      <Box
        className="anim-float-tricycle"
        sx={{
          mt: "30px",
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

      {/* Bottom Actions Area respecting safe-area-inset-bottom */}
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
          padding: "32px 28px calc(var(--safe-area-bottom) + 36px) 28px",
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
  );
};

export default DriverSplash;
