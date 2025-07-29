
import React, { useState, useEffect, useRef } from "react";
import { Meeting, Note } from "@/api/entities"; // Added Note import
import { InvokeLLM } from "@/api/integrations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, Send, User, Loader2, Calendar, ArrowLeft, AlertTriangle, CheckCircle, Clock, ListTodo } from "lucide-react"; // Added ListTodo import
import { motion, AnimatePresence } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import ConfidenceBadge from "../components/ConfidenceBadge";

const ConfirmationModal = ({ action, onConfirm, onCancel, language }) => {
  if (!action) return null;

  const t = {
    en: {
      title: "AI Action Confirmation",
      createTitle: "Proposal: Create Meeting",
      confirm: "Confirm",
      cancel: "Cancel",
      details: "Details"
    },
    es: {
      title: "Confirmación de Acción IA",
      createTitle: "Propuesta: Crear Reunión",
      confirm: "Confirmar",
      cancel: "Cancelar",
      details: "Detalles"
    }
  };

  const { meetingData } = action;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="my-4"
    >
      <Card className="border-amber-400 border-2 bg-amber-50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-amber-900">{t[language].createTitle}</h3>
              <p className="text-amber-800 text-sm mb-3">La IA propone crear la siguiente reunión. Por favor, revisa y confirma.</p>
              
              <div className="p-3 bg-white rounded-lg border border-gray-200 space-y-2">
                 <p><strong>Título:</strong> {meetingData.title}</p>
                 <p><strong>Fecha:</strong> {meetingData.date}</p>
                 <p><strong>Hora:</strong> {meetingData.time}</p>
                 {meetingData.custom_alert_times && <p><strong>Recordatorios:</strong> {meetingData.custom_alert_times.join(', ')} minutos antes</p>}
                 {meetingData.conference_provider && <p><strong>Videoconferencia:</strong> {meetingData.conference_provider}</p>}
              </div>

              <div className="flex gap-3 mt-4">
                <Button onClick={onConfirm} className="bg-green-600 hover:bg-green-700">
                  <CheckCircle className="w-4 h-4 mr-2" />
                  {t[language].confirm}
                </Button>
                <Button onClick={onCancel} variant="ghost">
                  {t[language].cancel}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};

