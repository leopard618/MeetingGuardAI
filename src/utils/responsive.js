import { Dimensions, PixelRatio } from 'react-native';

// Get screen dimensions
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Responsive breakpoints
export const BREAKPOINTS = {
  xs: 320,   // Small phones
  sm: 375,   // Medium phones
  md: 414,   // Large phones
  lg: 768,   // Tablets
  xl: 1024,  // Large tablets/small desktops
};

// Device type detection
export const getDeviceType = () => {
  if (SCREEN_WIDTH >= BREAKPOINTS.xl) return 'desktop';
  if (SCREEN_WIDTH >= BREAKPOINTS.lg) return 'tablet';
  if (SCREEN_WIDTH >= BREAKPOINTS.md) return 'large-phone';
  if (SCREEN_WIDTH >= BREAKPOINTS.sm) return 'medium-phone';
  return 'small-phone';
};

// Responsive font scaling
export const scaleFont = (size) => {
  const deviceType = getDeviceType();
  const scale = PixelRatio.getFontScale();
  
  // Base scaling factors for different device types
  const deviceScales = {
    'small-phone': 0.85,
    'medium-phone': 0.9,
    'large-phone': 0.95,
    'tablet': 1.0,
    'desktop': 1.1,
  };
  
  return Math.round(size * deviceScales[deviceType] * scale);
};

// Responsive width scaling
export const scaleWidth = (size) => {
  const deviceType = getDeviceType();
  
  // Width scaling factors
  const widthScales = {
    'small-phone': 0.8,
    'medium-phone': 0.85,
    'large-phone': 0.9,
    'tablet': 0.95,
    'desktop': 1.0,
  };
  
  return Math.round(size * widthScales[deviceType]);
};

// Responsive height scaling
export const scaleHeight = (size) => {
  const deviceType = getDeviceType();
  
  // Height scaling factors
  const heightScales = {
    'small-phone': 0.8,
    'medium-phone': 0.85,
    'large-phone': 0.9,
    'tablet': 0.95,
    'desktop': 1.0,
  };
  
  return Math.round(size * heightScales[deviceType]);
};

// Responsive padding/margin scaling
export const scaleSize = (size) => {
  const deviceType = getDeviceType();
  
  // Size scaling factors
  const sizeScales = {
    'small-phone': 0.8,
    'medium-phone': 0.85,
    'large-phone': 0.9,
    'tablet': 0.95,
    'desktop': 1.0,
  };
  
  return Math.round(size * sizeScales[deviceType]);
};

// Get responsive font sizes
export const getResponsiveFontSizes = () => {
  const deviceType = getDeviceType();
  
  const fontSizes = {
    'small-phone': {
      xs: scaleFont(10),
      sm: scaleFont(12),
      md: scaleFont(14),
      lg: scaleFont(16),
      xl: scaleFont(18),
      '2xl': scaleFont(20),
      '3xl': scaleFont(24),
      '4xl': scaleFont(28),
    },
    'medium-phone': {
      xs: scaleFont(11),
      sm: scaleFont(13),
      md: scaleFont(15),
      lg: scaleFont(17),
      xl: scaleFont(19),
      '2xl': scaleFont(21),
      '3xl': scaleFont(25),
      '4xl': scaleFont(29),
    },
    'large-phone': {
      xs: scaleFont(12),
      sm: scaleFont(14),
      md: scaleFont(16),
      lg: scaleFont(18),
      xl: scaleFont(20),
      '2xl': scaleFont(22),
      '3xl': scaleFont(26),
      '4xl': scaleFont(30),
    },
    'tablet': {
      xs: scaleFont(13),
      sm: scaleFont(15),
      md: scaleFont(17),
      lg: scaleFont(19),
      xl: scaleFont(21),
      '2xl': scaleFont(23),
      '3xl': scaleFont(27),
      '4xl': scaleFont(31),
    },
    'desktop': {
      xs: scaleFont(14),
      sm: scaleFont(16),
      md: scaleFont(18),
      lg: scaleFont(20),
      xl: scaleFont(22),
      '2xl': scaleFont(24),
      '3xl': scaleFont(28),
      '4xl': scaleFont(32),
    },
  };
  
  return fontSizes[deviceType];
};

// Get responsive spacing
export const getResponsiveSpacing = () => {
  const deviceType = getDeviceType();
  
  const spacing = {
    'small-phone': {
      xs: scaleSize(4),
      sm: scaleSize(8),
      md: scaleSize(12),
      lg: scaleSize(16),
      xl: scaleSize(20),
      '2xl': scaleSize(24),
      '3xl': scaleSize(32),
      '4xl': scaleSize(40),
    },
    'medium-phone': {
      xs: scaleSize(5),
      sm: scaleSize(10),
      md: scaleSize(15),
      lg: scaleSize(20),
      xl: scaleSize(25),
      '2xl': scaleSize(30),
      '3xl': scaleSize(40),
      '4xl': scaleSize(50),
    },
    'large-phone': {
      xs: scaleSize(6),
      sm: scaleSize(12),
      md: scaleSize(18),
      lg: scaleSize(24),
      xl: scaleSize(30),
      '2xl': scaleSize(36),
      '3xl': scaleSize(48),
      '4xl': scaleSize(60),
    },
    'tablet': {
      xs: scaleSize(8),
      sm: scaleSize(16),
      md: scaleSize(24),
      lg: scaleSize(32),
      xl: scaleSize(40),
      '2xl': scaleSize(48),
      '3xl': scaleSize(64),
      '4xl': scaleSize(80),
    },
    'desktop': {
      xs: scaleSize(10),
      sm: scaleSize(20),
      md: scaleSize(30),
      lg: scaleSize(40),
      xl: scaleSize(50),
      '2xl': scaleSize(60),
      '3xl': scaleSize(80),
      '4xl': scaleSize(100),
    },
  };
  
  return spacing[deviceType];
};

