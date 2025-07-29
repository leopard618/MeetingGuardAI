
import React, { useState, useEffect } from "react";
import { Meeting } from "@/api/entities";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Calendar as CalendarIcon, 
  ChevronLeft, 
  ChevronRight, 
  Plus,
  Clock,
  ArrowLeft,
  Filter,
  Eye
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, isToday, parseISO } from "date-fns";
import { es, enUS } from "date-fns/locale";
import ConfidenceBadge from "../components/ConfidenceBadge";
import SourceBadge from "../components/SourceBadge";
import MeetingDetailsModal from "../components/MeetingDetailsModal";

export default function Calendar({ language = "en" }) {
  const [meetings, setMeetings] = useState([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const locale = language === "es" ? es : enUS;

  const t = {
    en: {
      title: "Calendar",
      subtitle: "View all your meetings organized by date",
      backToDashboard: "Back to Dashboard",
      addMeeting: "Add Meeting",
      today: "Today",
      noMeetings: "No meetings",
      meeting: "meeting",
      meetings: "meetings",
      viewDetails: "View Details",
      time: "Time",
      duration: "Duration",
      minutes: "min",
      source: "Source",
      confidence: "Confidence",
      preparation: "Preparation Tips"
    },
    es: {
      title: "Calendario",
      subtitle: "Ve todas tus reuniones organizadas por fecha",
      backToDashboard: "Volver al Panel",
      addMeeting: "Agregar Reunión",
      today: "Hoy",
      noMeetings: "Sin reuniones",
      meeting: "reunión",
      meetings: "reuniones",
      viewDetails: "Ver Detalles",
      time: "Hora",
      duration: "Duración",
      minutes: "min",
      source: "Origen",
      confidence: "Confianza",
      preparation: "Consejos de Preparación"
    }
  };

  useEffect(() => {
    loadMeetings();
  }, []);

  const loadMeetings = async () => {
    setIsLoading(true);
    try {
      const allMeetings = await Meeting.list("-created_date");
      setMeetings(allMeetings);
    } catch (error) {
      console.error("Error loading meetings:", error);
    }
    setIsLoading(false);
  };

  const getMeetingsForDate = (date) => {
    const dateString = format(date, 'yyyy-MM-dd');
    return meetings.filter(meeting => meeting.date === dateString);
  };

  const navigateMonth = (direction) => {
    const newDate = new Date(currentDate);
    newDate.setMonth(currentDate.getMonth() + direction);
    setCurrentDate(newDate);
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const handleMeetingClick = (meeting) => {
    setSelectedMeeting(meeting);
    setShowDetailsModal(true);
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

  // Generate calendar days
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarDays = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Fill in days from previous month to start on Sunday
  const startDay = monthStart.getDay();
  const previousMonthDays = [];
  for (let i = 0; i < startDay; i++) {
    const day = new Date(monthStart);
    day.setDate(day.getDate() - (startDay - i));
    previousMonthDays.push(day);
  }

  // Fill in days from next month to end on Saturday
  const endDay = monthEnd.getDay();
  const nextMonthDays = [];
  for (let i = endDay + 1; i < 7; i++) {
    const day = new Date(monthEnd);
    day.setDate(day.getDate() + (i - endDay));
    nextMonthDays.push(day);
  }

  const allDays = [...previousMonthDays, ...calendarDays, ...nextMonthDays];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-4 md:space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to={createPageUrl("Dashboard")}>
              <Button variant="outline" size="icon" className="hover:bg-gray-50">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{t[language].title}</h1>
              <p className="text-gray-600 text-sm md:text-base">{t[language].subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={goToToday}
              variant="outline"
              className="hidden sm:flex text-sm"
              size="sm"
            >
              {t[language].today}
            </Button>
            <Link to={createPageUrl("AIChat")}>
              <Button className="meeting-gradient text-white shadow-lg text-sm md:text-base" size="sm">
                <Plus className="w-4 h-4 mr-1 md:mr-2" />
                <span className="hidden sm:inline">{t[language].addMeeting}</span>
                <span className="sm:hidden">+</span>
              </Button>
            </Link>
          </div>
        </div>

        {/* Calendar Navigation */}
        <div className="bg-white rounded-2xl p-4 md:p-6 shadow-lg border border-gray-200">
          <div className="flex items-center justify-between mb-4 md:mb-6">
            <Button
              onClick={() => navigateMonth(-1)}
              variant="outline"
              size="icon"
              className="hover:bg-gray-50 h-10 w-10"
            >
              <ChevronLeft className="w-5 h-5" />
            </Button>
            
            <h2 className="text-xl md:text-2xl font-bold text-gray-900">
              {format(currentDate, 'MMMM yyyy', { locale })}
            </h2>
            
            <Button
              onClick={() => navigateMonth(1)}
              variant="outline"
              size="icon"
              className="hover:bg-gray-50 h-10 w-10"
            >
              <ChevronRight className="w-5 h-5" />
            </Button>
          </div>

          {/* Calendar Grid - Optimized for Mobile */}
          <div className="grid grid-cols-7 gap-1 mb-4">
            {/* Day headers */}
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => (
              <div key={day} className="p-2 text-center text-xs md:text-sm font-bold text-gray-700 bg-gray-100 rounded-md">
                <span className="md:hidden">
                  {language === "es" ? ['D', 'L', 'M', 'X', 'J', 'V', 'S'][index] : day.charAt(0)}
                </span>
                <span className="hidden md:inline">
                  {language === "es" ? ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][index] : day}
                </span>
              </div>
            ))}
            
            {/* Calendar days */}
            {allDays.map((day, index) => {
              const dayMeetings = getMeetingsForDate(day);
              const isCurrentMonth = isSameMonth(day, currentDate);
              const isDayToday = isToday(day);
              
              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.005 }}
                  className={`min-h-[80px] md:min-h-[100px] p-1 md:p-2 border-2 rounded-lg transition-all ${
                    isCurrentMonth 
                      ? `bg-white hover:bg-blue-50 border-gray-200 ${isDayToday ? 'ring-2 ring-blue-500 bg-blue-50' : ''}` 
                      : 'bg-gray-100 text-gray-400 border-gray-100'
                  } cursor-pointer`}
                >
                  <div className={`text-sm md:text-base font-bold mb-1 text-center ${
                    isDayToday ? 'text-blue-700' : isCurrentMonth ? 'text-gray-900' : 'text-gray-400'
                  }`}>
                    {format(day, 'd')}
                  </div>
                  
                  <div className="space-y-1">
                    {dayMeetings.slice(0, 2).map((meeting) => (
                      <div
                        key={meeting.id}
                        onClick={() => handleMeetingClick(meeting)}
                        className="bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-md px-1 md:px-2 py-1 text-xs hover:from-purple-700 hover:to-blue-700 transition-all cursor-pointer shadow-sm"
                      >
                        <div className="font-bold truncate text-white">
                          {meeting.title}
                        </div>
                        <div className="text-blue-100 flex items-center gap-1 text-xs">
                          <Clock className="w-2 h-2 md:w-3 md:h-3" />
                          <span className="text-xs">
                            {formatTime(meeting.time)}
                          </span>
                        </div>
                      </div>
                    ))}
                    
                    {dayMeetings.length > 2 && (
                      <div className="text-xs text-center font-bold text-purple-600 bg-purple-100 rounded-md py-1">
                        +{dayMeetings.length - 2}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Today's Meetings Summary - Mobile Optimized */}
        <div className="bg-white rounded-2xl p-4 md:p-6 shadow-lg border border-gray-200">
          <h3 className="text-lg md:text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-blue-600" />
            {t[language].today} ({format(new Date(), 'MMMM d', { locale })})
          </h3>
          
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="animate-pulse bg-gray-200 h-16 md:h-20 rounded-lg"></div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {getMeetingsForDate(new Date()).length > 0 ? (
                getMeetingsForDate(new Date()).map((meeting) => (
                  <div
                    key={meeting.id}
                    onClick={() => handleMeetingClick(meeting)}
                    className="flex items-center justify-between p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border-2 border-blue-200 hover:shadow-lg transition-all cursor-pointer"
                  >
                    <div className="flex-1">
                      <h4 className="font-bold text-gray-900 text-sm md:text-base">{meeting.title}</h4>
                      <div className="flex items-center gap-4 text-sm text-gray-700 mt-1">
                        <div className="flex items-center gap-1 bg-white px-2 py-1 rounded-full">
                          <Clock className="w-4 h-4 text-blue-600" />
                          <span className="font-medium">{formatTime(meeting.time)}</span>
                        </div>
                        {meeting.duration && (
                          <span className="bg-gray-100 px-2 py-1 rounded-full text-xs font-medium">
                            {meeting.duration} {t[language].minutes}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <ConfidenceBadge confidence={meeting.confidence} size="sm" />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMeetingClick(meeting);
                        }}
                        className="text-blue-600 hover:bg-blue-100"
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <CalendarIcon className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                  <p className="text-lg font-medium">{t[language].noMeetings}</p>
                  <p className="text-sm mt-2">¡Prueba crear una con la IA!</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Meeting Details Modal */}
      <MeetingDetailsModal
        meeting={selectedMeeting}
        isOpen={showDetailsModal}
        onClose={() => setShowDetailsModal(false)}
        language={language}
      />
    </div>
  );
}
