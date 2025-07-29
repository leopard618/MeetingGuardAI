import React, { useState, useEffect } from "react";
import { Meeting } from "@/api/entities";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { 
  ArrowLeft, 
  Brain, 
  AlertTriangle, 
  CheckCircle, 
  Clock,
  Calendar,
  Edit,
  Save,
  X
} from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import ConfidenceBadge from "../components/ConfidenceBadge";
import SourceBadge from "../components/SourceBadge";

export default function AIInsights({ language = "es" }) {
  const [meetings, setMeetings] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingMeeting, setEditingMeeting] = useState(null);
  const [editForm, setEditForm] = useState({});

  const t = {
    en: {
      title: "AI Insights & Review",
      subtitle: "Review and improve meetings that need your attention",
      backToDashboard: "Back to Dashboard",
      noReviewNeeded: "All meetings look good!",
      noReviewSubtext: "Your AI assistant is working perfectly. No meetings need review.",
      whyReview: "Why Review?",
      lowConfidence: "Low AI confidence",
      missingDetails: "Missing key details",
      unclearTime: "Unclear time format",
      vagueDuration: "Vague duration",
      edit: "Edit",
      save: "Save Changes",
      cancel: "Cancel",
      confirm: "Confirm as Correct",
      title: "Title",
      date: "Date",
      time: "Time",
      duration: "Duration (minutes)",
      description: "Description",
      fixed: "Fixed",
      meetingUpdated: "Meeting updated successfully"
    },
    es: {
      title: "Información IA y Revisión",
      subtitle: "Revisa y mejora reuniones que necesitan tu atención",
      backToDashboard: "Volver al Panel",
      noReviewNeeded: "¡Todas las reuniones se ven bien!",
      noReviewSubtext: "Tu asistente de IA está funcionando perfectamente. No hay reuniones que revisar.",
      whyReview: "¿Por qué Revisar?",
      lowConfidence: "Baja confianza de la IA",
      missingDetails: "Faltan detalles clave",
      unclearTime: "Formato de hora poco claro",
      vagueDuration: "Duración vaga",
      edit: "Editar",
      save: "Guardar Cambios",
      cancel: "Cancelar",
      confirm: "Confirmar como Correcta",
      title: "Título",
      date: "Fecha",
      time: "Hora",
      duration: "Duración (minutos)",
      description: "Descripción",
      fixed: "Corregida",
      meetingUpdated: "Reunión actualizada exitosamente"
    }
  };

  useEffect(() => {
    loadMeetings();
  }, []);

  const loadMeetings = async () => {
    setIsLoading(true);
    try {
      const allMeetings = await Meeting.list("-created_date");
      // Filter meetings that need review
      const needsReview = allMeetings.filter(meeting => {
        return meeting.confidence < 80 || 
               !meeting.description || 
               !meeting.duration ||
               (meeting.source === 'ChatGPT' || meeting.source === 'WhatsApp');
      });
      setMeetings(needsReview);
    } catch (error) {
      console.error("Error loading meetings:", error);
    }
    setIsLoading(false);
  };

  const getReviewReasons = (meeting) => {
    const reasons = [];
    
    if (meeting.confidence < 80) {
      reasons.push(t[language].lowConfidence);
    }
    if (!meeting.description) {
      reasons.push(t[language].missingDetails);
    }
    if (!meeting.duration) {
      reasons.push(t[language].vagueDuration);
    }
    
    return reasons;
  };

  const startEditing = (meeting) => {
    setEditingMeeting(meeting.id);
    setEditForm({
      title: meeting.title || "",
      date: meeting.date || "",
      time: meeting.time || "",
      duration: meeting.duration || 60,
      description: meeting.description || ""
    });
  };

  const cancelEditing = () => {
    setEditingMeeting(null);
    setEditForm({});
  };

  const saveChanges = async (meetingId) => {
    try {
      await Meeting.update(meetingId, {
        ...editForm,
        confidence: 95 // Mark as reviewed and corrected
      });
      setEditingMeeting(null);
      setEditForm({});
      loadMeetings(); // Refresh the list
    } catch (error) {
      console.error("Error updating meeting:", error);
    }
  };

  const confirmAsCorrect = async (meetingId) => {
    try {
      await Meeting.update(meetingId, {
        confidence: 95 // Mark as confirmed
      });
      loadMeetings(); // Refresh the list
    } catch (error) {
      console.error("Error confirming meeting:", error);
    }
  };

  const formatTime = (timeString) => {
    try {
      const [hours, minutes] = timeString.split(':');
      const date = new Date();
      date.setHours(parseInt(hours), parseInt(minutes));
      return date.toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: language === 'en'
      });
    } catch (error) {
      return timeString;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to={createPageUrl("Dashboard")}>
              <Button variant="outline" size="icon" className="hover:bg-gray-50">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{t[language].title}</h1>
              <p className="text-gray-600">{t[language].subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Brain className="w-6 h-6 text-purple-600" />
            <Badge className="bg-purple-100 text-purple-800 px-3 py-1">
              {meetings.length} {language === 'es' ? 'para revisar' : 'to review'}
            </Badge>
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="grid gap-4">
            {[1, 2, 3].map(i => (
              <Card key={i} className="animate-pulse">
                <CardContent className="p-6">
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                  <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : meetings.length > 0 ? (
          <div className="grid gap-6">
            {meetings.map((meeting, index) => (
              <motion.div
                key={meeting.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <Card className="shadow-lg border-l-4 border-l-amber-500">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <CardTitle className="text-lg text-gray-900">
                            {meeting.title}
                          </CardTitle>
                          <ConfidenceBadge confidence={meeting.confidence} />
                          <SourceBadge source={meeting.source} />
                        </div>
                        
                        <div className="flex items-center gap-4 text-sm text-gray-600 mb-3">
                          <div className="flex items-center gap-1">
                            <Calendar className="w-4 h-4" />
                            <span>{meeting.date}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            <span>{formatTime(meeting.time)}</span>
                          </div>
                          {meeting.duration && (
                            <Badge variant="outline" className="text-xs">
                              {meeting.duration} min
                            </Badge>
                          )}
                        </div>

                        {/* Review Reasons */}
                        <div className="bg-amber-50 rounded-lg p-3 mb-4">
                          <h4 className="text-sm font-semibold text-amber-900 mb-2 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" />
                            {t[language].whyReview}
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {getReviewReasons(meeting).map((reason, idx) => (
                              <Badge key={idx} className="bg-amber-200 text-amber-800 text-xs">
                                {reason}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        {editingMeeting === meeting.id ? (
                          <>
                            <Button
                              onClick={() => saveChanges(meeting.id)}
                              size="sm"
                              className="bg-green-600 hover:bg-green-700"
                            >
                              <Save className="w-4 h-4 mr-2" />
                              {t[language].save}
                            </Button>
                            <Button
                              onClick={cancelEditing}
                              variant="outline"
                              size="sm"
                            >
                              <X className="w-4 h-4 mr-2" />
                              {t[language].cancel}
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              onClick={() => startEditing(meeting)}
                              variant="outline"
                              size="sm"
                            >
                              <Edit className="w-4 h-4 mr-2" />
                              {t[language].edit}
                            </Button>
                            <Button
                              onClick={() => confirmAsCorrect(meeting.id)}
                              size="sm"
                              className="bg-green-600 hover:bg-green-700"
                            >
                              <CheckCircle className="w-4 h-4 mr-2" />
                              {t[language].confirm}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  
                  <CardContent>
                    {editingMeeting === meeting.id ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            {t[language].title}
                          </label>
                          <Input
                            value={editForm.title}
                            onChange={(e) => setEditForm({...editForm, title: e.target.value})}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            {t[language].date}
                          </label>
                          <Input
                            type="date"
                            value={editForm.date}
                            onChange={(e) => setEditForm({...editForm, date: e.target.value})}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            {t[language].time}
                          </label>
                          <Input
                            type="time"
                            value={editForm.time}
                            onChange={(e) => setEditForm({...editForm, time: e.target.value})}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            {t[language].duration}
                          </label>
                          <Input
                            type="number"
                            value={editForm.duration}
                            onChange={(e) => setEditForm({...editForm, duration: parseInt(e.target.value)})}
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            {t[language].description}
                          </label>
                          <Textarea
                            value={editForm.description}
                            onChange={(e) => setEditForm({...editForm, description: e.target.value})}
                            rows={3}
                          />
                        </div>
                      </div>
                    ) : (
                      <div>
                        {meeting.description && (
                          <p className="text-gray-700 mb-4">{meeting.description}</p>
                        )}
                        
                        {meeting.preparation_tips && meeting.preparation_tips.length > 0 && (
                          <div className="bg-purple-50 rounded-lg p-3">
                            <h4 className="text-sm font-semibold text-purple-900 mb-2 flex items-center gap-2">
                              <Brain className="w-4 h-4" />
                              Consejos de Preparación IA
                            </h4>
                            <ul className="text-sm text-purple-800 space-y-1">
                              {meeting.preparation_tips.slice(0, 3).map((tip, idx) => (
                                <li key={idx} className="flex items-start gap-2">
                                  <span className="w-1 h-1 bg-purple-400 rounded-full mt-2 flex-shrink-0"></span>
                                  <span>{tip}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-12"
          >
            <div className="w-20 h-20 mx-auto mb-6 bg-green-100 rounded-full flex items-center justify-center">
              <CheckCircle className="w-10 h-10 text-green-600" />
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-2">
              {t[language].noReviewNeeded}
            </h3>
            <p className="text-gray-600 max-w-md mx-auto">
              {t[language].noReviewSubtext}
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
}