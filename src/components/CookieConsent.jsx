import React, { useState, useEffect } from "react";
import { Button } from './ui\button';
import { Card, CardContent } from './ui\card';
import { Switch } from './ui\switch';
import { Label } from './ui\label';
import { Cookie, Settings, X, Check } from "lucide-react-native";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-native";
import { createPageUrl } from '..\utils';
import { storage } from '..\utils\storage';

export default function CookieConsent({ language = "en" }) {
  const [showBanner, setShowBanner] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [preferences, setPreferences] = useState({
    necessary: true, // Always true, cannot be disabled
    analytics: false,
    marketing: false,
    functional: false
  });

  const content = {
    en: {
      title: "We use cookies",
      description: "We use cookies and similar technologies to enhance your experience, analyze usage, and provide personalized content.",
      acceptAll: "Accept All",
      acceptSelected: "Accept Selected",
      rejectAll: "Reject All",
      settings: "Cookie Settings",
      necessary: "Necessary",
      necessaryDesc: "Essential for basic website functionality",
      analytics: "Analytics",
      analyticsDesc: "Help us understand how you use our site",
      marketing: "Marketing",
      marketingDesc: "Used to deliver relevant advertisements",
      functional: "Functional",
      functionalDesc: "Remember your preferences and settings",
      learnMore: "Learn more in our",
      privacyPolicy: "Privacy Policy",
      cookiePolicy: "Cookie Policy",
      savePreferences: "Save Preferences"
    },
    es: {
      title: "Usamos cookies",
      description: "Utilizamos cookies y tecnologías similares para mejorar tu experiencia, analizar el uso y proporcionar contenido personalizado.",
      acceptAll: "Aceptar Todas",
      acceptSelected: "Aceptar Seleccionadas",
      rejectAll: "Rechazar Todas",
      settings: "Configuración de Cookies",
      necessary: "Necesarias",
      necessaryDesc: "Esenciales para la funcionalidad básica del sitio web",
      analytics: "Analíticas",
      analyticsDesc: "Nos ayudan a entender cómo usas nuestro sitio",
      marketing: "Marketing",
      marketingDesc: "Utilizadas para entregar anuncios relevantes",
      functional: "Funcionales",
      functionalDesc: "Recuerdan tus preferencias y configuraciones",
      learnMore: "Aprende más en nuestra",
      privacyPolicy: "Política de Privacidad",
      cookiePolicy: "Política de Cookies",
      savePreferences: "Guardar Preferencias"
    }
  };

  const t = content[language] || content.en;

  useEffect(() => {
    const loadConsent = async () => {
      const consent = await storage.getItem('cookieConsent');
      if (!consent) {
        // Show banner after a short delay for better UX
        setTimeout(() => setShowBanner(true), 1000);
      } else {
        const savedPreferences = JSON.parse(consent);
        setPreferences(savedPreferences);
      }
    };
    loadConsent();
  }, []);

  const handleAcceptAll = async () => {
    const allAccepted = {
      necessary: true,
      analytics: true,
      marketing: true,
      functional: true
    };
    await saveConsent(allAccepted);
  };

  const handleRejectAll = async () => {
    const rejected = {
      necessary: true, // Cannot be disabled
      analytics: false,
      marketing: false,
      functional: false
    };
    await saveConsent(rejected);
  };

  const handleAcceptSelected = async () => {
    await saveConsent(preferences);
  };

  const saveConsent = async (prefs) => {
    await storage.setItem('cookieConsent', JSON.stringify(prefs));
    setPreferences(prefs);
    setShowBanner(false);
    setShowSettings(false);
    
    // Initialize analytics if accepted
    if (prefs.analytics) {
      // Here you would initialize your analytics (Google Analytics, etc.)
      console.log('Analytics cookies accepted');
    }
    
    // Initialize marketing if accepted
    if (prefs.marketing) {
      // Here you would initialize marketing tools (Facebook Pixel, etc.)
      console.log('Marketing cookies accepted');
    }
    
    // Initialize functional if accepted
    if (prefs.functional) {
      // Here you would initialize functional cookies
      console.log('Functional cookies accepted');
    }
  };

  const handlePreferenceChange = (type, value) => {
    if (type === 'necessary') return; // Cannot change necessary cookies
    setPreferences(prev => ({ ...prev, [type]: value }));
  };

  return (
    <AnimatePresence>
      {showBanner && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          className="fixed bottom-0 left-0 right-0 z-50 p-4"
        >
          <Card className="mx-auto max-w-4xl shadow-2xl border-2 border-blue-200 bg-white">
            <CardContent className="p-6">
              {!showSettings ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-4">
                    <Cookie className="w-8 h-8 text-amber-500 flex-shrink-0 mt-1" />
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">
                        {t.title}
                      </h3>
                      <p className="text-gray-600 text-sm leading-relaxed mb-4">
                        {t.description}
                      </p>
                      <p className="text-xs text-gray-500">
                        {t.learnMore}{" "}
                        <Link to={createPageUrl("Privacy")} className="text-blue-600 hover:underline">
                          {t.privacyPolicy}
                        </Link>
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap gap-3 pt-4 border-t border-gray-200">
                    <Button
                      onClick={handleAcceptAll}
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      <Check className="w-4 h-4 mr-2" />
                      {t.acceptAll}
                    </Button>
                    <Button
                      onClick={handleRejectAll}
                      variant="outline"
                      className="border-gray-300"
                    >
                      <X className="w-4 h-4 mr-2" />
                      {t.rejectAll}
                    </Button>
                    <Button
                      onClick={() => setShowSettings(true)}
                      variant="outline"
                      className="border-blue-300 text-blue-600"
                    >
                      <Settings className="w-4 h-4 mr-2" />
                      {t.settings}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {t.settings}
                    </h3>
                    <Button
                      onClick={() => setShowSettings(false)}
                      variant="ghost"
                      size="sm"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  
                  <div className="space-y-4">
                    {[
                      { key: 'necessary', label: t.necessary, desc: t.necessaryDesc },
                      { key: 'analytics', label: t.analytics, desc: t.analyticsDesc },
                      { key: 'marketing', label: t.marketing, desc: t.marketingDesc },
                      { key: 'functional', label: t.functional, desc: t.functionalDesc }
                    ].map(({ key, label, desc }) => (
                      <div key={key} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex-1">
                          <Label htmlFor={key} className="font-medium text-gray-900">
                            {label}
                          </Label>
                          <p className="text-xs text-gray-600 mt-1">{desc}</p>
                        </div>
                        <Switch
                          id={key}
                          checked={preferences[key]}
                          onCheckedChange={(value) => handlePreferenceChange(key, value)}
                          disabled={key === 'necessary'}
                        />
                      </div>
                    ))}
                  </div>
                  
                  <div className="flex gap-3 pt-4 border-t border-gray-200">
                    <Button
                      onClick={handleAcceptSelected}
                      className="bg-blue-600 hover:bg-blue-700 text-white flex-1"
                    >
                      {t.savePreferences}
                    </Button>
                    <Button
                      onClick={handleAcceptAll}
                      variant="outline"
                      className="flex-1"
                    >
                      {t.acceptAll}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );
}