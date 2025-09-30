#!/usr/bin/env node

/**
 * MeetingGuard Notification System Setup Script
 * This script helps you set up and test the complete notification system
 */

const fs = require('fs');
const path = require('path');

console.log('🚀 MeetingGuard Notification System Setup');
console.log('==========================================');

// Check if required files exist
const requiredFiles = [
  'src/services/EnhancedNotificationManager.js',
  'src/services/LocalNotificationScheduler.js',
  'src/services/BackgroundTaskManager.js',
  'src/components/FloatingWidgetContainer.jsx',
  'src/components/FloatingMeetingWidget.jsx',
  'src/components/NotificationSettings.jsx',
  'src/components/FloatingWidgetSettings.jsx',
  'backend/routes/notifications.js',
  'app.json'
];

console.log('\n📋 Checking required files...');
let allFilesExist = true;

requiredFiles.forEach(file => {
  if (fs.existsSync(file)) {
    console.log(`✅ ${file}`);
  } else {
    console.log(`❌ ${file} - MISSING`);
    allFilesExist = false;
  }
});

if (!allFilesExist) {
  console.log('\n❌ Some required files are missing. Please check the implementation.');
  process.exit(1);
}

console.log('\n✅ All required files are present!');

// Check package.json dependencies
console.log('\n📦 Checking dependencies...');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const requiredDeps = [
  'expo-notifications',
  'expo-device',
  'expo-constants',
  'expo-task-manager',
  'expo-background-fetch',
  'react-native-floating-action'
];

const missingDeps = requiredDeps.filter(dep => 
  !packageJson.dependencies[dep] && !packageJson.devDependencies[dep]
);

if (missingDeps.length > 0) {
  console.log('❌ Missing dependencies:', missingDeps.join(', '));
  console.log('\n🔧 Run this command to install missing dependencies:');
  console.log(`npm install ${missingDeps.join(' ')}`);
} else {
  console.log('✅ All required dependencies are installed!');
}

// Check app.json configuration
console.log('\n⚙️ Checking app.json configuration...');
if (fs.existsSync('app.json')) {
  const appJson = JSON.parse(fs.readFileSync('app.json', 'utf8'));
  
  const hasNotificationPlugin = appJson.expo?.plugins?.some(plugin => 
    Array.isArray(plugin) ? plugin[0] === 'expo-notifications' : plugin === 'expo-notifications'
  );
  
  const hasTaskManager = appJson.expo?.plugins?.includes('expo-task-manager');
  const hasBackgroundFetch = appJson.expo?.plugins?.includes('expo-background-fetch');
  
  if (hasNotificationPlugin && hasTaskManager && hasBackgroundFetch) {
    console.log('✅ App.json is properly configured!');
  } else {
    console.log('⚠️ App.json needs configuration updates:');
    if (!hasNotificationPlugin) console.log('  - Missing expo-notifications plugin');
    if (!hasTaskManager) console.log('  - Missing expo-task-manager plugin');
    if (!hasBackgroundFetch) console.log('  - Missing expo-background-fetch plugin');
  }
} else {
  console.log('❌ app.json not found');
}

// Database setup reminder
console.log('\n🗄️ Database Setup Reminder:');
console.log('Make sure to run the SQL migration in your database:');
console.log('📁 File: backend/migrations/create_notification_tables.sql');

// Next steps
console.log('\n🎯 Next Steps:');
console.log('1. Run the database migration (if not done already)');
console.log('2. Start your backend server: npm run backend');
console.log('3. Start your app: npm start');
console.log('4. Test on device: npm run android or npm run ios');
console.log('5. Create a test meeting 5 minutes in the future');
console.log('6. Enable notifications in Settings');
console.log('7. Enable floating widget in Settings');
console.log('8. Minimize the app to see the floating widget');

console.log('\n🎉 Setup Complete!');
console.log('Your app now has WhatsApp-style notifications and floating widgets!');

// Create a test meeting helper
console.log('\n📝 Test Meeting Helper:');
const now = new Date();
const testTime = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes from now
console.log('Create a test meeting with these details:');
console.log(`Title: "Test Meeting"`);
console.log(`Date: ${testTime.toISOString().split('T')[0]}`);
console.log(`Time: ${testTime.toTimeString().split(' ')[0].substring(0, 5)}`);
console.log(`Duration: 30 minutes`);

console.log('\n🔔 Expected Behavior:');
console.log('- Notifications will trigger at: 5min, 1min, and meeting time');
console.log('- Floating widget will appear when app is minimized');
console.log('- Widget will show countdown and change colors');
console.log('- Tap widget to open app instantly');

console.log('\n📱 Happy testing! 🚀');
