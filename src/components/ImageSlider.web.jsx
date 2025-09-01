import React, { useState, useEffect, useRef } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { imageSliderConfig, getSlidesForContext } from '@/config/imageSliderConfig';

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
      if (scrollViewRef.current) {
        scrollViewRef.current.scrollTo({
          left: nextIndex * scrollViewRef.current.offsetWidth,
          behavior: 'smooth',
        });
      }
    }, interval);

    return () => clearInterval(timer);
  }, [currentIndex, autoPlay, interval, slidesToShow.length]);

  const handleScroll = (event) => {
    const container = event.target;
    const index = Math.round(container.scrollLeft / container.offsetWidth);
    setCurrentIndex(index);
  };

  const goToSlide = (index) => {
    setCurrentIndex(index);
    if (scrollViewRef.current) {
      scrollViewRef.current.scrollTo({
        left: index * scrollViewRef.current.offsetWidth,
        behavior: 'smooth',
      });
    }
  };

  return (
    <div className="relative h-48 my-4">
      <div
        ref={scrollViewRef}
        className="flex overflow-x-auto scrollbar-hide snap-x snap-mandatory"
        onScroll={handleScroll}
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
                 {slidesToShow.map((slide, index) => (
           <div
             key={slide.id}
             className="flex-shrink-0 snap-start relative"
             style={{ width: '100vw', minWidth: '100vw' }}
           >
             <div className="relative h-48 mx-5 rounded-xl overflow-hidden shadow-lg" style={{ width: 'calc(100vw - 80px)', maxWidth: 'calc(100vw - 80px)' }}>
              <img
                src={slide.image}
                alt={slide.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black bg-opacity-40 flex items-center justify-center p-5">
                <div className="text-center text-white">
                  <h3 className="text-2xl font-bold mb-2 drop-shadow-lg">
                    {slide.title}
                  </h3>
                  <p className="text-sm mb-4 opacity-90 drop-shadow-lg">
                    {slide.description}
                  </p>
                  <button className="inline-flex items-center bg-white bg-opacity-20 hover:bg-opacity-30 transition-all duration-200 px-4 py-2 rounded-full border border-white border-opacity-30 text-white text-sm font-semibold">
                    {slide.actionText}
                    <svg
                      className="w-4 h-4 ml-2"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination Dots */}
      <div className="absolute bottom-3 left-1/2 transform -translate-x-1/2 flex space-x-2">
        {slidesToShow.map((_, index) => (
          <button
            key={index}
            onClick={() => goToSlide(index)}
            className={`w-2 h-2 rounded-full transition-all duration-200 ${
              index === currentIndex
                ? 'bg-white w-6'
                : 'bg-white bg-opacity-50 hover:bg-opacity-75'
            }`}
          />
        ))}
      </div>

      {/* Navigation Arrows */}
      <button
        className="absolute left-2 top-1/2 transform -translate-y-1/2 w-10 h-10 rounded-full bg-black bg-opacity-50 hover:bg-opacity-70 transition-all duration-200 flex items-center justify-center text-white shadow-lg"
        onClick={() => {
          const prevIndex = currentIndex === 0 ? slidesToShow.length - 1 : currentIndex - 1;
          goToSlide(prevIndex);
        }}
      >
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
        </svg>
      </button>

      <button
        className="absolute right-2 top-1/2 transform -translate-y-1/2 w-10 h-10 rounded-full bg-black bg-opacity-50 hover:bg-opacity-70 transition-all duration-200 flex items-center justify-center text-white shadow-lg"
        onClick={() => {
          const nextIndex = (currentIndex + 1) % slidesToShow.length;
          goToSlide(nextIndex);
        }}
      >
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
      </button>

      <style jsx>{`
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
};

export default ImageSlider;
