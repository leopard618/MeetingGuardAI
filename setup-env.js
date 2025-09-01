#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('🚀 MeetingGuard AI - Environment Setup');
console.log('==\n');

const questions = [
  {
    name: 'SUPABASE_URL',
    message: 'Enter your Supabase project URL (e.g., https://your-project.supabase.co):',
    required: true
  },
  {
    name: 'SUPABASE_ANON_KEY',
    message: 'Enter your Supabase anon key:',
    required: true
  },
  {
    name: 'SUPABASE_SERVICE_ROLE_KEY',
    message: 'Enter your Supabase service role key:',
    required: true
  },
  {
    name: 'JWT_SECRET',
    message: 'Enter a secure JWT secret (at least 32 characters):',
    required: true,
    default: () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
      let result = '';
      for (let i = 0; i < 64; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    }
  },
  {
    name: 'OPENAI_API_KEY',
    message: 'Enter your OpenAI API key:',
    required: true
  },
  {
    name: 'GOOGLE_CLIENT_ID',
    message: 'Enter your Google OAuth client ID:',
    required: true
  },
  {
    name: 'GOOGLE_CLIENT_SECRET',
    message: 'Enter your Google OAuth client secret:',
    required: true
  },
  {
    name: 'GOOGLE_MAPS_API_KEY',
    message: 'Enter your Google Maps API key (optional):',
    required: false
  },
  {
    name: 'ZOOM_API_KEY',
    message: 'Enter your Zoom API key (optional):',
    required: false
  },
  {
    name: 'ZOOM_API_SECRET',
    message: 'Enter your Zoom API secret (optional):',
    required: false
  },
  {
    name: 'TEAMS_CLIENT_ID',
    message: 'Enter your Microsoft Teams client ID (optional):',
    required: false
  },
  {
    name: 'TEAMS_CLIENT_SECRET',
    message: 'Enter your Microsoft Teams client secret (optional):',
    required: false
  },
  {
    name: 'SENTRY_DSN',
    message: 'Enter your Sentry DSN (optional):',
    required: false
  }
];

async function askQuestion(question) {
  return new Promise((resolve) => {
    const defaultValue = typeof question.default === 'function' ? question.default() : question.default;
    const message = defaultValue ? `${question.message} [${defaultValue}]: ` : `${question.message}: `;
    
    rl.question(message, (answer) => {
      const value = answer.trim() || defaultValue || '';
      
      if (question.required && !value) {
        console.log('❌ This field is required!');
        resolve(askQuestion(question));
      } else {
        resolve(value);
      }
    });
  });
}

async function setupEnvironment() {
  const envVars = {};
  
  console.log('📝 Please provide the following environment variables:\n');
  
  for (const question of questions) {
    const value = await askQuestion(question);
    envVars[question.name] = value;
  }
  
  // Generate environment files
  const envContent = Object.entries(envVars)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  
  const envProductionContent = Object.entries(envVars)
    .map(([key, value]) => {
      if (key.startsWith('EXPO_PUBLIC_')) {
        return `${key}=${value}`;
      } else if (['SUPABASE_URL', 'SUPABASE_ANON_KEY'].includes(key)) {
        return `EXPO_PUBLIC_${key}=${value}`;
      }
      return `# ${key}=${value} # Backend only`;
    })
    .join('\n');
  
  // Write .env file
  fs.writeFileSync('.env', envContent);
  console.log('\n✅ Created .env file');
  
  // Write .env.production file
  fs.writeFileSync('.env.production', envProductionContent);
  console.log('✅ Created .env.production file');
  
  // Write backend .env file
  const backendEnvContent = Object.entries(envVars)
    .filter(([key]) => !key.startsWith('EXPO_PUBLIC_'))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  
  fs.writeFileSync('deno/.env', backendEnvContent);
  console.log('✅ Created deno/.env file');
  
  console.log('\n🎉 Environment setup complete!');
  console.log('\n📋 Next steps:');
  console.log('1. Review the generated .env files');
  console.log('2. Deploy backend to Deno Deploy');
  console.log('3. Build and deploy your app');
  console.log('4. Run: npm run deploy');
  
  rl.close();
}

setupEnvironment().catch(console.error);
