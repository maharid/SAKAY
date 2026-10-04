// Imported FIRST by every test file. dotenv never overwrites a variable that already exists, so blanking these here means a developer's
// server/.env (real Supabase keys, SMS gateway, Gemini key) cannot leak into a test run: the tests never touch a real service.
for (const key of [
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY',
  'SMS_GATEWAY_URL', 'SMS_GATEWAY_LOGIN', 'SMS_GATEWAY_PASSWORD', 'SMS_GATEWAY_DEVICE_ID',
  'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'SCHEDULER_SECRET', 'CORS_ORIGIN', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
]) {
  process.env[key] = '';
}
process.env.NODE_ENV = 'test';
export {};
