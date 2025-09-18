
import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from './ui/card.jsx';
import { Button } from './ui/button.jsx';
import { Badge } from './ui/badge.jsx';
import { 
  Clock, 
  Calendar, 
  Download, 
  AlertTriangle,
  Brain,
  MessageCircle,
  Users,
  MapPin,
  Video,
  Mail,
  Paperclip,
  Share2,
  ExternalLink
} from "lucide-react-native";
import { motion } from "framer-motion";
import { format, parseISO } from "date-fns";
import { es, enUS } from "date-fns/locale";
import ConfidenceBadge from "./ConfidenceBadge";
import SourceBadge from "./SourceBadge";
import { sendMeetingInvitation } from '../api/functions';
import { safeStringify } from '../utils/index.ts';
import { useTranslation } from './translations.jsx';

export default function MeetingCard({ 
  meeting, 
  language = "en", 
  delay = 0,
  onAlert 
}) {
  const { t } = useTranslation(language);
  const [isSharing, setIsSharing] = useState(false);
  const [showCopyNotification, setShowCopyNotification] = useState(false);
  const locale = language === "es" ? es : enUS;

  const formatDate = (dateString) => {
    try {
      const date = parseISO(dateString);
      return format(date, language === "es" ? "dd 'de' MMMM" : "MMMM dd", { locale });
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
    const startDate = new Date(`${meeting.date}T${meeting.time}`);
    const endDate = new Date(startDate.getTime() + (meeting.duration || 60) * 60000);
    
    const formatDateForICS = (date) => {
      return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    };

    let description = meeting.description || '';
    
    // Add participants to description
    if (meeting.participants && meeting.participants.length > 0) {
      description += '\\n\\nParticipants:\\n';
      meeting.participants.forEach(p => {
        description += `- ${p.name}${p.email ? ` (${p.email})` : ''}\\n`;
      });
    }

    // Add location to description
    if (meeting.location) {
      description += `\\n\\nLocation: `;
      if (meeting.location.type === 'virtual' && meeting.location.virtual_link) {
        description += `Virtual Meeting - ${safeStringify(meeting.location.virtual_link)}`;
      } else if (meeting.location.address) {
        description += safeStringify(meeting.location.address);
      }
    }

    // Add preparation tips
    if (meeting.preparation_tips) {
      description += '\\n\\nPreparation Tips:\\n' + meeting.preparation_tips.join('\\n');
    }

    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//MeetingGuard AI//Meeting//EN',
      'BEGIN:VEVENT',
      `DTSTART:${formatDateForICS(startDate)}`,
      `DTEND:${formatDateForICS(endDate)}`,
      `SUMMARY:${meeting.title}`,
      `DESCRIPTION:${description}`,
      meeting.location?.address ? `LOCATION:${safeStringify(meeting.location.address)}` : '',
      `UID:${meeting.id}@meetingguard.ai`,
      'END:VEVENT',
      'END:VCALENDAR'
    ].filter(Boolean).join('\r\n');

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${meeting.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleTestAlert = () => {
    if (onAlert) {
      onAlert(meeting, 'test');
    }
  };

  const handleShareEmail = async () => {
    setIsSharing(true);
    try {
      await sendMeetingInvitation({
        meetingId: meeting.id,
        method: 'email',
        recipients: meeting.participants?.filter(p => p.email).map(p => p.email) || []
      });
    } catch (error) {
      console.error('Error sending email invitations:', error);
    }
    setIsSharing(false);
  };

  const handleShareWhatsApp = () => {
    const meetingText = `🗓️ *${meeting.title}*%0A%0A📅 ${formatDate(meeting.date)} a las ${formatTime(meeting.time)}%0A⏱️ Duración: ${meeting.duration} minutos%0A%0A${meeting.description ? `📝 ${meeting.description}%0A%0A` : ''}${meeting.location?.virtual_link ? `🔗 Enlace: ${safeStringify(meeting.location.virtual_link)}%0A%0A` : ''}${meeting.location?.address ? `📍 Ubicación: ${safeStringify(meeting.location.address)}%0A%0A` : ''}Creado con MeetingGuard AI 🤖`;
    
    window.open(`https://wa.me/?text=${meetingText}`, '_blank');
  };

  const handleCopyLink = async () => {
    try {
      const meetingLink = `${window.location.origin}/meeting/${meeting.id}`;
      await navigator.clipboard.writeText(meetingLink);
      setShowCopyNotification(true);
      setTimeout(() => setShowCopyNotification(false), 2000);
    } catch (error) {
      console.error('Error copying link:', error);
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = `${window.location.origin}/meeting/${meeting.id}`;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setShowCopyNotification(true);
      setTimeout(() => setShowCopyNotification(false), 2000);
    }
  };

  const openLocation = () => {
    if (meeting.location?.coordinates) {
      const { lat, lng } = meeting.location.coordinates;
      window.open(`https://maps.google.com/?q=${lat},${lng}`, '_blank');
    } else if (meeting.location?.address) {
      window.open(`https://maps.google.com/?q=${encodeURIComponent(safeStringify(meeting.location.address))}`, '_blank');
    }
  };

  const openVirtualMeeting = () => {
    if (meeting.location?.virtual_link) {
      window.open(safeStringify(meeting.location.virtual_link), '_blank');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: delay * 0.1 }}
    >
      {showCopyNotification && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg z-50"
        >
          {t('meetingCard.linkCopied')}
        </motion.div>
      )}
      
      <Card className="glass-effect border-0 shadow-lg hover:shadow-xl transition-all-smooth">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle className="text-lg text-gray-900 mb-2">
                {meeting.title}
              </CardTitle>
              <div className="flex items-center gap-4 text-sm text-gray-600 mb-3">
                <div className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  <span>{formatDate(meeting.date)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  <span>{formatTime(meeting.time)}</span>
                </div>
                {meeting.duration && (
                  <Badge variant="outline" className="text-xs">
                    {meeting.duration} {t('meetingCard.minutes')}
                  </Badge>
                )}
              </div>
              
              {/* Participants */}
              {meeting.participants && meeting.participants.length > 0 && (
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-4 h-4 text-blue-600" />
                  <span className="text-sm text-gray-700">
                    {meeting.participants.length} {t('meetingCard.participants')}
                  </span>
                  <div className="flex -space-x-1">
                    {meeting.participants.slice(0, 3).map((participant, idx) => (
                      <div
                        key={idx}
                        className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold border-2 border-white"
                        title={participant.name}
                      >
                        {participant.name.charAt(0).toUpperCase()}
                      </div>
                    ))}
                    {meeting.participants.length > 3 && (
                      <div className="w-6 h-6 bg-gray-400 rounded-full flex items-center justify-center text-white text-xs font-bold border-2 border-white">
                        +{meeting.participants.length - 3}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Location - MEJORADO CON GOOGLE MAPS Y MEET */}
              {meeting.location && (
                <div className="flex items-start gap-2 mb-2">
                  {meeting.location && typeof meeting.location === 'object' && meeting.location.type === 'virtual' ? (
                    <Video className="w-4 h-4 text-green-600 mt-1" />
                  ) : meeting.location && typeof meeting.location === 'object' && meeting.location.type === 'hybrid' ? (
                    <div className="flex gap-1 mt-1">
                      <MapPin className="w-4 h-4 text-red-600" />
                      <Video className="w-4 h-4 text-green-600" />
                    </div>
                  ) : (
                    <MapPin className="w-4 h-4 text-red-600 mt-1" />
                  )}
                  <div className="flex flex-col">
                    <span className="text-sm text-gray-700">
                      {meeting.location && typeof meeting.location === 'object' && meeting.location.type === 'virtual' 
                        ? `${t('meetingCard.virtualMeeting')} (${meeting.location.virtual_provider || t('meetingCard.online')})`
                        : meeting.location && typeof meeting.location === 'object' && meeting.location.type === 'hybrid'
                        ? `${t('meetingCard.hybridMeeting')} (${meeting.location.virtual_provider || t('meetingCard.online')})`
                        : t('meetingCard.physicalLocation')
                      }
                      {meeting.location && typeof meeting.location === 'object' && meeting.location.type !== 'virtual' && meeting.location.address && (
                        <span className="text-xs text-gray-500 block">📍 {safeStringify(meeting.location.address)}</span>
                      )}
                    </span>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {/* Botón para unirse a reunión virtual */}
                      {(meeting.location && typeof meeting.location === 'object' && (meeting.location.type === 'virtual' || meeting.location.type === 'hybrid')) && meeting.location.virtual_link && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs text-green-600 hover:bg-green-50"
                          onClick={openVirtualMeeting}
                        >
                          <ExternalLink className="w-3 h-3 mr-1" />
                          {meeting.location.virtual_provider
                            ? t('meetingCard.joinMeetingProvider').replace('{provider}', meeting.location.virtual_provider)
                            : t('meetingCard.joinMeetingGeneric')
                          }
                        </Button>
                      )}
                      {/* Botón para ver en Google Maps */}
                      {(meeting.location && typeof meeting.location === 'object' && (meeting.location.type === 'physical' || meeting.location.type === 'hybrid')) && meeting.location.address && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs text-blue-600 hover:bg-blue-50"
                          onClick={openLocation}
                        >
                          <MapPin className="w-3 h-3 mr-1" />
                          {t('meetingCard.viewOnGoogleMaps')}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Attachments */}
              {meeting.attachments && meeting.attachments.length > 0 && (
                <div className="flex items-center gap-2 mb-2">
                  <Paperclip className="w-4 h-4 text-purple-600" />
                  <span className="text-sm text-gray-700">
                    {meeting.attachments.length} {t('meetingCard.attachments')}
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <ConfidenceBadge confidence={meeting.confidence} />
              <SourceBadge source={meeting.source} />
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="pt-0">
          {meeting.description && (
            <p className="text-gray-700 mb-4 text-sm leading-relaxed">
              {meeting.description}
            </p>
          )}
          
          {meeting.preparation_tips && meeting.preparation_tips.length > 0 && (
            <div className="bg-purple-50 rounded-lg p-3 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Brain className="w-4 h-4 text-purple-600" />
                <span className="text-sm font-medium text-purple-800">
                  {t('meetingCard.preparationTips')}
                </span>
              </div>
              <ul className="text-sm text-purple-700 space-y-1">
                {meeting.preparation_tips.slice(0, 3).map((tip, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <span className="w-1 h-1 bg-purple-400 rounded-full mt-2 flex-shrink-0"></span>
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Button
              onClick={exportToCalendar}
              variant="outline"
              size="sm"
              className="text-xs"
            >
              <Download className="w-3 h-3 mr-1" />
              {t('meetingCard.export')}
            </Button>
            <Button
              onClick={handleTestAlert}
              variant="outline"
              size="sm"
              className="text-xs border-orange-200 text-orange-600 hover:bg-orange-50"
            >
              <AlertTriangle className="w-3 h-3 mr-1" />
              {t('meetingCard.testAlert')}
            </Button>
            <Button
              onClick={handleShareEmail}
              variant="outline"
              size="sm"
              className="text-xs border-blue-200 text-blue-600 hover:bg-blue-50"
              disabled={isSharing || !meeting.participants?.some(p => p.email)}
            >
              <Mail className="w-3 h-3 mr-1" />
              {t('meetingCard.shareEmail')}
            </Button>
            <Button
              onClick={handleShareWhatsApp}
              variant="outline"
              size="sm"
              className="text-xs border-green-200 text-green-600 hover:bg-green-50"
            >
              <MessageCircle className="w-3 h-3 mr-1" />
              {t('meetingCard.shareWhatsApp')}
            </Button>
            <Button
              onClick={handleCopyLink}
              variant="outline"
              size="sm"
              className="text-xs border-purple-200 text-purple-600 hover:bg-purple-50"
            >
              <Share2 className="w-3 h-3 mr-1" />
              {t('meetingCard.copyLink')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
