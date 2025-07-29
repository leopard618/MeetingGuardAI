import React, { useState, useEffect } from "react";
import { Meeting, UserPreferences, User } from "@/api/entities";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { 
  Calendar, 
  MessageCircle, 
  Brain, 
  AlertTriangle,
  Plus,
  PlusCircle,
  Clock,
  TrendingUp,
  Speaker,
  ToggleLeft,
  ToggleRight,
  Zap,
  Target,
  ChevronDown,
  StickyNote
} from "lucide-react";
import { motion } from "framer-motion";
import StatusCard from "../components/StatusCard";
import MeetingCard from "../components/MeetingCard";
import AlertSystem from "../components/AlertSystem";
import AlertScheduler from "../components/AlertScheduler";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useTranslation } from "@/components/translations";

export default function Dashboard({ language = "en" }) {
  const [meetings, setMeetings] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [alertMeeting, setAlertMeeting] = useState(null);
  const [showAlert, setShowAlert] = useState(false);
  const [alertType, setAlertType] = useState('15min');
  const [userPreferences, setUserPreferences] = useState(null);
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  
  const { t } = useTranslation(language);

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    setIsLoading(true);
    try {
      const user = await User.me();
      const [allMeetings, prefsList] = await Promise.all([
        Meeting.list("-created_date"),
        UserPreferences.filter({ created_by: user.email })
      ]);

      setMeetings(allMeetings);

      if (prefsList.length > 0) {
        setUserPreferences(prefsList[0]);
        setAlertsEnabled(prefsList[0].alert_enabled);
      } else {
        const newPrefs = await UserPreferences.create({
          created_by: user.email,
          language: language,
          alert_enabled: true,
        });
        setUserPreferences(newPrefs);
        setAlertsEnabled(newPrefs.alert_enabled);
      }
    } catch (error) {
      console.error("Error loading initial data:", error);
    }
    setIsLoading(false);
  };

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

  const getTodaysMeetings = () => {
    const today = new Date().toISOString().split('T')[0];
    return meetings.filter(meeting => meeting.date === today);
  };

  const getAiAssistedCount = () => {
    return meetings.filter(m => m.source === 'ChatGPT' || m.source === 'WhatsApp').length;
  };

  const getMeetingsNeedingReview = () => {
    return meetings.filter(m => m.confidence && m.confidence < 80).length;
  };

  const handleToggleAlerts = async () => {
    if (!userPreferences) return;
    const newStatus = !alertsEnabled;
    setAlertsEnabled(newStatus);
    try {
      await UserPreferences.update(userPreferences.id, { alert_enabled: newStatus });
      const updatedPrefs = await UserPreferences.get(userPreferences.id);
      setUserPreferences(updatedPrefs);
      setAlertsEnabled(updatedPrefs.alert_enabled);
    } catch (error) {
      console.error("Error toggling alerts:", error);
      setAlertsEnabled(!newStatus);
    }
  };

  const handleTriggerAlert = (meeting, type = '15min') => {
    setAlertMeeting(meeting);
    setAlertType(type);
    setShowAlert(true);
  };

  const handleGlobalTestAlert = () => {
    const testMeeting = {
      id: 'test-001',
      title: language === 'es' ? 'Reunión de Prueba' : 'Test Meeting',
      description: language === 'es' ? 'Esta es una prueba del sistema de alertas.' : 'This is a test of the alert system.',
      date: new Date().toISOString().split('T')[0],
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      duration: 30,
      source: 'Manual',
      confidence: 99,
      preparation_tips: language === 'es' ? ['Revisar la configuración de audio', 'Preparar un café'] : ['Check audio settings', 'Prepare coffee'],
      language: language
    };
    handleTriggerAlert(testMeeting, 'test');
  };

  const handleCloseAlert = () => {
    setShowAlert(false);
    setAlertMeeting(null);
  };

  const handleSnoozeAlert = (minutes) => {
    setShowAlert(false);
    setTimeout(() => {
      setShowAlert(true);
    }, minutes * 60 * 1000);
  };

  const handlePostponeAlert = (newDateTime) => {
    setShowAlert(false);
    loadMeetings();
  };

  const todaysMeetings = getTodaysMeetings();
  const aiAssistedCount = getAiAssistedCount();
  const reviewCount = getMeetingsNeedingReview();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-4"
        >
          <div className="space-y-2">
            <h1 className="text-4xl font-bold text-gray-900">
              {t('dashboard.title')}
            </h1>
            <p className="text-lg text-gray-600">
              {t('dashboard.subtitle')}
            </p>
          </div>
          
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="py-4 inline-flex"
          >
            <Link to={createPageUrl("ChooseCreationMethod")}>
              <Button className="h-16 px-8 text-xl meeting-gradient text-white shadow-2xl hover:shadow-3xl transition-all-smooth rounded-xl">
                <PlusCircle className="w-7 h-7 mr-3" />
                {t('dashboard.createNewMeeting')}
              </Button>
            </Link>
          </motion.div>
        </motion.div>

        {/* MÉTRICAS MEJORADAS */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-6">
          <Link to={createPageUrl("Calendar")} className="h-full">
            <StatusCard
              title={t('dashboard.meetingsToday')}
              value={todaysMeetings.length}
              icon={Calendar}
              delay={0}
              isLink={true}
            />
          </Link>
          <div className="h-full">
            <StatusCard
              title={t('dashboard.aiAssisted')}
              value={aiAssistedCount}
              icon={Zap}
              gradient="meeting-gradient"
              delay={1}
              subtitle={t('dashboard.aiAssistedSubtext')}
            />
          </div>
          <Link to={createPageUrl("Notes")} className="h-full">
            <StatusCard
              title={language === 'es' ? "Notas y Tareas" : "Notes & Tasks"}
              value="📝"
              icon={StickyNote}
              gradient="bg-orange-500"
              delay={2}
              subtitle={language === 'es' ? "Tu cerebro digital" : "Your digital brain"}
              isLink={true}
            />
          </Link>
          <div onClick={handleToggleAlerts} className="cursor-pointer h-full">
            <StatusCard
              title={t('dashboard.smartAlerts')}
              value={alertsEnabled ? (
                language === 'es' ? "ACTIVADO" : 
                language === 'fr' ? "ACTIVÉ" : 
                language === 'de' ? "AKTIV" : 
                language === 'pt' ? "ATIVO" : 
                language === 'zh' ? "已启用" :
                language === 'zh-TW' ? "已啟用" :
                "ON"
              ) : (
                language === 'es' ? "DESACTIVADO" : 
                language === 'fr' ? "DÉSACTIVÉ" : 
                language === 'de' ? "INAKTIV" : 
                language === 'pt' ? "INATIVO" : 
                language === 'zh' ? "已禁用" :
                language === 'zh-TW' ? "已停用" :
                "OFF"
              )}
              icon={alertsEnabled ? ToggleRight : ToggleLeft}
              gradient={alertsEnabled ? "whatsapp-gradient" : "bg-gray-400"}
              delay={3}
              subtitle={alertsEnabled ? 
                (language === 'es' ? "Imposibles de ignorar" : 
                 language === 'fr' ? "Impossible à ignorer" : 
                 language === 'de' ? "Unmöglich zu ignorieren" : 
                 language === 'pt' ? "Impossível de ignorar" : 
                 language === 'zh' ? "不可能错过" :
                 language === 'zh-TW' ? "不可能錯過" :
                 "Impossible to miss") : 
                (language === 'es' ? "Actualmente deshabilitado" : 
                 language === 'fr' ? "Actuellement désactivé" : 
                 language === 'de' ? "Derzeit deaktiviert" : 
                 language === 'pt' ? "Atualmente desabilitado" : 
                 language === 'zh' ? "当前已禁用" :
                 language === 'zh-TW' ? "目前已停用" :
                 "Currently disabled")}
            />
          </div>
          <Link to={createPageUrl("AIInsights")} className="h-full">
            <StatusCard
              title={t('dashboard.aiInsights')}
              value={reviewCount > 0 ? reviewCount : '✓'}
              icon={Target}
              gradient={reviewCount > 0 ? "bg-amber-500" : "bg-green-500"}
              delay={4}
              subtitle={reviewCount > 0 ? t('dashboard.needsReview') : t('dashboard.allGood')}
              isLink={true}
            />
          </Link>
        </div>

        {/* ALERTA DE PRUEBA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="bg-white/80 backdrop-blur-2xl rounded-2xl p-6 shadow-lg border border-gray-100"
        >
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-red-500 text-white rounded-xl flex items-center justify-center shadow-lg">
                <Speaker className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {t('dashboard.testGlobalAlert')}
                </h3>
                <p className="text-gray-600 text-sm">{t('dashboard.testAlertSubtitle')}</p>
              </div>
            </div>
            <Button
              onClick={handleGlobalTestAlert}
              variant="outline"
              className="border-red-200 text-red-600 hover:bg-red-50"
            >
              <AlertTriangle className="w-4 h-4 mr-2" />
              {language === 'es' ? 'Probar' : 
               language === 'fr' ? 'Tester' : 
               language === 'de' ? 'Testen' : 
               language === 'pt' ? 'Testar' : 
               language === 'zh' ? '测试' :
               language === 'zh-TW' ? '測試' :
               'Test'}
            </Button>
          </div>
        </motion.div>

        {/* REUNIONES DE HOY */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="space-y-6"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-900">{t('dashboard.todaysMeetings')}</h2>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Clock className="w-4 h-4" />
              <span>Real-time updates</span>
            </div>
          </div>

          {isLoading ? (
            <div className="grid gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="glass-effect rounded-2xl p-6 animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                  <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                </div>
              ))}
            </div>
          ) : todaysMeetings.length > 0 ? (
            <div className="grid gap-4">
              {todaysMeetings.map((meeting, index) => (
                <MeetingCard
                  key={meeting.id}
                  meeting={meeting}
                  language={language}
                  onAlert={handleTriggerAlert}
                  delay={index}
                />
              ))}
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="glass-effect rounded-2xl p-12 text-center"
            >
              <div className="w-20 h-20 mx-auto mb-6 bg-gray-100 rounded-full flex items-center justify-center">
                <Calendar className="w-10 h-10 text-gray-400" />
              </div>
              <h3 className="text-xl font-medium text-gray-900 mb-2">
                {t('dashboard.noMeetings')}
              </h3>
              <p className="text-gray-600 mb-6">
                {t('dashboard.noMeetingsSubtext')}
              </p>
              <Link to={createPageUrl("ChooseCreationMethod")}>
                <Button className="meeting-gradient text-white shadow-lg hover:shadow-xl transition-all-smooth">
                  <Plus className="w-5 h-5 mr-2" />
                  {t('dashboard.createNewMeeting')}
                </Button>
              </Link>
            </motion.div>
          )}
        </motion.div>
      </div>

      <AlertSystem
        meeting={alertMeeting}
        isOpen={showAlert}
        onClose={handleCloseAlert}
        onSnooze={handleSnoozeAlert}
        onPostpone={handlePostponeAlert}
        language={language}
        alertType={alertType}
      />

      <AlertScheduler
        onTriggerAlert={handleTriggerAlert}
        language={language}
        alertsEnabled={alertsEnabled}
      />
    </div>
  );
}