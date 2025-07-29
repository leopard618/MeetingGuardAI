import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Edit, Brain, MessageCircle } from 'lucide-react';
import { motion } from 'framer-motion';

const MethodCard = ({ to, icon: Icon, title, description, delay }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: delay * 0.15 }}
    whileHover={{ scale: 1.03 }}
    className="h-full"
  >
    <Link to={to} className="block h-full">
      <Card className="h-full glass-effect shadow-lg hover:shadow-xl transition-all-smooth border-2 border-transparent hover:border-purple-400 flex flex-col justify-between p-8">
        <div>
          <div className="w-16 h-16 meeting-gradient rounded-2xl flex items-center justify-center mb-6 shadow-lg">
            <Icon className="w-8 h-8 text-white" />
          </div>
          <h3 className="text-2xl font-bold text-gray-900 mb-2">{title}</h3>
          <p className="text-gray-600 leading-relaxed">{description}</p>
        </div>
      </Card>
    </Link>
  </motion.div>
);

export default function ChooseCreationMethod({ language = "en" }) {
  const t = {
    en: {
      title: "Choose a Creation Method",
      subtitle: "Select how you want to schedule your next meeting.",
      manualTitle: "Manual",
      manualDesc: "Full control. Define every detail of your meeting in a simple form.",
      aiTitle: "AI Assistant",
      aiDesc: "Talk to the AI. Ask for what you need in natural language and let the assistant do the rest.",
      whatsappTitle: "WhatsApp Bot",
      whatsappDesc: "Quick and mobile. Send a message to schedule on the go, from anywhere.",
      back: "Back to Dashboard"
    },
    es: {
      title: "Elige un Método de Creación",
      subtitle: "Selecciona cómo quieres agendar tu próxima reunión.",
      manualTitle: "Manual",
      manualDesc: "Control total. Define cada detalle de tu reunión en un formulario simple.",
      aiTitle: "Asistente IA",
      aiDesc: "Habla con la IA. Pide lo que necesitas en lenguaje natural y deja que el asistente haga el resto.",
      whatsappTitle: "Bot de WhatsApp",
      whatsappDesc: "Rápido y móvil. Envía un mensaje para agendar sobre la marcha, desde cualquier lugar.",
      back: "Volver al Panel"
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-10">
          <Link to={createPageUrl("Dashboard")}>
            <Button variant="ghost" className="mb-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              {t[language].back}
            </Button>
          </Link>
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <h1 className="text-4xl font-bold text-gray-900">{t[language].title}</h1>
            <p className="text-xl text-gray-600 mt-2">{t[language].subtitle}</p>
          </motion.div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <MethodCard 
            to={createPageUrl("CreateMeeting")}
            icon={Edit}
            title={t[language].manualTitle}
            description={t[language].manualDesc}
            delay={0}
          />
          <MethodCard 
            to={createPageUrl("AIChat")}
            icon={Brain}
            title={t[language].aiTitle}
            description={t[language].aiDesc}
            delay={1}
          />
          <MethodCard 
            to={createPageUrl("WhatsAppBot")}
            icon={MessageCircle}
            title={t[language].whatsappTitle}
            description={t[language].whatsappDesc}
            delay={2}
          />
        </div>
      </div>
    </div>
  );
}