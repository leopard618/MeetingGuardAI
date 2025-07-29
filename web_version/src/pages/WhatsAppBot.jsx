
import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, Send, ArrowLeft, Check, CheckCheck } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function WhatsAppBot({ language = "en" }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef(null);

  const t = {
    en: {
      title: "WhatsApp AI Assistant",
      subtitle: "Click 'Send' to open WhatsApp with your smart assistant",
      placeholder: "Your message (meetings, notes, tasks)...",
      send: "Send to WhatsApp",
      backToDashboard: "Back to Dashboard",
      online: "AI Ready",
      lastSeen: "always available"
    },
    es: {
      title: "Asistente IA WhatsApp",
      subtitle: "Presiona 'Enviar' para abrir WhatsApp con tu asistente inteligente",
      placeholder: "Tu mensaje (reuniones, notas, tareas)...",
      send: "Enviar por WhatsApp",
      backToDashboard: "Volver al Panel",
      online: "IA Lista",
      lastSeen: "siempre disponible"
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const welcomeMessage = {
      id: 1,
      type: "bot",
      content: language === "es" ?
        `¡Hola! 👋 Soy tu asistente inteligente MeetingGuard AI.

🎯 **NUEVAS CAPACIDADES:**
📅 **Reuniones completas:**
• "Reunión con María mañana 3pm por Google Meet"
• "Cita médica jueves 10am en Clínica Central"
• "Llamada híbrida: oficina + Zoom el viernes"

📝 **Notas y tareas:**
• "Crear nota: Ideas para proyecto X"
• "Tarea: Llamar proveedor antes del lunes"
• "Recordatorio: Revisar presupuesto mañana 9am"

🗺️ **Ubicaciones inteligentes:**
• Reuniones físicas → Google Maps automático
• Virtuales → Links de Zoom/Teams/Meet
• Híbridas → Ambas opciones disponibles

¡Escribe naturalmente y yo entenderé todo! 🚀` :
        `Hello! 👋 I'm your smart MeetingGuard AI assistant.

🎯 **NEW CAPABILITIES:**
📅 **Complete meetings:**
• "Meeting with Maria tomorrow 3pm via Google Meet"
• "Doctor appointment Thursday 10am at Central Clinic"
• "Hybrid call: office + Zoom on Friday"

📝 **Notes and tasks:**
• "Create note: Ideas for project X"
• "Task: Call supplier before Monday"
• "Reminder: Review budget tomorrow 9am"

🗺️ **Smart locations:**
• Physical meetings → Automatic Google Maps
• Virtual → Zoom/Teams/Meet links
• Hybrid → Both options available

Write naturally and I'll understand everything! 🚀`,
      timestamp: new Date().toISOString(),
      status: "read"
    };
    setMessages([welcomeMessage]);
  }, [language]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSend = () => {
    if (!input.trim()) return;

    // Enhanced WhatsApp integration - we'll use a more sophisticated bot number and message format
    const botPhoneNumber = "15551234567"; // This would be your actual WhatsApp Business number

    // Create a more structured message for better AI processing
    const structuredMessage = `[MeetingGuard AI Request]

Usuario: ${input}
Fecha/Hora de solicitud: ${new Date().toISOString()}
Idioma: ${language}

Por favor procesa esta solicitud de reunión y responde con los detalles confirmados.`;

    const encodedMessage = encodeURIComponent(structuredMessage);
    const whatsappUrl = `https://wa.me/${botPhoneNumber}?text=${encodedMessage}`;

    // Open WhatsApp
    window.open(whatsappUrl, '_blank');

    const userMessage = {
      id: Date.now(),
      type: "user",
      content: input,
      timestamp: new Date().toISOString(),
      status: "sent"
    };

    setMessages(prev => [...prev, userMessage]);
    setInput("");

    // Simulate message status updates for user messages
    setTimeout(() => {
      setMessages(prev =>
        prev.map(msg =>
          msg.id === userMessage.id
            ? { ...msg, status: "delivered" }
            : msg
        )
      );
    }, 500);
    setTimeout(() => {
      setMessages(prev =>
        prev.map(msg =>
          msg.id === userMessage.id
            ? { ...msg, status: "read" }
            : msg
        )
      );
    }, 1000);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case "sent":
        return <Check className="w-4 h-4 text-gray-400" />;
      case "delivered":
        return <CheckCheck className="w-4 h-4 text-gray-400" />;
      case "read":
        return <CheckCheck className="w-4 h-4 text-blue-500" />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <style>{`
        .whatsapp-bg {
          background-image: url("data:image/svg+xml,%3Csvg width='100' height='100' xmlns='http://www.w3.org/2000/svg'%3E%3Cdefs%3E%3Cpattern id='whatsapp-pattern' x='0' y='0' width='100' height='100' patternUnits='userSpaceOnUse'%3E%3Cpath d='M20 20L80 20L80 80L20 80Z' fill='none' stroke='%23e0e0e0' stroke-width='0.5' opacity='0.3'/%3E%3C/pattern%3E%3C/defs%3E%3Crect width='100' height='100' fill='url(%23whatsapp-pattern)'/%3E%3C/svg%3E");
        }
      `}</style>

      {/* WhatsApp-style Header */}
      <div className="bg-green-600 text-white p-4 shadow-lg">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <Link to={createPageUrl("Dashboard")}>
            <Button variant="ghost" size="icon" className="text-white hover:bg-green-700">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>

          <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center">
            <MessageCircle className="w-6 h-6 text-green-600" />
          </div>

          <div className="flex-1">
            <h1 className="font-semibold text-lg">{t[language].title}</h1>
            <p className="text-green-100 text-sm">
              {t[language].online} • {t[language].lastSeen}
            </p>
          </div>

          <Badge className="bg-green-800 text-green-100 border-green-700">
            WhatsApp Business API
          </Badge>
        </div>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-auto whatsapp-bg p-4">
        <div className="max-w-4xl mx-auto space-y-3">
          <AnimatePresence>
            {messages.map((message) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-xs sm:max-w-md p-3 rounded-2xl ${
                    message.type === 'user'
                      ? 'bg-green-500 text-white rounded-br-md'
                      : 'bg-white text-gray-900 rounded-bl-md shadow-sm'
                  }`}
                >
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {message.content}
                  </p>

                  <div className={`flex items-center justify-end gap-1 mt-1 ${
                    message.type === 'user' ? 'text-green-100' : 'text-gray-500'
                  }`}>
                    <span className="text-xs">
                      {new Date(message.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                    {message.type === 'user' && message.status && (
                      <div className="ml-1">
                        {getStatusIcon(message.status)}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Typing Indicator removed as bot functionality is external */}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="bg-white border-t border-gray-200 p-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex gap-3 items-end">
            <div className="flex-1 bg-gray-100 rounded-full p-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={t[language].placeholder}
                className="border-0 bg-transparent focus:ring-0 text-base h-8"
              />
            </div>
            <Button
              onClick={handleSend}
              disabled={!input.trim()}
              size="icon"
              className="bg-green-600 hover:bg-green-700 text-white rounded-full w-12 h-12 shadow-lg"
            >
              <Send className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
