import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  X,
  Bell,
  MessageCircle,
  Mail,
  Smartphone,
  Save,
  Volume2,
  Vibrate,
  AlertTriangle
} from "lucide-react";
import { motion } from "framer-motion";

export default function ReminderSettingsModal({ 
  isOpen, 
  onClose, 
  onSave, 
  note, 
  language = "en" 
}) {
  const [reminders, setReminders] = useState({
    internal: {
      enabled: false,
      intensity: "medium",
      minutes_before: 15
    },
    external: []
  });

  const translations = {
    en: {
      title: "Reminder Settings",
      subtitle: "Configure how and when you want to be reminded",
      internalReminders: "Internal Reminders",
      internalDesc: "App notifications with customizable intensity",
      enableInternal: "Enable internal reminders",
      intensity: "Reminder Intensity",
      light: "Light (Simple notification)",
      medium: "Medium (Banner + sound)",
      max: "Max (Full screen + audio + vibration)",
      minutesBefore: "Minutes before due time",
      externalReminders: "External Reminders",
      externalDesc: "Send reminders through external channels",
      whatsapp: "WhatsApp",
      email: "Email",
      sms: "SMS",
      addExternal: "Add External Reminder",
      channel: "Channel",
      enabled: "Enabled",
      remove: "Remove",
      save: "Save Settings",
      cancel: "Cancel"
    },
    es: {
      title: "Configuración de Recordatorios",
      subtitle: "Configura cómo y cuándo quieres ser recordado",
      internalReminders: "Recordatorios Internos",
      internalDesc: "Notificaciones de la app con intensidad personalizable",
      enableInternal: "Habilitar recordatorios internos",
      intensity: "Intensidad del Recordatorio",
      light: "Ligero (Notificación simple)",
      medium: "Medio (Banner + sonido)",
      max: "Máximo (Pantalla completa + audio + vibración)",
      minutesBefore: "Minutos antes del vencimiento",
      externalReminders: "Recordatorios Externos",
      externalDesc: "Enviar recordatorios por canales externos",
      whatsapp: "WhatsApp",
      email: "Correo",
      sms: "SMS",
      addExternal: "Agregar Recordatorio Externo",
      channel: "Canal",
      enabled: "Habilitado",
      remove: "Eliminar",
      save: "Guardar Configuración",
      cancel: "Cancelar"
    }
  };

  const tr = translations[language] || translations.en;

  useEffect(() => {
    if (note && note.reminders) {
      setReminders(note.reminders);
    } else {
      setReminders({
        internal: {
          enabled: false,
          intensity: "medium",
          minutes_before: 15
        },
        external: []
      });
    }
  }, [note, isOpen]);

  const handleInternalChange = (field, value) => {
    setReminders(prev => ({
      ...prev,
      internal: {
        ...prev.internal,
        [field]: value
      }
    }));
  };

  const handleAddExternalReminder = () => {
    setReminders(prev => ({
      ...prev,
      external: [
        ...prev.external,
        {
          channel: "whatsapp",
          minutes_before: 30,
          enabled: true
        }
      ]
    }));
  };

  const handleExternalChange = (index, field, value) => {
    setReminders(prev => ({
      ...prev,
      external: prev.external.map((reminder, i) => 
        i === index ? { ...reminder, [field]: value } : reminder
      )
    }));
  };

  const handleRemoveExternal = (index) => {
    setReminders(prev => ({
      ...prev,
      external: prev.external.filter((_, i) => i !== index)
    }));
  };

  const handleSave = () => {
    onSave(reminders);
  };

  const getChannelIcon = (channel) => {
    switch (channel) {
      case 'whatsapp':
        return MessageCircle;
      case 'email':
        return Mail;
      case 'sms':
        return Smartphone;
      default:
        return Bell;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 rounded-t-xl">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{tr.title}</h2>
              <p className="text-sm text-gray-600">{tr.subtitle}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Internal Reminders */}
          <Card className="border border-gray-200">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-blue-600" />
                <div>
                  <CardTitle className="text-lg">{tr.internalReminders}</CardTitle>
                  <p className="text-sm text-gray-600 mt-1">{tr.internalDesc}</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="internal-enabled" className="text-sm font-medium">
                  {tr.enableInternal}
                </Label>
                <Switch
                  id="internal-enabled"
                  checked={reminders.internal.enabled}
                  onCheckedChange={(checked) => handleInternalChange('enabled', checked)}
                />
              </div>

              {reminders.internal.enabled && (
                <>
                  <div>
                    <Label className="text-sm font-medium text-gray-700">{tr.intensity}</Label>
                    <Select 
                      value={reminders.internal.intensity} 
                      onValueChange={(value) => handleInternalChange('intensity', value)}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="light">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 bg-blue-300 rounded-full"></div>
                            {tr.light}
                          </div>
                        </SelectItem>
                        <SelectItem value="medium">
                          <div className="flex items-center gap-2">
                            <Volume2 className="w-4 h-4 text-orange-500" />
                            {tr.medium}
                          </div>
                        </SelectItem>
                        <SelectItem value="max">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-red-500" />
                            {tr.max}
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-sm font-medium text-gray-700">{tr.minutesBefore}</Label>
                    <Input
                      type="number"
                      value={reminders.internal.minutes_before}
                      onChange={(e) => handleInternalChange('minutes_before', parseInt(e.target.value) || 15)}
                      min="1"
                      max="1440"
                      className="mt-1"
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* External Reminders */}
          <Card className="border border-gray-200">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageCircle className="w-5 h-5 text-green-600" />
                  <div>
                    <CardTitle className="text-lg">{tr.externalReminders}</CardTitle>
                    <p className="text-sm text-gray-600 mt-1">{tr.externalDesc}</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAddExternalReminder}
                >
                  {tr.addExternal}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {reminders.external.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">
                  No external reminders configured
                </p>
              ) : (
                <div className="space-y-4">
                  {reminders.external.map((reminder, index) => {
                    const ChannelIcon = getChannelIcon(reminder.channel);
                    return (
                      <div key={index} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-2 flex-1">
                          <ChannelIcon className="w-4 h-4 text-gray-600" />
                          <Select
                            value={reminder.channel}
                            onValueChange={(value) => handleExternalChange(index, 'channel', value)}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="whatsapp">
                                <div className="flex items-center gap-2">
                                  <MessageCircle className="w-4 h-4" />
                                  {tr.whatsapp}
                                </div>
                              </SelectItem>
                              <SelectItem value="email">
                                <div className="flex items-center gap-2">
                                  <Mail className="w-4 h-4" />
                                  {tr.email}
                                </div>
                              </SelectItem>
                              <SelectItem value="sms">
                                <div className="flex items-center gap-2">
                                  <Smartphone className="w-4 h-4" />
                                  {tr.sms}
                                </div>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <Input
                            type="number"
                            value={reminder.minutes_before}
                            onChange={(e) => handleExternalChange(index, 'minutes_before', parseInt(e.target.value) || 30)}
                            min="1"
                            max="1440"
                            className="w-20"
                          />
                          <span className="text-sm text-gray-600">min</span>
                        </div>
                        <Switch
                          checked={reminder.enabled}
                          onCheckedChange={(checked) => handleExternalChange(index, 'enabled', checked)}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveExternal(index)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 rounded-b-xl">
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={onClose}>
              {tr.cancel}
            </Button>
            <Button 
              onClick={handleSave}
              className="meeting-gradient text-white"
            >
              <Save className="w-4 h-4 mr-2" />
              {tr.save}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}