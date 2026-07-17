import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import theme from "./styles/theme";
import { LanguageProvider } from "./utils/LanguageContext";

// Pages
import Splash from "./features/account-management/components/Splash/Splash";
import AccountSelection from "./features/account-management/components/AccountSelection/AccountSelection";
import Login from "./features/account-management/components/Login/Login";
import Register from "./features/account-management/components/Register/Register";
import VerifyOtp from "./features/account-management/components/VerifyOtp/VerifyOtp";
import ForgotPassword from "./features/account-management/components/ForgotPassword/ForgotPassword";
import ResetPassword from "./features/account-management/components/ResetPassword/ResetPassword";
import RegistrationSuccess from "./features/account-management/components/RegistrationSuccess/RegistrationSuccess";
import Dashboard from "./features/ride-booking/components/Dashboard/Dashboard";

function App() {
  return (
    <ThemeProvider theme={theme}>
      <LanguageProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Splash />} />
            <Route path="/account-selection" element={<AccountSelection />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/verify-otp" element={<VerifyOtp />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/registration-success" element={<RegistrationSuccess />} />
            <Route path="/dashboard" element={<Dashboard />} />
          </Routes>
        </BrowserRouter>
      </LanguageProvider>
    </ThemeProvider>
  );
}

export default App;