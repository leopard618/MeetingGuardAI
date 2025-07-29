
import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { User, UserPreferences } from "@/api/entities";
import { Save, User as UserIcon, Mail, MessageCircle, Globe, Bell, Volume2, Power, PowerOff } from "lucide-react";
import { motion } from "framer-motion";
// import { googleAuthInitiate } from "@/api/functions";
import { getAvailableLanguages } from "@/components/translations";

export default function Settings({ language = "en" }) {
  const [user, setUser] = useState(null);
  const [preferences, setPreferences] = useState({
    language: "en",
    timezone: "America/New_York",
    alert_enabled: true,
    alert_intensity: "max",
    alert_sound_type: "voice_and_sound",
    alert_volume: 0.5,
    vibration_enabled: true,
    organizer_email: "",
    organizer_whatsapp: "",
    google_calendar_sync_enabled: false,
    google_user_email: ""
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const availableLanguages = getAvailableLanguages();

  const t = {
    en: {
      title: "Settings",
      subtitle: "Configure your MeetingGuard AI preferences",
      profile: "Profile Information",
      communication: "Communication Settings",
      alerts: "Alert Settings",
      integrations: "Integrations",
      language: "Language",
      timezone: "Timezone",
      alertsEnabled: "Enable Alerts",
      alertIntensity: "Alert Intensity",
      alertSound: "Alert Sound Type",
      alertVolume: "Alert Volume",
      vibration: "Enable Vibration",
      organizerEmail: "Your Email (for sending invitations)",
      organizerWhatsApp: "Your WhatsApp Number (optional)",
      whatsappPlaceholder: "+1234567890",
      save: "Save Settings",
      saving: "Saving...",
      saved: "Settings saved successfully!",
      googleCalendar: "Google Calendar",
      connectedAs: "Connected as {email}",
      notConnected: "Not connected",
      connect: "Connect",
      disconnect: "Disconnect",
      googleError: "Error connecting to Google.",
      googleDisconnected: "Google Calendar disconnected.",
      errorDisconnecting: "Error disconnecting.",
      // New integrations
      microsoftCalendar: "Microsoft Calendar",  
      appleCalendar: "Apple Calendar",
      zoom: "Zoom",
      microsoftTeams: "Microsoft Teams",
      slack: "Slack",
      notion: "Notion",
      trello: "Trello",
      asana: "Asana",
      zapier: "Zapier",
      webhooks: "Webhooks",
      syncMeetings: "Sync meetings automatically",
      generateLinks: "Generate meeting links automatically",
      sendNotifications: "Send notifications to channels",
      syncTasks: "Sync meeting tasks and notes",
      createCards: "Create cards from meetings",
      createTasks: "Create tasks from meetings",
      automate: "Automate workflows",
      customIntegrations: "Custom integrations via webhooks",
      comingSoon: "Coming Soon",
      configureWebhook: "Configure Webhook URL"
    },
    es: {
      title: "Ajustes",
      subtitle: "Configura tus preferencias de MeetingGuard AI",
      profile: "Información del Perfil",
      communication: "Configuración de Comunicación",
      alerts: "Configuración de Alertas",
      integrations: "Integraciones",
      language: "Idioma",
      timezone: "Zona Horaria",
      alertsEnabled: "Activar Alertas",
      alertIntensity: "Intensidad de Alertas",
      alertSound: "Tipo de Sonido de Alerta",
      alertVolume: "Volumen de Alerta",
      vibration: "Activar Vibración",
      organizerEmail: "Tu Email (para enviar invitaciones)",
      organizerWhatsApp: "Tu Número de WhatsApp (opcional)",
      whatsappPlaceholder: "+523456789012",
      save: "Guardar Configuración",
      saving: "Guardando...",
      saved: "¡Configuración guardada exitosamente!",
      googleCalendar: "Google Calendar",
      connectedAs: "Conectado como {email}",
      notConnected: "No conectado",
      connect: "Conectar",
      disconnect: "Desconectar",
      googleError: "Error al conectar con Google.",
      googleDisconnected: "Google Calendar desconectado.",
      errorDisconnecting: "Error al desconectar.",
      // New integrations
      microsoftCalendar: "Microsoft Calendar",
      appleCalendar: "Apple Calendar", 
      zoom: "Zoom",
      microsoftTeams: "Microsoft Teams",
      slack: "Slack",
      notion: "Notion",
      trello: "Trello",
      asana: "Asana",
      zapier: "Zapier",
      webhooks: "Webhooks",
      syncMeetings: "Sincronizar reuniones automáticamente",
      generateLinks: "Generar enlaces de reunión automáticamente",
      sendNotifications: "Enviar notificaciones a canales",
      syncTasks: "Sincronizar tareas y notas de reuniones",
      createCards: "Crear tarjetas desde reuniones",
      createTasks: "Crear tareas desde reuniones",
      automate: "Automatizar flujos de trabajo",
      customIntegrations: "Integraciones personalizadas vía webhooks",
      comingSoon: "Próximamente",
      configureWebhook: "Configurar URL de Webhook"
    }
  };

  useEffect(() => {
    loadUserAndPreferences();
  }, []);

  const loadUserAndPreferences = async () => {
    try {
      const currentUser = await User.me();
      setUser(currentUser);
      
      const prefsList = await UserPreferences.filter({ created_by: currentUser.email });
      if (prefsList.length > 0) {
        const userPrefs = prefsList[0];
        setPreferences({
          language: userPrefs.language || "en",
          timezone: userPrefs.timezone || "America/New_York",
          alert_enabled: userPrefs.alert_enabled !== false,
          alert_intensity: userPrefs.alert_intensity || "max",
          alert_sound_type: userPrefs.alert_sound_type || "voice_and_sound",
          alert_volume: userPrefs.alert_volume || 0.5,
          vibration_enabled: userPrefs.vibration_enabled !== false,
          organizer_email: userPrefs.organizer_email || currentUser.email || "",
          organizer_whatsapp: userPrefs.organizer_whatsapp || "",
          google_calendar_sync_enabled: userPrefs.google_calendar_sync_enabled || false,
          google_user_email: userPrefs.google_user_email || ""
        });
      } else {
        // Set default email from user and default Google sync state
        setPreferences(prev => ({
          ...prev,
          organizer_email: currentUser.email || "",
          google_calendar_sync_enabled: false,
          google_user_email: ""
        }));
      }
    } catch (error) {
      console.error("Error loading user preferences:", error);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const prefsList = await UserPreferences.filter({ created_by: user.email });
      
      if (prefsList.length > 0) {
        await UserPreferences.update(prefsList[0].id, preferences);
      } else {
        await UserPreferences.create({
          ...preferences,
          created_by: user.email
        });
      }
      
      setSaveMessage(t[language].saved);
      setTimeout(() => setSaveMessage(""), 3000);
    } catch (error) {
      console.error("Error saving preferences:", error);
      setSaveMessage("Error saving settings");
      setTimeout(() => setSaveMessage(""), 3000);
    }
    setIsSaving(false);
  };

  const handlePreferenceChange = (key, value) => {
    setPreferences(prev => ({ ...prev, [key]: value }));
  };

  const handleConnectGoogle = async () => {
    setIsSaving(true);
    try {
      // const { data } = await googleAuthInitiate();
      const data = {
        success: true,
        authorizationUrl: "https://www.google.com"
      };
      if (data.success && data.authorizationUrl) {
        const popup = window.open(data.authorizationUrl, 'googleAuth', 'width=600,height=700');
        
        const checkPopup = setInterval(() => {
          if (!popup || popup.closed || popup.closed === undefined) {
            clearInterval(checkPopup);
            loadUserAndPreferences(); // Reload preferences to get the updated Google status
          }
        }, 1000);
      } else {
        console.error("Failed to get authorization URL", data.error);
        setSaveMessage(t[language].googleError);
        setTimeout(() => setSaveMessage(""), 3000);
      }
    } catch (error) {
      console.error("Error connecting to Google:", error);
      setSaveMessage(t[language].googleError);
      setTimeout(() => setSaveMessage(""), 3000);
    }
    setIsSaving(false);
  };

  const handleDisconnectGoogle = async () => {
    setIsSaving(true);
    try {
      const prefsList = await UserPreferences.filter({ created_by: user.email });
      if (prefsList.length > 0) {
        await UserPreferences.update(prefsList[0].id, {
          ...preferences, // Keep existing preferences
          google_calendar_sync_enabled: false,
          google_access_token: null, // Clear tokens
          google_refresh_token: null,
          google_user_email: null, // Clear user email
          google_token_expiry: null,
        });
        await loadUserAndPreferences(); // Reload preferences to reflect disconnection
        setSaveMessage(t[language].googleDisconnected);
        setTimeout(() => setSaveMessage(""), 3000);
      }
    } catch (error) {
      console.error("Error disconnecting Google Calendar:", error);
      setSaveMessage(t[language].errorDisconnecting);
      setTimeout(() => setSaveMessage(""), 3000);
    }
    setIsSaving(false);
  };

  const integrations = [
    {
      id: "google_calendar",
      name: t[language].googleCalendar,
      description: t[language].syncMeetings,
      icon: "https://upload.wikimedia.org/wikipedia/commons/a/a5/Google_Calendar_icon_%282020%29.svg",
      connected: preferences.google_calendar_sync_enabled,
      userEmail: preferences.google_user_email,
      isActive: true,
      connectHandler: handleConnectGoogle,
      disconnectHandler: handleDisconnectGoogle
    },
    {
      id: "microsoft_calendar",
      name: t[language].microsoftCalendar,
      description: t[language].syncMeetings,
      icon: "https://upload.wikimedia.org/wikipedia/commons/d/df/Microsoft_Office_Outlook_%282018%E2%80%93present%29.svg",
      connected: false,
      isActive: false,
      comingSoon: true
    },
    {
      id: "apple_calendar", 
      name: t[language].appleCalendar,
      description: t[language].syncMeetings,
      icon: "https://upload.wikimedia.org/wikipedia/commons/3/3b/Calendar_Icon.svg",
      connected: false,
      isActive: false,
      comingSoon: true
    },
    {
      id: "zoom",
      name: t[language].zoom,
      description: t[language].generateLinks,
      icon: "https://upload.wikimedia.org/wikipedia/commons/7/7b/Zoom_Communications_Logo.svg",
      connected: false,
      isActive: false,
      comingSoon: true
    },
    {
      id: "microsoft_teams",
      name: t[language].microsoftTeams,
      description: t[language].generateLinks,
      icon: "https://upload.wikimedia.org/wikipedia/commons/c/c9/Microsoft_Office_Teams_%282018%E2%80%93present%29.svg",
      connected: false,
      isActive: false,
      comingSoon: true
    },
    {
      id: "slack",
      name: t[language].slack,
      description: t[language].sendNotifications,
      icon: "https://upload.wikimedia.org/wikipedia/commons/d/d5/Slack_icon_2019.svg",
      connected: false,
      isActive: false,
      comingSoon: true
    },
    {
      id: "notion",
      name: t[language].notion,
      description: t[language].syncTasks,
      icon: "https://upload.wikimedia.org/wikipedia/commons/4/45/Notion_app_logo.png",
      connected: false,
      isActive: false,
      comingSoon: true
    },
    {
      id: "trello",
      name: t[language].trello,
      description: t[language].createCards,
      icon: "https://upload.wikimedia.org/wikipedia/en/8/8c/Trello_logo.svg",
      connected: false,
      isActive: false,
      comingSoon: true
    },
    {
      id: "asana",
      name: t[language].asana,
      description: t[language].createTasks,
      icon: "https://upload.wikimedia.org/wikipedia/commons/3/3b/Asana_logo.svg",
      connected: false,
      isActive: false,
      comingSoon: true
    },
    {
      id: "zapier",
      name: t[language].zapier,
      description: t[language].automate,
      icon: "https://upload.wikimedia.org/wikipedia/commons/c/cb/Zapier_logo.svg",
      connected: false,
      isActive: false,
      comingSoon: true
    },
    {
      id: "webhooks",
      name: t[language].webhooks,
      description: t[language].customIntegrations,
      icon: "https://cdn-icons-png.flaticon.com/512/2621/2621341.png", // A generic webhook/API icon
      connected: false,
      isActive: false,
      comingSoon: true
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h1 className="text-3xl font-bold text-gray-900">{t[language].title}</h1>
          <p className="text-lg text-gray-600">{t[language].subtitle}</p>
        </motion.div>

        {saveMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg"
          >
            {saveMessage}
          </motion.div>
        )}

        {/* Profile Information */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserIcon className="w-5 h-5" />
              {t[language].profile}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>{t[language].language}</Label>
              <Select 
                value={preferences.language} 
                onValueChange={(value) => handlePreferenceChange("language", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableLanguages.map(lang => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.flag} {lang.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label>{t[language].timezone}</Label>
              <Select 
                value={preferences.timezone} 
                onValueChange={(value) => handlePreferenceChange("timezone", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="America/New_York">EST - New York</SelectItem>
                  <SelectItem value="America/Chicago">CST - Chicago</SelectItem>
                  <SelectItem value="America/Denver">MST - Denver</SelectItem>
                  <SelectItem value="America/Los_Angeles">PST - Los Angeles</SelectItem>
                  <SelectItem value="America/Mexico_City">CST - Ciudad de México</SelectItem>
                  <SelectItem value="Europe/Madrid">CET - Madrid</SelectItem>
                  <SelectItem value="Europe/London">GMT - London</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Communication Settings */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5" />
              {t[language].communication}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="organizer-email">{t[language].organizerEmail}</Label>
              <Input
                id="organizer-email"
                type="email"
                value={preferences.organizer_email}
                onChange={(e) => handlePreferenceChange("organizer_email", e.target.value)}
                placeholder="tu@email.com"
              />
              <p className="text-sm text-gray-500 mt-1">
                Este email se usará como remitente al enviar invitaciones a reuniones
              </p>
            </div>
            
            <div>
              <Label htmlFor="organizer-whatsapp">{t[language].organizerWhatsApp}</Label>
              <Input
                id="organizer-whatsapp"
                type="tel"
                value={preferences.organizer_whatsapp}
                onChange={(e) => handlePreferenceChange("organizer_whatsapp", e.target.value)}
                placeholder={t[language].whatsappPlaceholder}
              />
              <p className="text-sm text-gray-500 mt-1">
                Número de WhatsApp para enviar invitaciones (incluye código de país)
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Alert Settings */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5" />
              {t[language].alerts}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="alerts-enabled">{t[language].alertsEnabled}</Label>
              <Switch
                id="alerts-enabled"
                checked={preferences.alert_enabled}
                onCheckedChange={(checked) => handlePreferenceChange("alert_enabled", checked)}
              />
            </div>
            
            {preferences.alert_enabled && (
              <>
                <div>
                  <Label>{t[language].alertIntensity}</Label>
                  <Select 
                    value={preferences.alert_intensity} 
                    onValueChange={(value) => handlePreferenceChange("alert_intensity", value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">🔕 Ligera - Solo notificación visual</SelectItem>
                      <SelectItem value="medium">🔔 Media - Sonido suave + vibración</SelectItem>
                      <SelectItem value="max">🚨 Máxima - Imposible de ignorar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <Label>{t[language].alertSound}</Label>
                  <Select 
                    value={preferences.alert_sound_type} 
                    onValueChange={(value) => handlePreferenceChange("alert_sound_type", value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="voice_and_sound">🎙️ Voz + Sonido</SelectItem>
                      <SelectItem value="voice_only">🗣️ Solo Voz</SelectItem>
                      <SelectItem value="sound_only">🔊 Solo Sonido</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <Label>{t[language].alertVolume}: {Math.round(preferences.alert_volume * 100)}%</Label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={preferences.alert_volume}
                    onChange={(e) => handlePreferenceChange("alert_volume", parseFloat(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <Label htmlFor="vibration-enabled">{t[language].vibration}</Label>
                  <Switch
                    id="vibration-enabled"
                    checked={preferences.vibration_enabled}
                    onCheckedChange={(checked) => handlePreferenceChange("vibration_enabled", checked)}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Integrations Settings - UPDATED */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Power className="w-5 h-5 text-gray-700" />
              {t[language].integrations}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4">
              {integrations.map((integration) => (
                <div key={integration.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-4">
                    <img 
                      src={integration.icon} 
                      alt={integration.name} 
                      className="w-8 h-8"
                      onError={(e) => {
                        e.target.src = "https://cdn-icons-png.flaticon.com/512/3068/3068543.png"; // Fallback icon (a plug/integration icon)
                      }}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-800">{integration.name}</h3>
                        {integration.comingSoon && (
                          <span className="px-2 py-1 bg-amber-100 text-amber-800 text-xs rounded-full font-medium">
                            {t[language].comingSoon}
                          </span>
                        )}
                      </div>
                      {integration.connected && integration.userEmail ? (
                        <p className="text-sm text-green-600 font-medium">
                          {t[language].connectedAs.replace('{email}', integration.userEmail)}
                        </p>
                      ) : integration.connected ? (
                        <p className="text-sm text-green-600 font-medium">
                          {language === 'es' ? 'Conectado' : 'Connected'}
                        </p>
                      ) : (
                        <p className="text-sm text-gray-500">{integration.description}</p>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {integration.isActive ? (
                      integration.connected ? (
                        <Button 
                          variant="destructive" 
                          size="sm"
                          onClick={integration.disconnectHandler} 
                          disabled={isSaving}
                        >
                          <PowerOff className="w-4 h-4 mr-2" />
                          {t[language].disconnect}
                        </Button>
                      ) : (
                        <Button 
                          onClick={integration.connectHandler} 
                          disabled={isSaving} 
                          size="sm"
                          className="bg-blue-600 hover:bg-blue-700 text-white"
                        >
                          <Power className="w-4 h-4 mr-2" />
                          {t[language].connect}
                        </Button>
                      )
                    ) : (
                      <Button 
                        disabled 
                        size="sm"
                        variant="outline"
                        className="opacity-50 cursor-not-allowed"
                      >
                        <Power className="w-4 h-4 mr-2" />
                        {t[language].connect}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Button 
          onClick={handleSave} 
          disabled={isSaving}
          className="w-full meeting-gradient text-white font-semibold py-3 shadow-lg"
        >
          <Save className="w-5 h-5 mr-2" />
          {isSaving ? t[language].saving : t[language].save}
        </Button>
      </div>
    </div>
  );
}
