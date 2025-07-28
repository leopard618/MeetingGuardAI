# Meeting Guard Mobile

A React Native mobile application built with Expo for managing meetings, notes, and AI-powered insights.

## Features

- 📅 Meeting management and calendar integration
- 📝 Note taking and organization
- 🤖 AI-powered chat and insights
- 🔔 Meeting alerts and reminders
- ⚙️ Settings and API configuration
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

3. Start the development server:
```bash
npm start
```

4. Run on your preferred platform:
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

## Technologies Used

- **React Native** - Mobile app framework
- **Expo** - Development platform and tools
- **React Navigation** - Navigation library
- **React Native Paper** - Material Design components
- **React Hook Form** - Form handling
- **Zod** - Schema validation
- **Expo Notifications** - Push notifications
- **Expo Calendar** - Calendar integration

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## License

This project is licensed under the MIT License.