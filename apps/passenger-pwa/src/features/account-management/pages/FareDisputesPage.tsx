import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import { OwnFareDisputesView } from "@sakay/shared";
import type { OwnFareDispute } from "@sakay/shared";

import PageHeader from "../../../common/components/PageHeader";
import { useLanguage } from "../../../utils/LanguageContext";
import { addMyFareStatement, fetchMyFareDisputes, signMyFareEvidence } from "../../../services/fareDisputeService";

/**
 * Rules 18.4, 13.5 and 18.6: the fare cases about the passenger's own trips, and the way to add information (words and up to three photos) to a case that is not decided
 * yet. The TODA Administrator reads it; the other side never sees the photos. The list and the form are the shared view (the Driver app shows the same one).
 */
const FareDisputesPage: React.FC = () => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const tl = language === "tl";
  const [disputes, setDisputes] = useState<OwnFareDispute[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setDisputes(await fetchMyFareDisputes());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Box sx={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: "#F8FAFC" }}>
      <PageHeader title={tl ? "Mga Kaso sa Pamasahe" : "Fare Cases"} onBack={() => navigate(-1)} />
      <Box className="hide-scrollbar" sx={{ flex: 1, overflowY: "auto", p: 2 }}>
        <OwnFareDisputesView
          language={tl ? "tl" : "en"}
          audience="passenger"
          disputes={disputes}
          loading={loading}
          failed={!loading && disputes === null}
          onAddStatement={addMyFareStatement}
          onChanged={load}
          sign={signMyFareEvidence}
        />
      </Box>
    </Box>
  );
};

export default FareDisputesPage;
