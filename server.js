// Root-level server that serves the backend
const path = require('path');
const { spawn } = require('child_process');

// Change to backend directory and start the server
process.chdir(path.join(__dirname, 'backend'));

// Start the backend server
const server = spawn('node', ['server.js'], {
  stdio: 'inherit',
  cwd: path.join(__dirname, 'backend')
});

server.on('error', (error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

server.on('exit', (code) => {
  console.log(`Server exited with code ${code}`);
  process.exit(code);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.kill('SIGTERM');
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.kill('SIGINT');
});
