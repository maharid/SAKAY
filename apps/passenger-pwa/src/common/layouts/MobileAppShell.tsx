import React from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import { ConnectionLostBanner } from "@sakay/shared";
import { supabase } from "../../services/supabaseClient";
import SakayToast from "../../common/components/SakayToast";
import { useLanguage } from "../../utils/LanguageContext";
import { authSessionIdFromAccessToken } from "../../utils/authSession";
import { getOwnAccountRestriction, rotatePassengerSession } from "../../services/passengerApiService";

interface MobileAppShellProps {
  children?: React.ReactNode;
}

const GUARDED_PATHS = ['/dashboard', '/profile', '/settings', '/saved-places', '/support', '/app-feedback', '/change-password', '/strikes', '/fare-disputes', '/account-restricted', '/track-reports', '/location-permission', '/new-trip', '/set-place', '/book-summary', '/trip-monitoring', '/feedback', '/incident-report', '/history', '/report-driver', '/trip-details'];

/**
 * MobileAppShell - The central mobile application container for the Passenger PWA.
 * 
 * Responsibilities:
 * - Mobile viewport sizing (Portrait mobile phone frame 412x892 on desktop, 100vw x 100dvh on mobile)
 * - Safe area boundary containment
 * - Global overflow management
 * - Consistent background styling
 * - Passenger Session Guard (checking single active device session)
 */
export const MobileAppShell: React.FC<MobileAppShellProps> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { language } = useLanguage();
  
  const [sessionToastOpen, setSessionToastOpen] = React.useState(false);
  const [sessionToastMsg, setSessionToastMsg] = React.useState('');

  React.useEffect(() => {
    const checkSession = async () => {
      const isGuarded = GUARDED_PATHS.some(path => location.pathname.startsWith(path));
      if (!isGuarded) return;

      const { data: sess } = await supabase.auth.getSession();
      if (sess?.session?.user) {
        const localToken = localStorage.getItem('sakay_session_token');
        const { data: profile } = await supabase
          .from("passenger")
          .select("passenger_id, session_id, auth_session_id, account_status")
          .eq("auth_user_id", sess.session.user.id)
          .maybeSingle();

        // This phone holds the current token but the database never recorded THIS login as the current one (it signed in through a path or a
        // build that did not register it): record it now, so the database can tell this login from an older one. Only the current phone does this.
        const loginSession = authSessionIdFromAccessToken(sess.session.access_token);
        if (profile?.passenger_id && profile.session_id && profile.session_id === localToken && loginSession && profile.auth_session_id !== loginSession) {
          await rotatePassengerSession(profile.passenger_id);
          return;
        }

        if (profile?.session_id && profile.session_id !== localToken) {
          await supabase.auth.signOut();
          localStorage.removeItem('sakay_session_token');
          localStorage.removeItem('sakay_passenger_id');
          localStorage.removeItem('sakay_passenger_name');
          localStorage.removeItem('sakay_passenger_phone');
          localStorage.removeItem('sakay_passenger_status');
          
          setSessionToastMsg(language === 'tl' ? 'Ang iyong account ay na-log in sa ibang device.' : 'Your account was logged in from another device.');
          setSessionToastOpen(true);
          
          navigate('/login', { replace: true });
          return;
        }

        // Rule 22.3: a suspended or deactivated passenger is kept on the one page made for her (her strikes and the appeal). The database refuses a
        // booking by a restricted account whatever the screen does; this only spares her screens that cannot work. (Only an account whose status is
        // not Active is asked, and the database lifts a suspension that has run out when it is asked.)
        if (profile && (profile.account_status === 'Suspended' || profile.account_status === 'Deactivated') && location.pathname !== '/account-restricted') {
          const restriction = await getOwnAccountRestriction('passenger');
          if (restriction?.restricted) navigate('/account-restricted', { replace: true });
        }
      }
    };
    
    checkSession();
  }, [location.pathname, navigate, language]);

  return (
    <Box className="app-container">
      <SakayToast 
        open={sessionToastOpen} 
        message={sessionToastMsg} 
        severity="error" 
        onClose={() => setSessionToastOpen(false)} 
      />
      <Box
        component="main"
        className="phone-simulator hide-scrollbar"
        id="mobile-app-shell"
      >
        <Box
          sx={{
            width: "100%",
            height: "100%",
            position: "relative",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            backgroundColor: "#FFFFFF",
          }}
        >
          {/* Rule 17.4: while this phone cannot reach the server, every screen says so (a stalled screen is not a finished or cancelled trip) */}
          <ConnectionLostBanner language={language} />
          {children || <Outlet />}
        </Box>
      </Box>
    </Box>
  );
};

export default MobileAppShell;
