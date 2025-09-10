import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ScrollView,
  Animated,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { imageSliderConfig, getSlidesForContext } from '../config/imageSliderConfig.js';

const { width: screenWidth } = Dimensions.get('window');

const ImageSlider = ({ slides = [], autoPlay = true, interval = 3000, context = 'default' }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollViewRef = useRef(null);
  const { isDarkMode } = useTheme();

  // Get slides from configuration
  const defaultSlides = getSlidesForContext(context);

  const slidesToShow = slides.length > 0 ? slides : defaultSlides;

  useEffect(() => {
    if (!autoPlay) return;

    const timer = setInterval(() => {
      const nextIndex = (currentIndex + 1) % slidesToShow.length;
      setCurrentIndex(nextIndex);
      scrollViewRef.current?.scrollTo({
        x: nextIndex * screenWidth,
        animated: true,
      });
    }, interval);

    return () => clearInterval(timer);
  }, [currentIndex, autoPlay, interval, slidesToShow.length]);

  const handleScroll = (event) => {
    const contentOffset = event.nativeEvent.contentOffset.x;
    const index = Math.round(contentOffset / screenWidth);
    setCurrentIndex(index);
  };

  const goToSlide = (index) => {
    setCurrentIndex(index);
    scrollViewRef.current?.scrollTo({
      x: index * screenWidth,
      animated: true,
    });
  };

  const styles = getStyles(isDarkMode);

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        style={styles.scrollView}
      >
        {slidesToShow.map((slide, index) => (
          <View key={slide.id} style={styles.slide}>
            <Image
              source={{ uri: slide.image }}
              style={styles.image}
              resizeMode="cover"
            />
            <View style={styles.overlay}>
              <View style={styles.content}>
                <Text style={styles.title}>{slide.title}</Text>
                <Text style={styles.description}>{slide.description}</Text>
                <TouchableOpacity style={styles.actionButton}>
                  <Text style={styles.actionButtonText}>{slide.actionText}</Text>
                  <MaterialIcons name="arrow-forward" size={16} color="#ffffff" />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Pagination Dots */}
      <View style={styles.pagination}>
        {slidesToShow.map((_, index) => (
          <TouchableOpacity
            key={index}
            style={[
              styles.paginationDot,
              index === currentIndex && styles.paginationDotActive
            ]}
            onPress={() => goToSlide(index)}
          />
        ))}
      </View>

      {/* Navigation Arrows */}
      <TouchableOpacity
        style={[styles.navButton, styles.navButtonLeft]}
        onPress={() => {
          const prevIndex = currentIndex === 0 ? slidesToShow.length - 1 : currentIndex - 1;
          goToSlide(prevIndex);
        }}
      >
        <MaterialIcons 
          name="chevron-left" 
          size={24} 
          color="#ffffff" 
        />
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.navButton, styles.navButtonRight]}
        onPress={() => {
          const nextIndex = (currentIndex + 1) % slidesToShow.length;
          goToSlide(nextIndex);
        }}
      >
        <MaterialIcons 
          name="chevron-right" 
          size={24} 
          color="#ffffff" 
        />
      </TouchableOpacity>
    </View>
  );
};

const getStyles = (isDarkMode) => StyleSheet.create({
  container: {
    height: 200,
    marginVertical: 10,
    position: 'relative',
  },
  scrollView: {
    flex: 1,
  },
  slide: {
    width: screenWidth - 50, // Reduced width to show border radius
    height: 200,
    marginRight: 50, // Consistent right margin
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    padding: 20,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 8,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: -1, height: 1 },
    textShadowRadius: 10,
  },
  description: {
    fontSize: 14,
    color: '#ffffff',
    marginBottom: 16,
    opacity: 0.9,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: -1, height: 1 },
    textShadowRadius: 10,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    marginRight: 4,
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
  },
  paginationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    marginHorizontal: 4,
  },
  paginationDotActive: {
    backgroundColor: '#ffffff',
    width: 24,
    height: 8,
    borderRadius: 4,
  },
  navButton: {
    position: 'absolute',
    top: '50%',
    transform: [{ translateY: -20 }],
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  navButtonLeft: {
    left: 10,
  },
  navButtonRight: {
    right: 10,
  },
});

export default ImageSlider;
