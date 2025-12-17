# Meeting Guard Mobile

A React Native mobile application built with Expo for managing meetings, notes, and AI-powered insights.

## Features

- 📅 Meeting management and calendar integration
- 📝 Note taking and organization
- 🤖 AI-powered chat and insights
- 🔔 Meeting alerts and reminders
- ⚙️ Settings and API configuration
- 🌙 Dark mode support
- 📱 Cross-platform (iOS & Android)

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Expo CLI (`npm install -g @expo/cli`)
- iOS Simulator (for iOS development) or Android Studio (for Android development)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd meeting-guard-mobile
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
npm run setup
```
Or manually create a `.env` file (see `ENVIRONMENT_SETUP.md` for details)

4. Start the development server:
```bash
npm start
```

5. Run on your preferred platform:
   - Press `i` for iOS simulator
   - Press `a` for Android emulator
   - Press `w` for web browser
   - Scan QR code with Expo Go app on your device

## Project Structure

```
src/
├── api/           # API functions and integrations
├── components/    # Reusable React Native components
├── hooks/         # Custom React hooks
├── pages/         # Screen components
├── utils/         # Utility functions
└── lib/           # Library configurations
```

## Available Scripts

- `npm start` - Start the Expo development server
- `npm run android` - Start on Android emulator
- `npm run ios` - Start on iOS simulator
- `npm run web` - Start in web browser
- `npm run lint` - Run ESLint
- `npm run build` - Build the app for production
- `npm run setup` - Interactive environment setup

## Technologies Used

- **React Native** - Mobile app framework
- **Expo** - Development platform and tools
- **React Navigation** - Navigation library
- **React Native Paper** - Material Design components
- **React Hook Form** - Form handling
- **Zod** - Schema validation
- **Expo Notifications** - Push notifications
- **Expo Calendar** - Calendar integration
- **Tailwind CSS** - Utility-first CSS framework with dark mode support

## Dark Mode

The app includes a comprehensive dark mode implementation with the following features:

- **Automatic Theme Detection**: The app automatically detects the user's system preference
- **Manual Toggle**: Users can manually switch between light and dark themes
- **Persistent Settings**: Theme preference is saved and restored on app restart
- **Consistent Styling**: All components are styled to support both themes
- **Accessibility**: Proper contrast ratios and readable text in both modes

### How to Use Dark Mode

1. **Settings Page**: Navigate to Settings → Theme to toggle between light and dark mode
2. **Header Toggle**: Use the theme toggle button in the app header
3. **Sidebar**: Access theme toggle from the mobile sidebar menu

### Theme Context

The app uses a React Context (`ThemeContext`) to manage theme state across all components. The context provides:

- `isDarkMode`: Boolean indicating current theme
- `toggleTheme`: Function to switch between themes
- Automatic persistence to localStorage

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## Project Status

✅ **Production Ready** - The project has been cleaned up and optimized for production use.

### Recent Improvements
- ✅ Removed 42+ unnecessary documentation files
- ✅ Deleted test files and cleanup scripts
- ✅ Removed debug code from production files
- ✅ Added Error Boundary component for better error handling
- ✅ Updated .gitignore with proper exclusions
- ✅ Cleaned up console.log statements
- ✅ Removed SQL schema files (using Firebase Firestore - no SQL needed)
- ✅ Removed all setup scripts (setup-env.js, setup-google-secret.js, setup-notifications.js)
- ✅ Removed development-only files (redirect-server.js, index.html, api/index.js, vercel.json, server.js)
- ✅ Removed all cleanup scripts from `src/scripts/`
- ✅ Cleaned up package.json scripts
- ✅ Removed backend folder (frontend-only architecture)

### Code Quality
- ✅ Error boundaries implemented
- ✅ Clean code structure
- ✅ Proper file organization
- ✅ Production-ready configuration

## License

This project is licensed under the MIT License.