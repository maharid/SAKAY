import dotenv from 'dotenv';
import { createApp } from './app';
import { startSlaScheduler } from './services/slaSchedulerService';

dotenv.config();

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

  // Start background SLA & credential expiry scheduler daemon
  startSlaScheduler();
});

export default app;
