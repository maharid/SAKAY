import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import { StrikesAppealsView } from "@sakay/shared";

import PageHeader from "../../../common/components/PageHeader";
import SakayToast from "../../../common/components/SakayToast";
import { useLanguage } from "../../../utils/LanguageContext";
import { submitStrikeAppeal } from "../../../services/strikeAppealService";
import { usePassengerStrikes } from "../hooks/usePassengerStrikes";

/**
 * Rules 20 and 25: the passenger's strikes, and the way to appeal one within 48 hours of its issue (a late-cancellation or no-show strike
 * after a real breakdown, a storm, a signal outage...). The request goes to the LGU Administrator (25.5); the database refuses what the policy
 * refuses. The list and the appeal form are the shared view (the Driver app shows the same one).
 */
const StrikesAppealsPage: React.FC = () => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const tl = language === "tl";
  const strikes = usePassengerStrikes();
  const [toast, setToast] = useState<string | null>(null);

  return (
    <Box sx={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: "#F8FAFC" }}>
      <SakayToast message={toast} severity="success" onClose={() => setToast(null)} />
      <PageHeader title={tl ? "Mga Strike at Apela" : "Strikes & Appeals"} onBack={() => navigate(-1)} />
      <StrikesAppealsView
        language={tl ? "tl" : "en"}
        audience="passenger"
        history={strikes.history}
        appeals={strikes.appeals}
        loading={strikes.loading}
        failed={strikes.failed}
        onAppeal={submitStrikeAppeal}
        onAppealSent={async (message) => {
          setToast(message);
          await strikes.reload();
        }}
      />
    </Box>
  );
};

export default StrikesAppealsPage;
