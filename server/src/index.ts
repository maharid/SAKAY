import { logServerEnv } from './config/env'; // first: loads server/.env from an explicit path before the modules below run
import { createApp } from './app';

logServerEnv();

const PORT = process.env.PORT || 5000;

// The application (middleware order, routes, security) is built in ./app so that tests can build it with their own dependencies.
const app = createApp();

// Start listening
app.listen(PORT, () => {
  console.log(`=============================================`);
  console.log(`🚀 SAKAY Admin Backend Server running on:`);
  console.log(`   ➜ Local: http://localhost:${PORT}`);
  console.log(`   ➜ Health: http://localhost:${PORT}/api/health`);
  console.log(`=============================================`);

  // The hourly SLA, expiry and strike duties are scheduled INSIDE the database (pg_cron job 'sakay-policy-sweeps', migration
  // 20261028000001): a free-plan server sleeps, and a sleeping server runs no timers. POST /api/scheduler/run-sla-checks stays for "run it now".
});

export default app;
