import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from "framer-motion";
import { Button } from './ui\button';
import { Card, CardContent } from './ui\card';
import { Brain, Clock, AlertTriangle, CheckCircle2, AlarmClockOff } from "lucide-react-native";
import { format } from "date-fns";
import { es, enUS } from "date-fns/locale";
import ConfidenceBadge from './ConfidenceBadge';
import { useTranslation } from './translations.jsx';

export default function MeetingAlert({ 
  meeting, 
  isOpen, 
  onClose, 
  onSnooze,
  language = "en" 
}) {
  const [countdown, setCountdown] = useState(10);
  const locale = language === "es" ? es : enUS;

  const { t } = useTranslation(language);

  useEffect(() => {
    if (!isOpen) return;

    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          onClose();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      setCountdown(10);
    }
  }, [isOpen]);

  if (!meeting) return null;

  const meetingTime = new Date(`${meeting.date} ${meeting.time}`);
  const now = new Date();
  const minutesUntil = Math.ceil((meetingTime - now) / (1000 * 60));

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{
            background: "linear-gradient(135deg, rgba(139, 92, 246, 0.95) 0%, rgba(59, 130, 246, 0.95) 100%)",
            backdropFilter: "blur(20px)"
          }}
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            className="w-full max-w-md"
          >
            <Card className="glass-effect border-0 shadow-2xl">
              <CardContent className="p-8">
                <div className="text-center space-y-6">
                  <motion.div
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="w-20 h-20 mx-auto meeting-gradient rounded-full flex items-center justify-center shadow-lg"
                  >
                    <Brain className="w-10 h-10 text-white" />
                  </motion.div>

                  <div>
                    <h1 className="text-2xl font-bold text-gray-900 mb-2">
                      {t('meetingAlert.title')}
                    </h1>
                    <p className="text-gray-600">
                      {t('meetingAlert.subtitle')}
                    </p>
                  </div>

                  <div className="bg-white/50 rounded-xl p-4 space-y-3">
                    <h2 className="text-xl font-semibold text-gray-900">
                      {meeting.title}
                    </h2>
                    
                    <div className="flex items-center justify-center gap-2 text-lg">
                      <Clock className="w-5 h-5 text-gray-600" />
                      <span className="font-medium">
                        {minutesUntil <= 0 ? (
                          <span className="text-red-600 font-bold">{t('meetingAlert.now')}</span>
                        ) : (
                          <span>
                            {minutesUntil} {t('meetingAlert.inMinutes')}
                          </span>
                        )}
                      </span>
                    </div>

                    <div className="flex items-center justify-center gap-4">
                      <div className="text-center">
                        <p className="text-xs text-gray-500 mb-1">{t('meetingAlert.confidence')}</p>
                        <ConfidenceBadge confidence={meeting.confidence} size="sm" />
                      </div>
                    </div>
                  </div>

                  {meeting.preparation_tips && meeting.preparation_tips.length > 0 && (
                    <div className="bg-blue-50/80 rounded-xl p-4 text-left">
                      <h3 className="text-sm font-semibold text-blue-900 mb-2 flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4" />
                        {t('meetingAlert.preparation')}
                      </h3>
                      <ul className="space-y-1">
                        {meeting.preparation_tips.slice(0, 3).map((tip, index) => (
                          <li key={index} className="text-sm text-blue-800 flex items-start gap-2">
                            <span className="text-blue-400 mt-1">•</span>
                            <span>{tip}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="space-y-3">
                    <Button
                      onClick={onClose}
                      className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 text-lg shadow-lg"
                    >
                      <CheckCircle2 className="w-5 h-5 mr-2" />
                      {t('meetingAlert.understood')}
                    </Button>
                    
                    <Button
                      onClick={onSnooze}
                      variant="outline"
                      className="w-full border-white/30 text-gray-700 hover:bg-white/20 font-medium"
                    >
                      <AlarmClockOff className="w-4 h-4 mr-2" />
                      {t('meetingAlert.snooze')}
                    </Button>
                  </div>

                  <div className="text-xs text-gray-500">
                    {t('meetingAlert.autoClose')} {countdown}s
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}