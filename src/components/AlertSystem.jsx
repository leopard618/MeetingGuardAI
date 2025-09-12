
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from './ui\button';
import { Input } from './ui\input';
import { Card, CardContent } from './ui\card';
import { Switch } from './ui\switch'; // Added for customizable alerts
import { Label } from './ui\label'; // Added for customizable alerts
import { Brain, Clock, Volume2, VolumeX, Calendar, Smartphone, Settings2 } from "lucide-react-native"; // Settings2 added for customization icon
import { motion, AnimatePresence } from "framer-motion";
import { Meeting, User, UserPreferences } from '../api/entities'; // Added User, UserPreferences
import { storage } from '../utils/storage.js';

export default function AlertSystem({ 
  meeting, 
  isOpen, 
  onClose, 
  onSnooze,
  onPostpone,
  language = "en",
  alertType = "15min",
  onAlertCustomized // New prop for passing custom alert configuration back
}) {
  const [countdown, setCountdown] = useState(30);
  const [volume, setVolume] = useState(0.3);
  const [isMuted, setIsMuted] = useState(false); // Temporary mute state
  const [postponeDate, setPostponeDate] = useState('');
  const [postponeTime, setPostponeTime] = useState('');
  const [showPostponeModal, setShowPostponeModal] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [audioInitialized, setAudioInitialized] = useState(false);
  const [vibrationSupported, setVibrationSupported] = useState(false);
  
  const [customizeAlert, setCustomizeAlert] = useState(false); // State to show customization view
  const [customAlertConfig, setCustomAlertConfig] = useState({
    minutesBefore: 15,
    soundEnabled: true,
    vibrationEnabled: true,
    speechEnabled: true,
    intensity: 'max'
  });

  const audioContextRef = useRef(null);
  const alarmIntervalRef = useRef(null);
  const volumeIntervalRef = useRef(null);
  const countdownIntervalRef = useRef(null);
  const audioElementRef = useRef(null);

  // Load custom alert configuration from storage
  useEffect(() => {
    const loadCustomAlertConfig = async () => {
      try {
        const storedConfig = await storage.getItem('customMeetingAlertConfig');
        if (storedConfig) {
          setCustomAlertConfig(JSON.parse(storedConfig));
        } else {
          // Get alert intensity from user preferences if available
          const userPrefsStr = await storage.getItem('userPreferences');
          const userPrefs = userPrefsStr ? JSON.parse(userPrefsStr) : {};
          let intensity = 'max'; // default
          
          // Try to get from UserPreferences if available
          if (userPrefs.alert_intensity) {
            intensity = userPrefs.alert_intensity;
          }
          
          const defaultConfig = {
            minutesBefore: 15,
            soundEnabled: intensity !== 'light', // Sound enabled for medium/max
            vibrationEnabled: intensity === 'max', // Vibration only for max
            speechEnabled: intensity !== 'light', // Speech enabled for medium/max
            intensity: intensity // Store intensity in config
          };
          setCustomAlertConfig(defaultConfig);
        }
      } catch (e) {
        console.error("Failed to parse custom alert config from storage", e);
        // Keep the default state
      }
    };

    loadCustomAlertConfig();
  }, []);

  const t = {
    en: {
      title: "🚨 MEETING ALERT 🚨",
      subtitle: "You have an important meeting!",
      inMinutes: "in minutes",
      now: "NOW",
      understood: "UNDERSTOOD - GO TO MEETING",
      snooze5: "Snooze 5 min",
      snooze15: "Snooze 15 min",
      snooze60: "Snooze 1 hour",
      postpone: "Postpone Meeting",
      reschedule: "Reschedule",
      cancel: "Cancel",
      autoClose: "Auto-close in",
      muteSound: "Mute",
      unmuteSound: "Unmute",
      postponeTitle: "Reschedule Meeting",
      newDate: "New Date",
      newTime: "New Time",
      tapToActivateAudio: "TAP TO ACTIVATE AUDIO",
      
      // New translations for customization feature
      customizeAlert: "Customize Alert",
      customizeAlertTitle: "Customize Alert Settings",
      minutesBeforeMeeting: "Minutes before meeting",
      enableSound: "Enable Sound",
      enableVibration: "Enable Vibration",
      enableSpeech: "Enable Speech",
      saveCustomization: "Save Customization",
      back: "Back",
    },
    es: {
      title: "🚨 ALERTA DE REUNIÓN 🚨",
      subtitle: "¡Tienes una reunión importante!",
      inMinutes: "en minutos",
      now: "AHORA",
      understood: "ENTENDIDO - IR A REUNIÓN",
      snooze5: "Posponer 5 min",
      snooze15: "Posponer 15 min",
      snooze60: "Posponer 1 hora",
      postpone: "Reagendar Reunión",
      reschedule: "Reagendar",
      cancel: "Cancelar",
      autoClose: "Cierre automático en",
      muteSound: "Silenciar",
      unmuteSound: "Activar sonido",
      postponeTitle: "Reagendar Reunión",
      newDate: "Nueva Fecha",
      newTime: "Nueva Hora",
      tapToActivateAudio: "TOCA PARA ACTIVAR AUDIO",

      // New translations for customization feature
      customizeAlert: "Personalizar Alerta",
      customizeAlertTitle: "Configuración de Alerta Personalizada",
      minutesBeforeMeeting: "Minutos antes de la reunión",
      enableSound: "Activar Sonido",
      enableVibration: "Activar Vibración",
      enableSpeech: "Activar Voz",
      saveCustomization: "Guardar Personalización",
      back: "Atrás",
    }
  };

  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                           window.innerWidth < 768;
      setIsMobile(isMobileDevice);
      setVibrationSupported('vibrate' in navigator);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Save custom alert config to storage whenever it changes
  useEffect(() => {
    const saveCustomAlertConfig = async () => {
      try {
        await storage.setItem('customMeetingAlertConfig', JSON.stringify(customAlertConfig));
      } catch (e) {
        console.error("Failed to save custom alert config to storage", e);
      }
    };
    saveCustomAlertConfig();
  }, [customAlertConfig]);

  // Load user preferences and update alert config
  useEffect(() => {
    const loadUserPreferences = async () => {
      try {
        const user = await User.me();
        const prefsList = await UserPreferences.filter({ created_by: user.email });
        
        if (prefsList.length > 0) {
          const prefs = prefsList[0];
          const newConfig = {
            minutesBefore: customAlertConfig.minutesBefore,
            soundEnabled: prefs.alert_intensity !== 'light',
            vibrationEnabled: prefs.alert_intensity === 'max',
            speechEnabled: prefs.alert_intensity !== 'light',
            intensity: prefs.alert_intensity || 'max'
          };
          
          setCustomAlertConfig(newConfig);
          await storage.setItem('customMeetingAlertConfig', JSON.stringify(newConfig));
          await storage.setItem('userPreferences', JSON.stringify(prefs));
        }
      } catch (error) {
        console.error('Error loading user preferences for alerts:', error);
      }
    };
    
    loadUserPreferences();
  }, []); // Run once on mount

  // Initialize Audio Context (Mobile-Friendly)
  const initializeAudio = useCallback(async () => {
    if (audioInitialized) return true;
    
    // Only attempt to initialize audio if sound or speech are enabled in custom config
    if (!customAlertConfig.soundEnabled && !customAlertConfig.speechEnabled) {
      setAudioInitialized(true); // Mark as initialized even if no audio will play
      return true;
    }

    try {
      // For mobile, create audio element for better compatibility
      if (isMobile) {
        if (!audioElementRef.current) {
          audioElementRef.current = new Audio();
          audioElementRef.current.volume = volume;
          audioElementRef.current.loop = false;
          
          // Use the existing alarm sound data URL
          audioElementRef.current.src = "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmESBSWC3PLZ";
        }
        setAudioInitialized(true);
        return true;
      } else {
        // Desktop Web Audio API
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
          await audioContextRef.current.resume();
        }
        setAudioInitialized(true);
        return true;
      }
    } catch (error) {
      console.error('Audio initialization failed:', error);
      return false;
    }
  }, [isMobile, volume, audioInitialized, customAlertConfig.soundEnabled, customAlertConfig.speechEnabled]);

  // Play Alarm Sound (Mobile-Compatible)
  const playAlarm = useCallback(async () => {
    if (isMuted) return;
    
    const intensity = customAlertConfig.intensity || 'max';
    
    // Check if sound should play based on intensity and config
    const shouldPlaySound = intensity !== 'light' && customAlertConfig.soundEnabled;
    
    if (!shouldPlaySound) return;
    
    try {
      if (isMobile && audioElementRef.current) {
        audioElementRef.current.currentTime = 0;
        
        // Volume based on intensity
        let volumeLevel = volume;
        switch (intensity) {
          case 'medium':
            volumeLevel = Math.min(volume * 0.6, 0.6);
            break;
          case 'max':
          default:
            volumeLevel = Math.min(volume, 1);
            break;
        }
        
        audioElementRef.current.volume = volumeLevel;
        const playPromise = audioElementRef.current.play();
        
        if (playPromise !== undefined) {
          await playPromise;
        }
        
        // Vibration based on intensity
        if (vibrationSupported && customAlertConfig.vibrationEnabled) {
          switch (intensity) {
            case 'medium':
              navigator.vibrate([200, 100, 200]);
              break;
            case 'max':
            default:
              navigator.vibrate([300, 150, 300, 150, 300]);
              break;
          }
        }
      } else if (audioContextRef.current) {
        // Desktop Web Audio API
        const oscillator = audioContextRef.current.createOscillator();
        const gainNode = audioContextRef.current.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContextRef.current.destination);
        
        // Different frequencies and patterns for intensity
        let frequency = intensity === 'medium' ? 700 : 900;
        let duration = intensity === 'medium' ? 0.7 : 1.2;
        
        oscillator.frequency.setValueAtTime(frequency, audioContextRef.current.currentTime);
        oscillator.frequency.setValueAtTime(frequency + 200, audioContextRef.current.currentTime + duration/2);
        
        const volumeMultiplier = intensity === 'medium' ? 0.6 : 1;
        gainNode.gain.setValueAtTime(volume * volumeMultiplier, audioContextRef.current.currentTime);
        
        oscillator.start();
        oscillator.stop(audioContextRef.current.currentTime + duration);
      }
    } catch (error) {
      console.error('Audio playback failed:', error);
      // Fallback to vibration
      if (vibrationSupported && customAlertConfig.vibrationEnabled) {
        const pattern = intensity === 'medium' ? [300, 200, 300] : [500, 200, 500, 200, 500];
        navigator.vibrate(pattern);
      }
    }
  }, [volume, isMuted, isMobile, vibrationSupported, customAlertConfig]);

  // Voice Synthesis (Mobile-Enhanced)
  const speakAlert = useCallback(() => {
    if (isMuted || !meeting) return;
    
    const intensity = customAlertConfig.intensity || 'max';
    
    // Check if speech should play based on intensity and config
    const shouldSpeak = intensity !== 'light' && customAlertConfig.speechEnabled;
    
    if (!shouldSpeak) return;
    
    try {
      speechSynthesis.cancel();
      
      const meetingTime = new Date(`${meeting.date} ${meeting.time}`);
      const now = new Date();
      const minutesUntil = Math.ceil((meetingTime - now) / (1000 * 60));
      
      let message;
      if (language === 'es') {
        if (intensity === 'medium') {
          message = `Atención. Reunión ${meeting.title} comenzando en ${minutesUntil} minutos`;
        } else { // max
          message = `Alerta urgente. Reunión ${meeting.title} comenzando en ${minutesUntil} minutos`;
        }
      } else { // English
        if (intensity === 'medium') {
          message = `Attention. ${meeting.title} meeting starting in ${minutesUntil} minutes`;
        } else { // max
          message = `Urgent alert. ${meeting.title} meeting starting in ${minutesUntil} minutes`;
        }
      }
      
      if (minutesUntil <= 0) {
        message = language === 'es' 
          ? `${intensity === 'max' ? 'Alerta urgente. ' : 'Atención. '}Reunión ${meeting.title} comenzando ahora`
          : `${intensity === 'max' ? 'Urgent alert. ' : 'Attention. '}${meeting.title} meeting starting now`;
      }
      
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = language === 'es' ? 'es-ES' : 'en-US';
      
      // Speech parameters based on intensity
      switch (intensity) {
        case 'medium':
          utterance.rate = 0.9;
          utterance.pitch = 1.0;
          utterance.volume = Math.min(volume * 0.7, 0.7);
          break;
        case 'max':
        default:
          utterance.rate = 0.8;
          utterance.pitch = 1.2;
          utterance.volume = Math.min(volume, 1);
          break;
      }
      
      if (isMobile) {
        // Adjust for mobile voice engines if necessary, e.g., make it sound more natural
        utterance.rate = Math.max(utterance.rate, 0.9); // ensure minimum rate
        utterance.pitch = Math.min(utterance.pitch, 1.0); // ensure maximum pitch for natural sound
      }
      
      speechSynthesis.speak(utterance);
    } catch (error) {
      console.error('Speech synthesis failed:', error);
    }
  }, [meeting, language, isMuted, volume, isMobile, customAlertConfig]);

  // Handle user interaction to initialize audio
  const handleAudioActivation = async () => {
    // Only attempt to initialize audio if sound or speech are enabled in custom config
    if (customAlertConfig.soundEnabled || customAlertConfig.speechEnabled) {
      await initializeAudio();
      if (!isMuted) {
        if (customAlertConfig.soundEnabled && customAlertConfig.intensity !== 'light') await playAlarm();
        if (customAlertConfig.speechEnabled && customAlertConfig.intensity !== 'light') speakAlert();
      }
    } else {
      // If no audio features are enabled, mark as initialized to proceed without audio
      setAudioInitialized(true); 
    }
  };

  // Prevent escape methods (Enhanced for mobile)
  useEffect(() => {
    if (!isOpen) return;

    const preventEscape = (e) => {
      // Prevent ESC, back button, etc.
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
      
      if (e.altKey || e.metaKey || (e.ctrlKey && e.key === 'w')) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    };

    const preventContextMenu = (e) => {
      e.preventDefault();
      return false;
    };

    const preventSelection = (e) => {
      e.preventDefault();
      return false;
    };

    // Prevent scrolling on mobile
    const preventScroll = (e) => {
      e.preventDefault();
    };

    document.addEventListener('keydown', preventEscape, true);
    document.addEventListener('contextmenu', preventContextMenu);
    document.addEventListener('selectstart', preventSelection);
    document.addEventListener('touchmove', preventScroll, { passive: false });
    document.body.style.overflow = 'hidden';
    
    // Prevent back button on mobile
    if (isMobile) {
      window.history.pushState(null, null, window.location.pathname);
      const preventBack = () => {
        window.history.pushState(null, null, window.location.pathname);
      };
      window.addEventListener('popstate', preventBack);
      
      return () => {
        document.removeEventListener('keydown', preventEscape, true);
        document.removeEventListener('contextmenu', preventContextMenu);
        document.removeEventListener('selectstart', preventSelection);
        document.removeEventListener('touchmove', preventScroll);
        window.removeEventListener('popstate', preventBack);
        document.body.style.overflow = 'auto';
      };
    }

    return () => {
      document.removeEventListener('keydown', preventEscape, true);
      document.removeEventListener('contextmenu', preventContextMenu);
      document.removeEventListener('selectstart', preventSelection);
      document.removeEventListener('touchmove', preventScroll);
      document.body.style.overflow = 'auto';
    };
  }, [isOpen, isMobile]);

  // Setup audio and countdown when alert opens
  useEffect(() => {
    if (!isOpen || !meeting) return;

    const intensity = customAlertConfig.intensity || 'max';
    
    // Set up countdown for auto-close (varies by intensity)
    const autoCloseTime = intensity === 'light' ? 10 : intensity === 'medium' ? 20 : 30;
    setCountdown(autoCloseTime);
    
    countdownIntervalRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          onClose();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Initialize audio
    const setupAudio = async () => {
      await initializeAudio();
      
      const startAlarmSequence = async () => {
        if (!isMuted) {
          if (customAlertConfig.soundEnabled && intensity !== 'light') await playAlarm();
          if (customAlertConfig.speechEnabled && intensity !== 'light') speakAlert();
          
          // Alarm interval varies by intensity
          const intervalTime = intensity === 'medium' ? 6000 : 4000; // medium = every 6s, max = every 4s
          
          if (intensity !== 'light') { // Only set interval if sound is not 'light'
            alarmIntervalRef.current = setInterval(async () => {
              if (!isMuted && customAlertConfig.soundEnabled) {
                await playAlarm();
              }
            }, intervalTime);
          }
        }
      };

      if (isMobile && !audioInitialized && (customAlertConfig.soundEnabled || customAlertConfig.speechEnabled)) {
        // Audio will be activated on first user interaction
      } else {
        startAlarmSequence();
      }
    };

    // Volume increase rate varies by intensity
    if (customAlertConfig.soundEnabled && intensity !== 'light') { // Only increase volume if sound is not 'light'
      const volumeIncrement = intensity === 'medium' ? 0.03 : 0.05;
      volumeIntervalRef.current = setInterval(() => {
        setVolume(prev => Math.min(1, prev + volumeIncrement));
      }, 1500);
    }

    setupAudio();

    return () => {
      if (alarmIntervalRef.current) clearInterval(alarmIntervalRef.current);
      if (volumeIntervalRef.current) clearInterval(volumeIntervalRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, [isOpen, meeting, initializeAudio, playAlarm, speakAlert, onClose, isMuted, isMobile, audioInitialized, customAlertConfig]);

  // Handle Snooze with audio activation
  const handleSnooze = async (minutes) => {
    await handleAudioActivation(); // Ensure audio is active before snoozing
    const snoozeUntil = Date.now() + (minutes * 60 * 1000);
    try {
      await storage.setItem(`meetingAlert_${meeting?.id}`, JSON.stringify({
        snoozedUntil: snoozeUntil,
        snoozeMinutes: minutes,
        timestamp: Date.now()
      }));
    } catch (error) {
      console.error('Failed to save snooze state:', error);
    }
    onSnooze && onSnooze(minutes);
    onClose();
  };

  // Handle Postpone with audio activation
  const handlePostpone = async () => {
    if (!postponeDate || !postponeTime) return;
    
    await handleAudioActivation(); // Ensure audio is active before postponing
    
    try {
      await Meeting.update(meeting.id, {
        date: postponeDate,
        time: postponeTime
      });
      
      await storage.setItem(`meetingAlert_${meeting?.id}`, JSON.stringify({
        postponed: true,
        newDate: postponeDate,
        newTime: postponeTime,
        timestamp: Date.now()
      }));
      
      onPostpone && onPostpone({ date: postponeDate, time: postponeTime });
      onClose();
    } catch (error) {
      console.error('Failed to postpone meeting:', error);
    }
  };

  // Handle main close with audio activation
  const handleMainClose = async () => {
    await handleAudioActivation(); // Ensure audio is active before closing
    onClose();
  };

  // Handle saving custom alert settings
  const handleSaveCustomization = () => {
    setCustomizeAlert(false); // Close customization view
    onAlertCustomized && onAlertCustomized(customAlertConfig); // Pass updated config to parent
  };

  // Calculate minutes until meeting for display
  const getMinutesUntil = () => {
    if (!meeting) return 0;
    const meetingTime = new Date(`${meeting.date} ${meeting.time}`);
    const now = new Date();
    return Math.ceil((meetingTime - now) / (1000 * 60));
  };

  const minutesUntil = getMinutesUntil();

  if (!meeting) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="meeting-alert-overlay">
          <style>{`
            .meeting-alert-overlay {
              position: fixed !important;
              top: 0; left: 0; right: 0; bottom: 0;
              z-index: 10000;
              background: rgba(0,0,0,0.95);
              backdrop-filter: blur(10px);
              display: flex;
              justify-content: center;
              align-items: center;
              user-select: none;
              overflow: hidden;
            }
            
            .alert-modal {
              background: white;
              border-radius: 13px;
              padding: ${isMobile ? '20px' : '24px'};
              max-width: ${isMobile ? '90vw' : '400px'};
              width: 90%;
              max-height: ${isMobile ? '90vh' : 'auto'};
              overflow-y: auto;
              box-shadow: 0 25px 50px rgba(0,0,0,0.25);
              animation: alertPulse 2s infinite;
            }
            
            @keyframes alertPulse {
              0%, 100% { transform: scale(1); box-shadow: 0 25px 50px rgba(0,0,0,0.25); }
              50% { transform: scale(1.02); box-shadow: 0 30px 60px rgba(139, 92, 246, 0.3); }
            }
            
            .volume-indicator {
              width: ${volume * 100}%;
              height: 4px;
              background: linear-gradient(90deg, #10B981, #F59E0B, #EF4444);
              border-radius: 2px;
              transition: width 0.3s ease;
            }

            .mobile-audio-prompt {
              background: linear-gradient(135deg, #FF6B6B, #FF8E53);
              color: white;
              border: none;
              padding: 12px 20px;
              border-radius: 25px;
              font-weight: bold;
              font-size: 14px;
              margin: 10px 0;
              animation: bounce 1s infinite;
            }

            @keyframes bounce {
              0%, 20%, 50%, 80%, 100% { transform: translateY(0); }
              40% { transform: translateY(-10px); }
              60% { transform: translateY(-5px); }
            }
          `}</style>
          
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            className="alert-modal"
            onClick={(e) => e.stopPropagation()} // Prevent closing on modal click
          >
            {/* Conditional rendering for Main Alert View, Postpone Modal, or Customize Alert Modal */}
            {!showPostponeModal && !customizeAlert ? (
              <div className="text-center space-y-4">
                {/* Mobile Audio Activation Prompt */}
                {isMobile && !audioInitialized && (customAlertConfig.soundEnabled || customAlertConfig.speechEnabled) && (
                  <button
                    onClick={handleAudioActivation}
                    className="mobile-audio-prompt w-full"
                  >
                    <Smartphone className="w-5 h-5 mr-2 inline" />
                    {t[language].tapToActivateAudio}
                  </button>
                )}

                {/* Header with customization and mute buttons */}
                <div className="flex justify-between items-start mb-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCustomizeAlert(true)}
                    className="text-gray-500 hover:text-gray-700"
                    title={t[language].customizeAlert}
                  >
                    <Settings2 className="w-4 h-4" />
                  </Button>
                  <div className="flex-1">
                    <motion.div
                      animate={{ scale: [1, 1.1, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="w-16 h-16 mx-auto mb-4 meeting-gradient rounded-full flex items-center justify-center shadow-lg"
                    >
                      <Brain className="w-8 h-8 text-white" />
                    </motion.div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsMuted(!isMuted)}
                    className="text-gray-500 hover:text-gray-700"
                    title={isMuted ? t[language].unmuteSound : t[language].muteSound}
                  >
                    {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </Button>
                </div>

                {/* Alert Title */}
                <div>
                  <h1 className={`${isMobile ? 'text-xl' : 'text-2xl'} font-bold text-gray-900 mb-2`}>
                    {t[language].title}
                  </h1>
                  <p className="text-gray-600">
                    {t[language].subtitle}
                  </p>
                </div>

                {/* Meeting Details */}
                <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl p-4 space-y-3">
                  <h2 className={`${isMobile ? 'text-lg' : 'text-xl'} font-semibold text-gray-900`}>
                    {meeting.title}
                  </h2>
                  
                  <div className="flex items-center justify-center gap-2 text-lg">
                    <Clock className="w-5 h-5 text-gray-600" />
                    <span className="font-medium">
                      {minutesUntil <= 0 ? (
                        <span className="text-red-600 font-bold text-xl">
                          {t[language].now}
                        </span>
                      ) : (
                        <span>
                          {minutesUntil} {t[language].inMinutes}
                        </span>
                      )}
                    </span>
                  </div>

                  {/* Volume/Vibration Indicator */}
                  {/* Show indicator only if sound or vibration is enabled in custom config AND not muted */}
                  {((customAlertConfig.soundEnabled || (customAlertConfig.vibrationEnabled && vibrationSupported)) && !isMuted && customAlertConfig.intensity !== 'light') && (
                    <div className="space-y-1">
                      <div className="text-xs text-gray-500">
                        {customAlertConfig.soundEnabled && customAlertConfig.vibrationEnabled && vibrationSupported ? 'Audio + Vibration' : 
                         customAlertConfig.soundEnabled ? 'Audio Level' : 
                         customAlertConfig.vibrationEnabled && vibrationSupported ? 'Vibration Enabled' : ''}
                      </div>
                      {customAlertConfig.soundEnabled && ( // Only show volume bar if sound is enabled
                        <div className="w-full bg-gray-200 rounded-full h-1">
                          <div className="volume-indicator"></div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="space-y-3">
                  <Button
                    onClick={handleMainClose}
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 text-lg shadow-lg"
                  >
                    {t[language].understood}
                  </Button>
                  
                  <div className={`grid ${isMobile ? 'grid-cols-1 gap-2' : 'grid-cols-3 gap-2'}`}>
                    <Button
                      onClick={() => handleSnooze(5)}
                      variant="outline"
                      className="text-sm py-2"
                    >
                      {t[language].snooze5}
                    </Button>
                    <Button
                      onClick={() => handleSnooze(15)}
                      variant="outline"
                      className="text-sm py-2"
                    >
                      {t[language].snooze15}
                    </Button>
                    <Button
                      onClick={() => handleSnooze(60)}
                      variant="outline"
                      className="text-sm py-2"
                    >
                      {t[language].snooze60}
                    </Button>
                  </div>

                  <Button
                    onClick={() => setShowPostponeModal(true)}
                    variant="outline"
                    className="w-full text-blue-600 border-blue-200 hover:bg-blue-50"
                  >
                    <Calendar className="w-4 h-4 mr-2" />
                    {t[language].postpone}
                  </Button>
                </div>

                {/* Auto-close countdown */}
                <div className="text-xs text-gray-500">
                  {t[language].autoClose} {countdown}s
                </div>
              </div>
            ) : showPostponeModal ? (
              /* Postpone Modal */
              <div className="space-y-6">
                <h2 className={`${isMobile ? 'text-lg' : 'text-xl'} font-bold text-gray-900 text-center`}>
                  {t[language].postponeTitle}
                </h2>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t[language].newDate}
                    </label>
                    <Input
                      type="date"
                      value={postponeDate}
                      onChange={(e) => setPostponeDate(e.target.value)}
                      min={new Date().toISOString().split('T')[0]}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t[language].newTime}
                    </label>
                    <Input
                      type="time"
                      value={postponeTime}
                      onChange={(e) => setPostponeTime(e.target.value)}
                    />
                  </div>
                </div>
                
                <div className="flex gap-3">
                  <Button
                    onClick={() => setShowPostponeModal(false)}
                    variant="outline"
                    className="flex-1"
                  >
                    {t[language].cancel}
                  </Button>
                  <Button
                    onClick={handlePostpone}
                    disabled={!postponeDate || !postponeTime}
                    className="flex-1 bg-blue-600 hover:bg-blue-700"
                  >
                    {t[language].reschedule}
                  </Button>
                </div>
              </div>
            ) : (
              /* Customize Alert Modal */
              <div className="space-y-6">
                <h2 className={`${isMobile ? 'text-lg' : 'text-xl'} font-bold text-gray-900 text-center`}>
                  {t[language].customizeAlertTitle}
                </h2>
                
                <div className="space-y-4">
                  {/* Minutes before meeting input */}
                  <div>
                    <Label htmlFor="minutesBefore" className="block text-sm font-medium text-gray-700 mb-1">
                      {t[language].minutesBeforeMeeting}
                    </Label>
                    <Input
                      id="minutesBefore"
                      type="number"
                      value={customAlertConfig.minutesBefore}
                      onChange={(e) => setCustomAlertConfig(prev => ({
                        ...prev,
                        minutesBefore: Math.max(0, parseInt(e.target.value) || 0) // Ensure non-negative number
                      }))}
                      min="0"
                      step="1"
                      className="text-center"
                    />
                  </div>

                  {/* Toggle for Enable Sound */}
                  <div className="flex items-center justify-between">
                    <Label htmlFor="enableSound">{t[language].enableSound}</Label>
                    <Switch
                      id="enableSound"
                      checked={customAlertConfig.soundEnabled}
                      onCheckedChange={(checked) => setCustomAlertConfig(prev => ({ ...prev, soundEnabled: checked }))}
                    />
                  </div>

                  {/* Toggle for Enable Vibration (only if supported by device) */}
                  {vibrationSupported && (
                    <div className="flex items-center justify-between">
                      <Label htmlFor="enableVibration">{t[language].enableVibration}</Label>
                      <Switch
                        id="enableVibration"
                        checked={customAlertConfig.vibrationEnabled}
                        onCheckedChange={(checked) => setCustomAlertConfig(prev => ({ ...prev, vibrationEnabled: checked }))}
                      />
                    </div>
                  )}

                  {/* Toggle for Enable Speech */}
                  <div className="flex items-center justify-between">
                    <Label htmlFor="enableSpeech">{t[language].enableSpeech}</Label>
                    <Switch
                      id="enableSpeech"
                      checked={customAlertConfig.speechEnabled}
                      onCheckedChange={(checked) => setCustomAlertConfig(prev => ({ ...prev, speechEnabled: checked }))}
                    />
                  </div>
                </div>
                
                <div className="flex gap-3">
                  <Button
                    onClick={() => setCustomizeAlert(false)}
                    variant="outline"
                    className="flex-1"
                  >
                    {t[language].back}
                  </Button>
                  <Button
                    onClick={handleSaveCustomization}
                    className="flex-1 bg-green-600 hover:bg-green-700"
                  >
                    {t[language].saveCustomization}
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
