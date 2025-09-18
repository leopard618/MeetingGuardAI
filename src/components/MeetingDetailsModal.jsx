import React from 'react';
import { motion, AnimatePresence } from "framer-motion";
import { Button } from './ui\button';
import { Card, CardContent, CardHeader, CardTitle } from './ui\card';
import { Badge } from './ui\badge';
import { 
  X, 
  Calendar, 
  Clock, 
  User, 
  Brain, 
  Download,
  AlertTriangle
} from "lucide-react-native";
import { format, parseISO } from "date-fns";
import { es, enUS } from "date-fns/locale";
import ConfidenceBadge from './ConfidenceBadge';
import SourceBadge from './SourceBadge';
import { useTranslation } from './translations.jsx';

export default function MeetingDetailsModal({ 
  meeting, 
  isOpen, 
  onClose, 
  language = "en" 
}) {
  const locale = language === "es" ? es : enUS;

  const { t } = useTranslation(language);

  const formatDate = (dateString) => {
    try {
      const date = parseISO(dateString);
      return format(date, language === "es" ? "dd 'de' MMMM 'de' yyyy" : "MMMM dd, yyyy", { locale });
    } catch (error) {
      return dateString;
    }
  };

  const formatTime = (timeString) => {
    try {
      const [hours, minutes] = timeString.split(':');
      const date = new Date();
      date.setHours(parseInt(hours), parseInt(minutes));
      return format(date, language === "es" ? "HH:mm" : "h:mm a", { locale });
    } catch (error) {
      return timeString;
    }
  };

  const exportToCalendar = () => {
    if (!meeting) return;
    
    const startDate = new Date(`${meeting.date}T${meeting.time}`);
    const endDate = new Date(startDate.getTime() + (meeting.duration || 60) * 60000);
    
    const formatDateForICS = (date) => {
      return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    };

    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//MeetingGuard AI//Meeting//EN',
      'BEGIN:VEVENT',
      `DTSTART:${formatDateForICS(startDate)}`,
      `DTEND:${formatDateForICS(endDate)}`,
      `SUMMARY:${meeting.title}`,
      `DESCRIPTION:${meeting.description || ''}${meeting.preparation_tips ? '\\n\\nPreparation Tips:\\n' + meeting.preparation_tips.join('\\n') : ''}`,
      `UID:${meeting.id}@meetingguard.ai`,
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${meeting.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!meeting) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <Card className="bg-white shadow-2xl">
              <CardHeader className="border-b border-gray-100">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-2xl text-gray-900 mb-2">
                      {meeting.title}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <ConfidenceBadge confidence={meeting.confidence} />
                      <SourceBadge source={meeting.source} />
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onClose}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-5 h-5" />
                  </Button>
                </div>
              </CardHeader>
              
              <CardContent className="p-6 space-y-6">
                {/* Description */}
                {meeting.description && (
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                      {t('meetingDetailsModal.description')}
                    </h3>
                    <p className="text-gray-700 leading-relaxed">
                      {meeting.description}
                    </p>
                  </div>
                )}

                {/* Meeting Details */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <Calendar className="w-5 h-5 text-gray-500" />
                      <div>
                        <p className="text-sm font-medium text-gray-500">{t('meetingDetailsModal.date')}</p>
                        <p className="text-gray-900">{formatDate(meeting.date)}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <Clock className="w-5 h-5 text-gray-500" />
                      <div>
                        <p className="text-sm font-medium text-gray-500">{t('meetingDetailsModal.time')}</p>
                        <p className="text-gray-900">{formatTime(meeting.time)}</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    {meeting.duration && (
                      <div className="flex items-center gap-3">
                        <Clock className="w-5 h-5 text-gray-500" />
                        <div>
                          <p className="text-sm font-medium text-gray-500">{t('meetingDetailsModal.duration')}</p>
                          <p className="text-gray-900">{meeting.duration} {t('meetingDetailsModal.minutes')}</p>
                        </div>
                      </div>
                    )}
                    
                    <div className="flex items-center gap-3">
                      <Brain className="w-5 h-5 text-gray-500" />
                      <div>
                        <p className="text-sm font-medium text-gray-500">{t('meetingDetailsModal.confidence')}</p>
                        <ConfidenceBadge confidence={meeting.confidence} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Preparation Tips */}
                {meeting.preparation_tips && meeting.preparation_tips.length > 0 && (
                  <div className="bg-purple-50 rounded-lg p-4">
                    <h3 className="text-lg font-semibold text-purple-900 mb-3 flex items-center gap-2">
                      <Brain className="w-5 h-5" />
                      {t('meetingDetailsModal.preparation')}
                    </h3>
                    <ul className="space-y-2">
                      {meeting.preparation_tips.map((tip, index) => (
                        <li key={index} className="text-purple-800 flex items-start gap-2">
                          <span className="w-2 h-2 bg-purple-400 rounded-full mt-2 flex-shrink-0"></span>
                          <span>{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-3 pt-4 border-t border-gray-100">
                  <Button
                    onClick={exportToCalendar}
                    variant="outline"
                    className="flex-1"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    {t('meetingDetailsModal.exportCalendar')}
                  </Button>
                  <Button
                    onClick={() => {
                      // Trigger alert test functionality here
                      console.log('Test alert for meeting:', meeting.title);
                    }}
                    variant="outline"
                    className="flex-1 border-orange-200 text-orange-600 hover:bg-orange-50"
                  >
                    <AlertTriangle className="w-4 h-4 mr-2" />
                    {t('meetingDetailsModal.testAlert')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}