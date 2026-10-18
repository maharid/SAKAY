import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import { StrikesAppealsView, describeRestriction } from "@sakay/shared";
import type { AccountRestriction } from "@sakay/shared";

import PageHeader from "../../../common/components/PageHeader";
import PrimaryButton from "../../../common/components/PrimaryButton";
import SakayToast from "../../../common/components/SakayToast";
import { useLanguage } from "../../../utils/LanguageContext";
import { supabase } from "../../../services/supabaseClient";
import { getOwnAccountRestriction } from "../../../services/passengerApiService";
import { submitStrikeAppeal } from "../../../services/strikeAppealService";
import { usePassengerStrikes } from "../hooks/usePassengerStrikes";

/**
 * Rule 22.3: a suspended or deactivated passenger "retains the right to formally request review or appeal directly to the LGU Administrator".
 * Until now such a login was signed out at once, which left no way to do that in the app. Now the passenger stays signed in, but ONLY on this page:
 * what the restriction is, her strikes, and the appeal form (the shared view; the request goes to the LGU Administrator, 25.5), and a way to log
 * out. The app shell keeps her on this page, and the database refuses a booking by a restricted account whatever the screen does.
 * An account that was permanently closed has no appeal here and is signed out.
 */
const AccountRestrictedPage: React.FC = () => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const tl = language === "tl";
  const strikes = usePassengerStrikes();
  const [restriction, setRestriction] = useState<AccountRestriction | null>(null);
  const [checked, setChecked] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const logOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn("Logout error:", err);
    }
    localStorage.clear();
    sessionStorage.clear();
    navigate("/login", { replace: true });
  };

  useEffect(() => {
    let alive = true;
    getOwnAccountRestriction("passenger").then(async (r) => {
      if (!alive) return;
      if (r && !r.restricted) {
        // the suspension has run out (the database lifted it): nothing to appeal here
        navigate("/dashboard", { replace: true });
        return;
      }
      if (r?.kind === "CLOSED") {
        await logOut();
        return;
      }
      setRestriction(r);
      setChecked(true);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box sx={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: "#F8FAFC" }}>
      <SakayToast message={toast} severity="success" onClose={() => setToast(null)} />
      <PageHeader title={tl ? "Restricted ang Account" : "Account Restricted"} onBack={logOut} />
      {checked && (
        <Box sx={{ px: 2, pt: 2, display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Alert severity="warning" sx={{ borderRadius: "12px" }}>
            {restriction
              ? describeRestriction(restriction, tl ? "tl" : "en")
              : tl
                ? "Ang inyong account ay suspendido o na-deactivate."
                : "Your account has been suspended or deactivated."}
          </Alert>
          <Alert severity="info" sx={{ borderRadius: "12px" }}>
            {tl
              ? "Hindi ka makakapag-book habang restricted ang account. Maaari kang mag-apela sa LGU Administrator sa ibaba."
              : "You cannot book while the account is restricted. You can appeal to the LGU Administrator below."}
          </Alert>
        </Box>
      )}
      <StrikesAppealsView
        language={tl ? "tl" : "en"}
        audience="passenger"
        history={strikes.history}
        appeals={strikes.appeals}
        loading={strikes.loading || !checked}
        failed={strikes.failed}
        onAppeal={submitStrikeAppeal}
        onAppealSent={async (message) => {
          setToast(message);
          await strikes.reload();
        }}
      />
      <Box sx={{ p: 2, pb: "calc(var(--safe-area-bottom) + 16px)", backgroundColor: "#FFFFFF", borderTop: "1px solid #F1F5F9" }}>
        <PrimaryButton fullWidth onClick={logOut}>
          {tl ? "Mag-log out" : "Log out"}
        </PrimaryButton>
      </Box>
    </Box>
  );
};

export default AccountRestrictedPage;
