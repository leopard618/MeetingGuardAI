import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Settings2, 
  Volume2, 
  Smartphone, 
  MessageSquare,
  AlertTriangle,
  X,
  Save
} from "lucide-react-native";
import { AlertIntensity, defaultAlertConfig } from '@/utils/notificationUtils';

export default function AlertCustomizer({ 
  isOpen, 
  onClose, 
  onSave, 
  currentConfig = defaultAlertConfig,
  language = "en"
}) {
  const [config, setConfig] = useState(currentConfig);

  useEffect(() => {
    setConfig(currentConfig);
  }, [currentConfig]);

  const t = {
    en: {
      title: "Alert Settings",
      subtitle: "Customize your notification preferences",
      intensity: "Alert Intensity",
      intensityDescription: "Choose how prominent your alerts should be",
      soundEnabled: "Sound Alerts",
      soundDescription: "Play audio notifications",
      vibrationEnabled: "Vibration",
      vibrationDescription: "Vibrate device on alerts",
      speechEnabled: "Voice Announcements",
      speechDescription: "Announce meeting details with voice",
      autoCloseEnabled: "Auto-close Alerts",
      autoCloseDescription: "Automatically close alerts after countdown",
      defaultSnoozeMinutes: "Default Snooze Time",
      defaultSnoozeDescription: "Default snooze duration in minutes",
      save: "Save Settings",
      cancel: "Cancel",
      maximum: "Maximum - Full screen takeover",
      medium: "Medium - Persistent banner",
      light: "Light - Toast notification"
    },
    es: {
      title: "Configuración de Alertas",
      subtitle: "Personaliza tus preferencias de notificación",
      intensity: "Intensidad de Alerta",
      intensityDescription: "Elige qué tan prominentes deben ser tus alertas",
      soundEnabled: "Alertas de Sonido",
      soundDescription: "Reproducir notificaciones de audio",
      vibrationEnabled: "Vibración",
      vibrationDescription: "Vibrar dispositivo en alertas",
      speechEnabled: "Anuncios de Voz",
      speechDescription: "Anunciar detalles de reunión con voz",
      autoCloseEnabled: "Cerrar Alertas Automáticamente",
      autoCloseDescription: "Cerrar alertas automáticamente después del conteo",
      defaultSnoozeMinutes: "Tiempo de Posposición Predeterminado",
      defaultSnoozeDescription: "Duración predeterminada de posposición en minutos",
      save: "Guardar Configuración",
      cancel: "Cancelar",
      maximum: "Máximo - Toma de pantalla completa",
      medium: "Medio - Banner persistente",
      light: "Ligero - Notificación toast"
    }
  };

  const handleSave = () => {
    onSave && onSave(config);
  };

  const handleCancel = () => {
    setConfig(currentConfig); // Reset to original
    onClose && onClose();
  };

  const updateConfig = (key, value) => {
    setConfig(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const intensityOptions = [
    { value: AlertIntensity.MAXIMUM, label: t[language].maximum },
    { value: AlertIntensity.MEDIUM, label: t[language].medium },
    { value: AlertIntensity.LIGHT, label: t[language].light }
  ];

  const snoozeOptions = [5, 10, 15, 30, 60];

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="alert-customizer-overlay">
          <style>{`
            .alert-customizer-overlay {
              position: fixed !important;
              top: 0; left: 0; right: 0; bottom: 0;
              z-index: 10002;
              background: rgba(0,0,0,0.8);
              backdrop-filter: blur(10px);
              display: flex;
              justify-content: center;
              align-items: center;
              user-select: none;
              overflow: hidden;
            }
            
            .alert-customizer-modal {
              background: white;
              border-radius: 16px;
              max-width: 500px;
              width: 90%;
              max-height: 90vh;
              overflow-y: auto;
              box-shadow: 0 25px 50px rgba(0,0,0,0.25);
            }

            .setting-item {
              display: flex;
              align-items: center;
              justify-content: space-between;
              padding: 16px 0;
              border-bottom: 1px solid #f3f4f6;
            }

            .setting-item:last-child {
              border-bottom: none;
            }

            .setting-info {
              flex: 1;
              margin-right: 16px;
            }

            .intensity-preview {
              padding: 8px 12px;
              border-radius: 6px;
              font-size: 12px;
              font-weight: 500;
              margin-top: 4px;
            }

            .intensity-maximum {
              background: #FEE2E2;
              color: #991B1B;
              border: 1px solid #FCA5A5;
            }

            .intensity-medium {
              background: #FEF3C7;
              color: #92400E;
              border: 1px solid #FCD34D;
            }

            .intensity-light {
              background: #D1FAE5;
              color: #065F46;
              border: 1px solid #6EE7B7;
            }
          `}</style>

          <motion.div
            className="alert-customizer-modal"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            {/* Header */}
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Settings2 className="w-6 h-6 text-blue-600" />
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">
                      {t[language].title}
                    </h2>
                    <p className="text-sm text-gray-600">
                      {t[language].subtitle}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCancel}
                  className="p-2"
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Alert Intensity */}
              <div className="setting-item">
                <div className="setting-info">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="w-4 h-4 text-orange-500" />
                    <Label className="text-sm font-medium">
                      {t[language].intensity}
                    </Label>
                  </div>
                  <p className="text-xs text-gray-600">
                    {t[language].intensityDescription}
                  </p>
                  <div className={`intensity-preview intensity-${config.intensity}`}>
                    {intensityOptions.find(opt => opt.value === config.intensity)?.label}
                  </div>
                </div>
                <Select
                  value={config.intensity}
                  onValueChange={(value) => updateConfig('intensity', value)}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {intensityOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Sound Alerts */}
              <div className="setting-item">
                <div className="setting-info">
                  <div className="flex items-center gap-2 mb-1">
                    <Volume2 className="w-4 h-4 text-blue-500" />
                    <Label className="text-sm font-medium">
                      {t[language].soundEnabled}
                    </Label>
                  </div>
                  <p className="text-xs text-gray-600">
                    {t[language].soundDescription}
                  </p>
                </div>
                <Switch
                  checked={config.soundEnabled}
                  onCheckedChange={(checked) => updateConfig('soundEnabled', checked)}
                />
              </div>

              {/* Vibration */}
              <div className="setting-item">
                <div className="setting-info">
                  <div className="flex items-center gap-2 mb-1">
                    <Smartphone className="w-4 h-4 text-purple-500" />
                    <Label className="text-sm font-medium">
                      {t[language].vibrationEnabled}
                    </Label>
                  </div>
                  <p className="text-xs text-gray-600">
                    {t[language].vibrationDescription}
                  </p>
                </div>
                <Switch
                  checked={config.vibrationEnabled}
                  onCheckedChange={(checked) => updateConfig('vibrationEnabled', checked)}
                />
              </div>

              {/* Voice Announcements */}
              <div className="setting-item">
                <div className="setting-info">
                  <div className="flex items-center gap-2 mb-1">
                    <MessageSquare className="w-4 h-4 text-green-500" />
                    <Label className="text-sm font-medium">
                      {t[language].speechEnabled}
                    </Label>
                  </div>
                  <p className="text-xs text-gray-600">
                    {t[language].speechDescription}
                  </p>
                </div>
                <Switch
                  checked={config.speechEnabled}
                  onCheckedChange={(checked) => updateConfig('speechEnabled', checked)}
                />
              </div>

              {/* Auto-close Alerts */}
              <div className="setting-item">
                <div className="setting-info">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                    <Label className="text-sm font-medium">
                      {t[language].autoCloseEnabled}
                    </Label>
                  </div>
                  <p className="text-xs text-gray-600">
                    {t[language].autoCloseDescription}
                  </p>
                </div>
                <Switch
                  checked={config.autoCloseEnabled}
                  onCheckedChange={(checked) => updateConfig('autoCloseEnabled', checked)}
                />
              </div>

              {/* Default Snooze Time */}
              <div className="setting-item">
                <div className="setting-info">
                  <Label className="text-sm font-medium">
                    {t[language].defaultSnoozeMinutes}
                  </Label>
                  <p className="text-xs text-gray-600">
                    {t[language].defaultSnoozeDescription}
                  </p>
                </div>
                <Select
                  value={config.defaultSnoozeMinutes?.toString()}
                  onValueChange={(value) => updateConfig('defaultSnoozeMinutes', parseInt(value))}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {snoozeOptions.map((minutes) => (
                      <SelectItem key={minutes} value={minutes.toString()}>
                        {minutes}m
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-gray-200 flex gap-3">
              <Button
                variant="outline"
                onClick={handleCancel}
                className="flex-1"
              >
                {t[language].cancel}
              </Button>
              <Button
                onClick={handleSave}
                className="flex-1 bg-blue-600 hover:bg-blue-700"
              >
                <Save className="w-4 h-4 mr-2" />
                {t[language].save}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
