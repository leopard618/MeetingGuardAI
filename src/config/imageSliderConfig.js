// Configuration for the Image Slider advertising content
export const imageSliderConfig = {
  // Auto-play settings
  autoPlay: true,
  interval: 4000, // 4 seconds per slide
  
  // Default slides for advertising
  defaultSlides: [
    {
      id: 1,
      image: 'https://images.unsplash.com/photo-1515187029135-18ee286d815b?w=800&h=400&fit=crop',
      title: 'Stay on top.',
      description: 'View today\'s meetings and AI insights at a glance.',
      actionText: 'Learn More',
      actionUrl: '#',
      backgroundColor: 'rgba(59, 130, 246, 0.8)' // Blue overlay
    },
    {
      id: 2,
      image: 'https://images.unsplash.com/photo-1551434678-e076c223a692?w=800&h=400&fit=crop',
      title: 'AI scheduling.',
      description: 'Just type or talk to create meetings instantly.',
      actionText: 'Try Now',
      actionUrl: '#',
      backgroundColor: 'rgba(16, 185, 129, 0.8)' // Green overlay
    },
    {
      id: 3,
      image: 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&h=400&fit=crop',
      title: 'Never miss.',
      description: 'Full-screen alerts with sound keep you on time.',
      actionText: 'Enable',
      actionUrl: '#',
      backgroundColor: 'rgba(245, 158, 11, 0.8)' // Orange overlay
    },
    {
      id: 4,
      image: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&h=400&fit=crop',
      title: 'All meetings.',
      description: 'Organize past and future meetings seamlessly.',
      actionText: 'View All',
      actionUrl: '#',
      backgroundColor: 'rgba(139, 92, 246, 0.8)' // Purple overlay
    },
    {
      id: 5,
      image: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=800&h=400&fit=crop',
      title: 'Sync everywhere.',
      description: 'Works with Google, Outlook & Apple Calendar.',
      actionText: 'Connect',
      actionUrl: '#',
      backgroundColor: 'rgba(239, 68, 68, 0.8)' // Red overlay
    }
  ],
  
  // Custom slides for specific campaigns or promotions
  promotionalSlides: [
    {
      id: 'promo-1',
      image: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&h=400&fit=crop',
      title: 'New Feature!',
      description: 'AI-powered meeting summaries now available.',
      actionText: 'Try Free',
      actionUrl: '#',
      backgroundColor: 'rgba(59, 130, 246, 0.8)',
      isPromotional: true
    }
  ],
  
  // Settings for different screen sizes
  responsiveSettings: {
    mobile: {
      height: 200,
      titleSize: 24,
      descriptionSize: 14
    },
    tablet: {
      height: 250,
      titleSize: 28,
      descriptionSize: 16
    },
    desktop: {
      height: 300,
      titleSize: 32,
      descriptionSize: 18
    }
  }
};

// Helper function to get slides based on context
export const getSlidesForContext = (context = 'default') => {
  switch (context) {
    case 'promotional':
      return [...imageSliderConfig.defaultSlides, ...imageSliderConfig.promotionalSlides];
    case 'minimal':
      return imageSliderConfig.defaultSlides.slice(0, 3);
    default:
      return imageSliderConfig.defaultSlides;
  }
};

// Helper function to get responsive settings
export const getResponsiveSettings = (screenWidth) => {
  if (screenWidth >= 1024) {
    return imageSliderConfig.responsiveSettings.desktop;
  } else if (screenWidth >= 768) {
    return imageSliderConfig.responsiveSettings.tablet;
  } else {
    return imageSliderConfig.responsiveSettings.mobile;
  }
};
