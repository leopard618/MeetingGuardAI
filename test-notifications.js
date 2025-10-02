#!/usr/bin/env node

/**
 * Quick Notification Test Helper
 * This script helps you create test meetings at the right times
 */

const now = new Date();

console.log('🔔 Notification Testing Helper');
console.log('==============================\n');

console.log('📅 Current Time:', now.toLocaleTimeString());
console.log('📅 Current Date:', now.toLocaleDateString());
console.log('');

// Generate test meeting times
const testTimes = [
  { name: '30 Second Test', minutes: 0.5, description: 'Quick test - notification in 30 seconds' },
  { name: '2 Minute Test', minutes: 2, description: 'See 2min, 1min, NOW notifications' },
  { name: '5 Minute Test', minutes: 5, description: 'See 5min, 2min, 1min, NOW notifications' },
  { name: '15 Minute Test', minutes: 15, description: 'Full test - all notification types' },
];

console.log('🎯 Test Meeting Times:\n');

testTimes.forEach((test, index) => {
  const testTime = new Date(now.getTime() + test.minutes * 60 * 1000);
  const timeStr = testTime.toTimeString().split(' ')[0].substring(0, 5); // HH:MM format
  const dateStr = testTime.toISOString().split('T')[0]; // YYYY-MM-DD format
  
  console.log(`${index + 1}. ${test.name}`);
  console.log(`   Time: ${timeStr}`);
  console.log(`   Date: ${dateStr}`);
  console.log(`   ${test.description}`);
  console.log('');
});

console.log('📋 How to Test:\n');
console.log('1. Choose a test time from above');
console.log('2. Create a meeting in the app with that exact time');
console.log('3. Wait for notifications to appear');
console.log('4. Check the notification appears even when app is closed\n');

console.log('🔧 Expected Behavior:\n');
console.log('✅ Notification appears at scheduled time');
console.log('✅ Works even when app is completely closed');
console.log('✅ Floating widget shows countdown when minimized');
console.log('✅ Widget color changes as time approaches');
console.log('');

console.log('🎨 Widget Colors:\n');
console.log('🟢 Green  = Meeting in 1+ hours');
console.log('🟡 Yellow = Meeting in 15 minutes');
console.log('🟠 Orange = Meeting in 5 minutes');
console.log('🔴 Red    = Meeting NOW or in 1 minute');
console.log('');

console.log('🚀 Quick Start:\n');
console.log('1. Open your app');
console.log('2. Create a meeting with the "2 Minute Test" time above');
console.log('3. Wait 2 minutes');
console.log('4. You should see notifications!');
console.log('');

console.log('Happy testing! 🎉');
