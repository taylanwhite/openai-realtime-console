import { RealtimeRelay } from './lib/relay.js';

// Conditionally load dotenv only if the environment is not production
if (process.env.NODE_ENV !== 'production') {
  const dotenv = await import('dotenv');
  dotenv.config({ override: true });
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error(
    `Environment variable "OPENAI_API_KEY" is required.\n` +
    `Please set it in the Render environment configuration.`
  );
  process.exit(1);
}

const PORT = parseInt(process.env.PORT) || 8080;

const relay = new RealtimeRelay(OPENAI_API_KEY);
relay.listen(PORT);