export default function AIChat({ language = "en" }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const messagesEndRef = useRef(null);
  const navigate = useNavigate();
  const [proposedAction, setProposedAction] = useState(null);

  const t = {
    en: {
      title: "AI Chat Assistant",
      subtitle: "Your true meeting assistant. Create, modify, or ask anything.",
      placeholder: "e.g., 'Schedule call with John, add a Zoom link, and remind me 10 min before'",
      send: "Send",
      aiTyping: "AI is thinking...",
      backToDashboard: "Back to Dashboard",
      confidence: "Confidence",
      meetingCreated: "Meeting Created! I've added it to your schedule.",
      processing: "Processing your request...",
      errorProcessing: "Error processing request",
    },
    es: {
      title: "Asistente Chat IA",
      subtitle: "Tu verdadero asistente. Crea, modifica o pregunta lo que sea.",
      placeholder: "ej. 'Agenda llamada con Juan, añade enlace Zoom y recuérdame 10 min antes'",
      send: "Enviar",
      aiTyping: "IA está pensando...",
      backToDashboard: "Volver al Panel",
      confidence: "Confianza",
      meetingCreated: "¡Reunión Creada! La he añadido a tu calendario.",
      processing: "Procesando tu solicitud...",
      errorProcessing: "Error al procesar la solicitud",
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, proposedAction]);

  useEffect(() => {
    const welcomeMessage = {
      id: 1,
      type: "ai",
      content: language === "es"
        ? "¡Hola! Soy tu asistente avanzado. Pídeme que agende una reunión, que la modifique, o que te recuerde algo. ¿Cómo te ayudo hoy?"
        : "Hello! I'm your advanced assistant. Ask me to schedule a meeting, modify it, or set a reminder. How can I help you today?",
      timestamp: new Date().toISOString()
    };
    setMessages([welcomeMessage]);
  }, [language]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSend = async () => {
    if (!input.trim() || isProcessing) return;

    const userMessage = {
      id: Date.now(),
      type: "user",
      content: input,
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage]);
    const currentInput = input;
    setInput("");
    setIsProcessing(true);
    setProposedAction(null);

    const typingMessage = { id: 'typing', type: 'ai', isTyping: true, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, typingMessage]);
    scrollToBottom();

    try {
      const meetingSchema = Meeting.schema();
      delete meetingSchema.properties.alert_status;
      // Added custom_alert_times explicitly to meetingSchema for LLM to adhere
      meetingSchema.properties.custom_alert_times = { type: "array", items: { type: "number" }, description: "Array of alert times in minutes before the meeting, e.g., [15, 5] for 15 and 5 minutes before." };
      // Añadir Google Meet como opción
      meetingSchema.properties.conference_provider = { 
        type: "string", 
        enum: ["Zoom", "Teams", "Google Meet"], 
        description: "If the user asks for a conference link, specify the provider. Google Meet is now available." 
      };
      
      const noteSchema = Note.schema(); // Get Note schema

      const llmPrompt = `
        You are MeetingGuard AI, an expert personal assistant with advanced natural language processing capabilities.
        
        CONTEXT:
        - Today is ${new Date().toISOString().split('T')[0]}
        - Current time is ${new Date().toLocaleTimeString()}
        - User language: ${language === 'es' ? 'Spanish' : 'English'}
        
        USER REQUEST: "${currentInput}"
        
        ANALYSIS INSTRUCTIONS:
        1. **INTENT DETECTION**: First, determine the user's primary intent. Is it related to a 'MEETING', a 'NOTE', or a 'TASK'?
        2. **INFORMATION EXTRACTION**: Based on the intent, extract all relevant details.

        **IF INTENT IS 'MEETING'**:
        - Parse meeting details: title, date, time, duration, participants, and location.
        - For PHYSICAL locations: extract addresses that can be used with Google Maps.
        - For VIRTUAL meetings: detect platform preferences (Zoom, Teams, Google Meet).
        - For HYBRID meetings: extract both physical address AND virtual platform.
        - Generate relevant preparation tips.
        - Calculate confidence score based on completeness of information.
        - **OUTPUT**: A single JSON object conforming to this schema: ${JSON.stringify(meetingSchema)}

        **IF INTENT IS 'NOTE' or 'TASK'**:
        - Extract title and content.
        - For tasks: identify checklist items, due dates, priority level.
        - Detect if it's a simple note (free-form text) or actionable task.
        - Set appropriate priority based on urgency indicators in the text.
        - **OUTPUT**: A single JSON object conforming to this schema: ${JSON.stringify(noteSchema)}
        
        **ENHANCED CAPABILITIES:**
        - Understand location contexts: "reunión en la oficina" → physical location
        - Recognize platform preferences: "zoom call", "teams meeting", "google meet" → virtual with specific provider
        - Detect hybrid scenarios: "reunión presencial con opción virtual" → hybrid type
        - Parse complex time expressions: "mañana a las 3", "próximo lunes", "en 2 horas"
        
        **RESPONSE RULES (CRITICAL):**
        - Your response MUST be a single, raw JSON object. NO MARKDOWN, NO EXPLANATIONS.
        - Match exactly ONE of the schemas above based on detected intent.
        - All text fields must be in ${language === 'es' ? 'Spanish' : 'English'}.
        - If information is incomplete, respond with: {"error": "${language === 'es' ? 'Información incompleta. Por favor proporciona más detalles.' : 'Incomplete information. Please provide more details.'}"}
      `;

      const aiResult = await InvokeLLM({
        prompt: llmPrompt
      });

      if (aiResult.error) {
        throw new Error(aiResult.error);
      }
      
      setMessages(prev => prev.filter(m => m.id !== 'typing'));
      
      // Detectar si es una nota/tarea o reunión
      if (aiResult.content !== undefined || aiResult.due_date !== undefined || aiResult.status !== undefined) { 
         // Es una Nota/Tarea
         const createdNote = await Note.create({ 
           ...aiResult, 
           source: 'ChatGPT', 
           language: language 
         });
         const aiResponse = { 
           id: Date.now(), 
           type: "ai", 
           content: language === 'es' ? 
             "¡Perfecto! He creado la nota/tarea que pediste. Puedes verla en la sección de Notas & Tasks." :
             "Perfect! I've created the note/task you requested. You can view it in the Notes & Tasks section.",
           timestamp: new Date().toISOString(), 
           noteData: createdNote 
         };
         setMessages(prev => [...prev, aiResponse]);
      } else if (aiResult.title !== undefined && aiResult.date !== undefined && aiResult.time !== undefined) {
        // Es una Reunión
        setProposedAction({
          type: 'CREATE',
          meetingData: aiResult
        });
      } else {
        throw new Error("AI returned unrecognizable data structure.");
      }

    } catch (error) {
      console.error("Error processing request with AI:", error);
      const errorMessage = { 
        id: Date.now() + 1, 
        type: "ai", 
        content: language === 'es' ? 
          "No pude entender completamente tu solicitud. ¿Podrías ser más específico? Por ejemplo: 'Reunión con Juan mañana 3pm por Zoom' o 'Crear tarea: llamar proveedor'." :
          "I couldn't fully understand your request. Could you be more specific? For example: 'Meeting with John tomorrow 3pm via Zoom' or 'Create task: call supplier'.",
        timestamp: new Date().toISOString(), 
        isError: true 
      };
      setMessages(prev => [...prev.filter(m => m.id !== 'typing'), errorMessage]);
    }

    setIsProcessing(false);
  };
  
  const handleConfirmAction = async () => {
    if (!proposedAction) return;
    
    setIsProcessing(true);
    
    if (proposedAction.type === 'CREATE') {
      const { meetingData } = proposedAction;
      
      // Here you would add logic to generate Zoom/Teams links if `conference_provider` is set.
      // For now, we'll just save it.
      // const conferenceDetails = await generateConferenceLink(meetingData.conference_provider);
      
      const createdMeeting = await Meeting.create({
        ...meetingData,
        source: 'ChatGPT',
        language: language,
        // conference_details: conferenceDetails
      });

      const aiResponse = {
        id: Date.now(),
        type: "ai",
        content: t[language].meetingCreated,
        timestamp: new Date().toISOString(),
        meetingData: createdMeeting,
        confidence: createdMeeting.confidence
      };
      
      setMessages(prev => [...prev, aiResponse]);
    }
    
    setProposedAction(null);
    setIsProcessing(false);
  };

  const handleCancelAction = () => {
    setProposedAction(null);
    const cancelMessage = {
      id: Date.now(),
      type: "ai",
      content: language === "es" ? "De acuerdo, he cancelado la acción. ¿Hay algo más que pueda hacer?" : "Okay, I've canceled that. Is there anything else I can help with?",
      timestamp: new Date().toISOString()
    };
    setMessages(prev => [...prev, cancelMessage]);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-20 border-b border-gray-100 p-6">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to={createPageUrl("Dashboard")}>
              <Button variant="outline" size="icon" className="hover:bg-gray-50">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{t[language].title}</h1>
              <p className="text-gray-600">{t[language].subtitle}</p>
            </div>
          </div>
          <Badge className="bg-purple-100 text-purple-800 border-purple-200 px-3 py-1">
            <Brain className="w-4 h-4 mr-2" />
            ChatGPT-4 Turbo
          </Badge>
        </div>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <AnimatePresence>
            {messages.map((message) => {
              if (message.isTyping) {
                return (
                  <motion.div key={message.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="flex justify-start">
                    <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center"><Brain className="w-4 h-4 text-purple-600" /></div>
                        <div className="flex items-center gap-1"><span className="text-gray-600 text-sm">{t[language].aiTyping}</span><div className="flex gap-1"><div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce"></div><div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce delay-100"></div><div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce delay-200"></div></div></div>
                      </div>
                    </div>
                  </motion.div>
                );
              }

              return (
                <motion.div key={message.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-md lg:max-w-lg space-y-2`}>
                    <div className={`p-4 rounded-2xl ${message.type === 'user' ? 'meeting-gradient text-white' : message.isError ? 'bg-red-50 border border-red-200 text-red-800' : 'bg-white border border-gray-100 text-gray-900 shadow-sm'}`}>
                      <div className="flex items-start gap-3">
                        {message.type === 'ai' && (<div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0"><Brain className="w-4 h-4 text-purple-600" /></div>)}
                        <div className="flex-1">
                          <p className="whitespace-pre-wrap">{message.content}</p>
                          {message.confidence && (<div className="mt-3 flex items-center gap-2"><span className="text-sm text-gray-500">{t[language].confidence}:</span><ConfidenceBadge confidence={message.confidence} size="sm" /></div>)}
                          
                          {/* Display Meeting Data */}
                          {message.meetingData && (
                            <div className="mt-3 p-3 bg-green-50 rounded-lg border border-green-200">
                              <div className="flex items-center gap-2 mb-2">
                                <Calendar className="w-4 h-4 text-green-600" />
                                <span className="text-sm font-medium text-green-900">{message.meetingData.title}</span>
                              </div>
                              <p className="text-sm text-green-800">{message.meetingData.date} at {message.meetingData.time}</p>
                            </div>
                          )}

                          {/* Display Note/Task Data */}
                          {message.noteData && (
                            <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                              <div className="flex items-center gap-2 mb-2">
                                <ListTodo className="w-4 h-4 text-blue-600" />
                                <span className="text-sm font-medium text-blue-900">{message.noteData.title || (language === 'es' ? 'Nueva Nota/Tarea' : 'New Note/Task')}</span>
                              </div>
                              <p className="text-sm text-blue-800">{message.noteData.content}</p>
                              {message.noteData.due_date && <p className="text-sm text-blue-700 mt-1"><Clock className="inline w-3 h-3 mr-1" />{language === 'es' ? 'Vencimiento:' : 'Due:'} {message.noteData.due_date}</p>}
                              {message.noteData.is_completed && <Badge variant="secondary" className="mt-2 bg-green-200 text-green-800">{language === 'es' ? 'Completado' : 'Completed'}</Badge>}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {proposedAction && (
            <ConfirmationModal 
              action={proposedAction}
              onConfirm={handleConfirmAction}
              onCancel={handleCancelAction}
              language={language}
            />
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="bg-white/80 backdrop-blur-20 border-t border-gray-100 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex gap-4">
            <div className="flex-1">
              <Input value={input} onChange={(e) => setInput(e.target.value)} onKeyPress={handleKeyPress} placeholder={t[language].placeholder} disabled={isProcessing} className="h-12 text-base border-gray-200 focus:ring-purple-500 focus:border-purple-500" />
            </div>
            <Button onClick={handleSend} disabled={!input.trim() || isProcessing} className="h-12 px-6 meeting-gradient text-white shadow-lg hover:shadow-xl transition-all-smooth">
              {isProcessing ? (<Loader2 className="w-5 h-5 animate-spin" />) : (<Send className="w-5 h-5" />)}
              <span className="ml-2 hidden sm:inline">{t[language].send}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
