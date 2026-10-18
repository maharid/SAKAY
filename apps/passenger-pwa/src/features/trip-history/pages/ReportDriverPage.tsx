import React, { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import FormControlLabel from "@mui/material/FormControlLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { AVAILABILITY_KINDS, reportProblem, useInFlight } from "@sakay/shared";
import type { AvailabilityKind } from "@sakay/shared";

import PageHeader from "../../../common/components/PageHeader";
import PrimaryButton from "../../../common/components/PrimaryButton";
import SuccessModal from "../../../common/components/SuccessModal";
import { useLanguage } from "../../../utils/LanguageContext";
import { reportDriverOfTrip } from "../../../services/driverReportService";

/**
 * Rule 5.7 (and 5.3): the passenger reports that the driver of her trip accepted the booking while already carrying other passengers, or was working the terminal
 * queue. It goes to the driver's TODA Administrator; a strike follows only if an administrator confirms it. Opened from the trip's details.
 */
const ReportDriverPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { language } = useLanguage();
  const tl = language === "tl";
  const flight = useInFlight();
  const bookingId = (location.state as { bookingId?: string } | null)?.bookingId ?? "";

  const [kind, setKind] = useState<AvailabilityKind>("AVAILABILITY_VIOLATION");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!bookingId) return <Navigate to="/history" replace />;

  const problem = reportProblem(bookingId, description);

  const send = () =>
    flight.run(async () => {
      if (problem) return;
      const message = await reportDriverOfTrip(bookingId, kind, description);
      if (message) {
        setError(message);
        return;
      }
      setDone(true);
      setTimeout(() => navigate(-1), 1800);
    });

  return (
    <Box sx={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: "#F8FAFC" }}>
      <PageHeader title={tl ? "I-ulat ang drayber" : "Report the driver"} onBack={() => navigate(-1)} />
      <Box className="hide-scrollbar" sx={{ flex: 1, overflowY: "auto", p: 2.5, display: "flex", flexDirection: "column", gap: 2 }}>
        <Typography sx={{ fontSize: "14px", color: "#475569", lineHeight: 1.5 }}>
          {tl
            ? "Ipapadala ito sa TODA Administrator ng drayber. Walang strike hangga't hindi ito kinukumpirma ng isang administrator."
            : "This goes to the driver's TODA Administrator. Nothing is struck until an administrator confirms it."}
        </Typography>
        <RadioGroup value={kind} onChange={(e) => setKind(e.target.value as AvailabilityKind)}>
          {AVAILABILITY_KINDS.map((k) => (
            <FormControlLabel key={k.kind} value={k.kind} control={<Radio size="small" />} label={<Typography sx={{ fontSize: "14px" }}>{tl ? k.tl : k.en}</Typography>} />
          ))}
        </RadioGroup>
        <TextField
          multiline
          minRows={4}
          label={tl ? "Ano ang nakita mo? (saan, kailan, ano ang ginawa ng drayber)" : "What did you see? (where, when, what the driver did)"}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          fullWidth
        />
        {error && <Alert severity="error" sx={{ borderRadius: "12px" }}>{error}</Alert>}
        <PrimaryButton fullWidth loading={flight.busy} disabled={Boolean(problem)} onClick={send}>
          {tl ? "Ipadala ang ulat" : "Send the report"}
        </PrimaryButton>
      </Box>
      <SuccessModal
        open={done}
        title={tl ? "Naipadala na ang ulat" : "Report sent"}
        message={tl ? "Susuriin ito ng TODA Administrator." : "The TODA Administrator will look into it."}
      />
    </Box>
  );
};

export default ReportDriverPage;