// Get responsive icon sizes
export const getResponsiveIconSizes = () => {
  const deviceType = getDeviceType();
  
  const iconSizes = {
    'small-phone': {
      xs: scaleSize(12),
      sm: scaleSize(16),
      md: scaleSize(20),
      lg: scaleSize(24),
      xl: scaleSize(28),
      '2xl': scaleSize(32),
    },
    'medium-phone': {
      xs: scaleSize(14),
      sm: scaleSize(18),
      md: scaleSize(22),
      lg: scaleSize(26),
      xl: scaleSize(30),
      '2xl': scaleSize(34),
    },
    'large-phone': {
      xs: scaleSize(16),
      sm: scaleSize(20),
      md: scaleSize(24),
      lg: scaleSize(28),
      xl: scaleSize(32),
      '2xl': scaleSize(36),
    },
    'tablet': {
      xs: scaleSize(18),
      sm: scaleSize(22),
      md: scaleSize(26),
      lg: scaleSize(30),
      xl: scaleSize(34),
      '2xl': scaleSize(38),
    },
    'desktop': {
      xs: scaleSize(20),
      sm: scaleSize(24),
      md: scaleSize(28),
      lg: scaleSize(32),
      xl: scaleSize(36),
      '2xl': scaleSize(40),
    },
  };
  
  return iconSizes[deviceType];
};

// Get responsive card dimensions
export const getResponsiveCardDimensions = () => {
  const deviceType = getDeviceType();
  
  const cardDimensions = {
    'small-phone': {
      minHeight: scaleHeight(80),
      padding: scaleSize(12),
      borderRadius: scaleSize(12),
      margin: scaleSize(8),
    },
    'medium-phone': {
      minHeight: scaleHeight(90),
      padding: scaleSize(14),
      borderRadius: scaleSize(14),
      margin: scaleSize(10),
    },
    'large-phone': {
      minHeight: scaleHeight(100),
      padding: scaleSize(16),
      borderRadius: scaleSize(16),
      margin: scaleSize(12),
    },
    'tablet': {
      minHeight: scaleHeight(120),
      padding: scaleSize(20),
      borderRadius: scaleSize(20),
      margin: scaleSize(16),
    },
    'desktop': {
      minHeight: scaleHeight(140),
      padding: scaleSize(24),
      borderRadius: scaleSize(24),
      margin: scaleSize(20),
    },
  };
  
  return cardDimensions[deviceType];
};

// Get responsive button dimensions
export const getResponsiveButtonDimensions = () => {
  const deviceType = getDeviceType();
  
  const buttonDimensions = {
    'small-phone': {
      minHeight: scaleHeight(36),
      paddingHorizontal: scaleSize(12),
      paddingVertical: scaleSize(8),
      borderRadius: scaleSize(8),
      fontSize: scaleFont(14),
    },
    'medium-phone': {
      minHeight: scaleHeight(40),
      paddingHorizontal: scaleSize(14),
      paddingVertical: scaleSize(10),
      borderRadius: scaleSize(10),
      fontSize: scaleFont(15),
    },
    'large-phone': {
      minHeight: scaleHeight(44),
      paddingHorizontal: scaleSize(16),
      paddingVertical: scaleSize(12),
      borderRadius: scaleSize(12),
      fontSize: scaleFont(16),
    },
    'tablet': {
      minHeight: scaleHeight(48),
      paddingHorizontal: scaleSize(20),
      paddingVertical: scaleSize(14),
      borderRadius: scaleSize(14),
      fontSize: scaleFont(17),
    },
    'desktop': {
      minHeight: scaleHeight(52),
      paddingHorizontal: scaleSize(24),
      paddingVertical: scaleSize(16),
      borderRadius: scaleSize(16),
      fontSize: scaleFont(18),
    },
  };
  
  return buttonDimensions[deviceType];
};

// Export screen dimensions for direct use
export const SCREEN_DIMENSIONS = {
  width: SCREEN_WIDTH,
  height: SCREEN_HEIGHT,
};

// Helper function to check if device is small
export const isSmallDevice = () => {
  return SCREEN_WIDTH < BREAKPOINTS.sm;
};

// Helper function to check if device is tablet or larger
export const isTabletOrLarger = () => {
  return SCREEN_WIDTH >= BREAKPOINTS.lg;
};
