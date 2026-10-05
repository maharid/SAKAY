import '../config/env'; // loads server/.env from an explicit path before the gateway settings are read
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { maskPhone } from '../utils/phone';

// Android SMS Gateway Configuration (capcom6/android-sms-gateway)
const getGatewayConfig = () => ({
  url: (process.env.SMS_GATEWAY_URL || '').trim().replace(/\/+$/, ''),
  login: (process.env.SMS_GATEWAY_LOGIN || '').trim(),
  password: (process.env.SMS_GATEWAY_PASSWORD || '').trim(),
  simNumber: parseInt(process.env.SMS_GATEWAY_SIM_NUMBER || '1', 10),
  deviceId: (process.env.SMS_GATEWAY_DEVICE_ID || '').trim(),
});

/** OTP lifetime. (Still a copy of the 5-minute rule: Batch 2 moves it to the central policy configuration.) */
const OTP_TTL_MS = 5 * 60 * 1000;
/** A code that is entered wrongly this many times is thrown away and a new one must be requested. */
const OTP_MAX_ATTEMPTS = 5;

// In-memory OTP cache. Only a hash of the code is kept. The cache lives in this process: it is lost on a restart.
interface OtpEntry {
  codeHash: Buffer;
  createdAt: number;
  expiresAt: number;
  attempts: number;
}

const otpStore = new Map<string, OtpEntry>();

const hashCode = (code: string): Buffer => createHash('sha256').update(code).digest();

// Clean up expired entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [phone, entry] of otpStore.entries()) {
    if (entry.expiresAt < now) {
      otpStore.delete(phone);
    }
  }
}, 60 * 1000).unref();

export const normalizePhilippinePhone = (raw: string): string => {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('63') && digits.length === 12) {
    return `+${digits}`;
  }
  if (digits.startsWith('09') && digits.length === 11) {
    return `+63${digits.slice(1)}`;
  }
  if (digits.startsWith('9') && digits.length === 10) {
    return `+63${digits}`;
  }
  if (digits.length === 11) {
    return `+63${digits.slice(1)}`;
  }
  return `+${digits}`;
};

/**
 * Sends SMS through an active Android SMS Gateway device (capcom6/android-sms-gateway)
 */
async function sendViaAndroidGateway(
  formattedPhone: string,
  messageText: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  const { url: gatewayUrl, login: gatewayLogin, password: gatewayPassword, simNumber: configuredSim, deviceId } = getGatewayConfig();

  if (!gatewayUrl) {
    return { success: false, error: 'SMS Gateway URL not configured.' };
  }

  // Determine endpoint path (/message is the standard endpoint in capcom6/android-sms-gateway)
  const endpoint = `${gatewayUrl}/message`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (gatewayLogin && gatewayPassword) {
    const basicAuth = Buffer.from(`${gatewayLogin}:${gatewayPassword}`).toString('base64');
    headers['Authorization'] = `Basic ${basicAuth}`;
  } else if (gatewayPassword && !gatewayLogin) {
    // Single token authentication
    headers['Authorization'] = `Bearer ${gatewayPassword}`;
  }

  // Payload matching capcom6/android-sms-gateway specifications
  const payload: Record<string, any> = {
    phoneNumbers: [formattedPhone],
    message: messageText,
    withDeliveryReport: true,
  };

  if (configuredSim) {
    payload.simNumber = configuredSim;
  }

  if (deviceId) {
    payload.deviceId = deviceId;
  }

  // Attempt up to 2 times with a 15-second timeout to allow dozing phones to wake Wi-Fi radio
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        console.log(`[SMS Service] Dispatched via Android SMS Gateway to ${maskPhone(formattedPhone)}`);
        return { success: true, message: 'SMS dispatched successfully via Android Gateway.' };
      }

      const errBody = await response.text();
      console.warn(`[SMS Service] Android Gateway attempt ${attempt} HTTP ${response.status}: ${errBody.slice(0, 200)}`);
      if (attempt === 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      return {
        success: false,
        error: `Gateway returned HTTP ${response.status}`,
      };
    } catch (err: any) {
      const errorMsg = err.name === 'AbortError' ? 'Connection to Android Gateway timed out.' : err.message;
      console.warn(`[SMS Service] Attempt ${attempt} failed to connect to the Android SMS Gateway:`, errorMsg);
      if (attempt === 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      return { success: false, error: errorMsg };
    }
  }

  return { success: false, error: 'Failed to connect to Android SMS Gateway.' };
}

/**
 * Universal Raw SMS Dispatcher (for notifications, driver messages, alerts).
 * The message text and the full number are NOT logged.
 */
export const sendRawSms = async (
  rawPhone: string,
  messageText: string
): Promise<{ success: boolean; message?: string; error?: string; formattedPhone: string; isGatewayDispatched?: boolean }> => {
  const formattedPhone = normalizePhilippinePhone(rawPhone);

  console.log(`[SMS Service] Sending an SMS (${messageText.length} characters) to ${maskPhone(formattedPhone)}`);

  const { url: gatewayUrl } = getGatewayConfig();

  // 1. Try Android SMS Gateway if configured
  if (gatewayUrl) {
    const gatewayResult = await sendViaAndroidGateway(formattedPhone, messageText);
    if (gatewayResult.success) {
      return {
        success: true,
        message: 'SMS dispatched via Android SMS Gateway.',
        formattedPhone,
        isGatewayDispatched: true,
      };
    }
    console.warn('[SMS Service] Android Gateway dispatch failed:', gatewayResult.error);
    return {
      success: false,
      error: 'Hindi maipadala ang SMS. Pakisuri kung bukas at aktibo ang Android SMS Gateway.',
      formattedPhone,
      isGatewayDispatched: false,
    };
  }

  return {
    success: false,
    error: 'Walang aktibong SMS Gateway URL na naka-configure sa server.',
    formattedPhone,
  };
};

/**
 * Development convenience, OFF unless BOTH NODE_ENV=development AND OTP_DEV_ECHO=1 are set: when no SMS gateway is configured the code is printed
 * in the server console (the developer reads it there, as they would read the SMS) and the request succeeds. It is never accepted
 * without having been issued, never sent to the browser, and never active in production.
 */
const devEchoEnabled = (): boolean =>
  process.env.NODE_ENV === 'development' && process.env.OTP_DEV_ECHO === '1' && !getGatewayConfig().url;

/**
 * OTP SMS Dispatcher
 */
export const sendOtpSms = async (
  rawPhone: string
): Promise<{ success: boolean; message?: string; error?: string; formattedPhone: string }> => {
  const formattedPhone = normalizePhilippinePhone(rawPhone);
  const otpCode = randomInt(100000, 1000000).toString();
  const now = Date.now();

  // Clean plain text message without links or domains to bypass PH telco anti-smishing filters
  const otpMessage = `Ang iyong SAKAY verification code ay: ${otpCode}. Valid ito ng 5 minuto. Huwag ibahagi ang code na ito kaninuman.`;

  const store = () =>
    otpStore.set(formattedPhone, { codeHash: hashCode(otpCode), createdAt: now, expiresAt: now + OTP_TTL_MS, attempts: 0 });

  if (devEchoEnabled()) {
    store();
    console.log(`[SMS Service] DEV ONLY (OTP_DEV_ECHO=1, no gateway configured): code for ${maskPhone(formattedPhone)} is ${otpCode}`);
    return { success: true, message: 'OTP generated (development echo, no SMS sent).', formattedPhone };
  }

  // Actually dispatch through the cellular network first
  const dispatchResult = await sendRawSms(formattedPhone, otpMessage);

  if (!dispatchResult.success) {
    console.error(`[SMS Service] Failed to dispatch an OTP to ${maskPhone(formattedPhone)}:`, dispatchResult.error);
    return {
      success: false,
      error: dispatchResult.error || 'Nabigong ipadala ang SMS gamit ang Android SMS Gateway.',
      formattedPhone,
    };
  }

  // Only store OTP if physical dispatch succeeded
  store();
  console.log(`[SMS Service] OTP issued for ${maskPhone(formattedPhone)} (valid 5 minutes)`);

  return {
    success: true,
    message: dispatchResult.message || 'OTP SMS dispatched successfully.',
    formattedPhone,
  };
};

export type OtpVerdict =
  | { success: true }
  | { success: false; error: string; reason: 'not_found' | 'expired' | 'wrong' | 'too_many' };

/**
 * Verifies an entered 6-digit OTP against the store. There is no master code: only the code that was issued to this number, once,
 * within five minutes, with at most five wrong tries.
 */
export const verifyOtpCode = (rawPhone: string, enteredCode: string): OtpVerdict => {
  const formattedPhone = normalizePhilippinePhone(rawPhone);
  const code = (enteredCode || '').trim();

  const entry = otpStore.get(formattedPhone);
  if (!entry) {
    return { success: false, reason: 'not_found', error: 'OTP expired or not found. Please request a new code.' };
  }

  if (Date.now() > entry.expiresAt) {
    otpStore.delete(formattedPhone);
    return { success: false, reason: 'expired', error: 'OTP has expired. Please request a new code.' };
  }

  const matches = /^\d{6}$/.test(code) && timingSafeEqual(hashCode(code), entry.codeHash);
  if (!matches) {
    entry.attempts += 1;
    if (entry.attempts >= OTP_MAX_ATTEMPTS) {
      otpStore.delete(formattedPhone);
      return { success: false, reason: 'too_many', error: 'Too many incorrect attempts. Please request a new code.' };
    }
    return { success: false, reason: 'wrong', error: 'Incorrect OTP code. Please try again.' };
  }

  // Verification successful, consume the OTP
  otpStore.delete(formattedPhone);
  return { success: true };
};

/** For tests: forget every issued code. */
export const _clearOtpStore = (): void => otpStore.clear();
