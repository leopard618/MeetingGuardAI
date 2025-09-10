

import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-native";
import { User } from '../api/entities';
import { UserPreferences } from '../api/entities';
import { Button } from '../components/ui/button';
import { createPageUrl } from '../utils';
import { Menu, X, LayoutDashboard, Calendar, MessageCircle, Settings, Globe, PlusCircle, Briefcase, StickyNote, CreditCard } from "lucide-react-native";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation, getAvailableLanguages } from '../components/translations';
import CookieConsent from '../components/CookieConsent';

const navigationItems = [
  {
    titleKey: "nav.dashboard",
    url: createPageUrl("Dashboard"),
    icon: LayoutDashboard,
    iconColor: "text-blue-400", // Blue for main dashboard
    activeIconColor: "text-blue-300"
  },
  {
    titleKey: "nav.addMeeting",
    url: createPageUrl("ChooseCreationMethod"),
    icon: PlusCircle,
    iconColor: "text-green-400", // Green for creating/adding
    activeIconColor: "text-green-300"
  },
  {
    titleKey: "nav.calendar",
    url: createPageUrl("Calendar"),
    icon: Calendar,
    iconColor: "text-purple-400", // Purple for calendar
    activeIconColor: "text-purple-300"
  },
  {
    titleKey: "nav.notes",
    url: createPageUrl("Notes"),
    icon: StickyNote,
    iconColor: "text-orange-400",
    activeIconColor: "text-orange-300"
  },
  {
    titleKey: "nav.aiChat",
    url: createPageUrl("AIChat"),
    icon: MessageCircle,
    iconColor: "text-cyan-400", // Cyan for AI/chat
    activeIconColor: "text-cyan-300"
  },
  {
    titleKey: "nav.settings",
    url: createPageUrl("Settings"),
    icon: Settings,
    iconColor: "text-gray-400", // Gray for settings
    activeIconColor: "text-gray-300"
  },
  {
    titleKey: "nav.apiKeys",
    url: createPageUrl("ApiSettings"),
    icon: Briefcase,
    iconColor: "text-amber-400", // Amber for business/API
    activeIconColor: "text-amber-300"
  },
  {
    titleKey: "nav.pricing",
    url: createPageUrl("Pricing"),
    icon: CreditCard,
    iconColor: "text-emerald-400", // Emerald for pricing/billing
    activeIconColor: "text-emerald-300"
  },
];

const LanguageSelector = ({ language, setLanguage }) => {
  const [isOpen, setIsOpen] = useState(false);
  const availableLanguages = getAvailableLanguages();
  const currentLang = availableLanguages.find(lang => lang.code === language);

  return (
    <div className="relative">
      <Button 
        variant="ghost" 
        size="sm" 
        onClick={() => setIsOpen(!isOpen)}
        className="text-gray-400 hover:text-white transition-colors w-full justify-start"
      >
        <Globe className="w-4 h-4 mr-2" />
        {currentLang?.flag} {currentLang?.name}
      </Button>
      
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 bg-gray-800 rounded-lg shadow-lg border border-gray-700 min-w-[160px] z-50">
          {availableLanguages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => {
                setLanguage(lang.code);
                setIsOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-700 transition-colors first:rounded-t-lg last:rounded-b-lg ${
                language === lang.code ? 'bg-gray-700 text-white' : 'text-gray-300'
              }`}
            >
              {lang.flag} {lang.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const SidebarContent = ({ language, setLanguage, onLinkClick }) => {
  const location = useLocation();
  const { t } = useTranslation(language);

  return (
    <>
      <div className="flex items-center justify-between p-4 h-20 border-b border-gray-700">
        <Link to={createPageUrl("Dashboard")} className="flex items-center gap-2">
          <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/816636779_file_00000000800861f89b8e5d3eba90a7691.png" alt="MeetingGuard AI Logo" className="h-8 w-8" />
          <span className="font-bold text-lg text-white">MeetingGuard AI</span>
        </Link>
        <Button variant="ghost" size="icon" className="md:hidden text-gray-400 hover:text-white" onClick={onLinkClick}>
          <X className="h-6 w-6"/>
        </Button>
      </div>
      <nav className="flex-1 px-2 py-4 space-y-1">
        {navigationItems.map((item) => {
          const isActive = location.pathname === item.url;
          return (
            <Link
              key={item.titleKey}
              to={item.url}
              onClick={onLinkClick}
              className={`flex items-center px-4 py-3 text-sm rounded-lg transition-all duration-200 ${
                isActive
                  ? "bg-gray-800 text-white font-semibold shadow-md"
                  : "text-gray-300 hover:bg-gray-700 hover:text-white"
              }`}
            >
              <item.icon className={`h-5 w-5 mr-3 ${
                isActive ? item.activeIconColor : item.iconColor
              } transition-colors`} />
              {t(item.titleKey)}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-gray-700">
        <LanguageSelector language={language} setLanguage={setLanguage} />
      </div>
    </>
  );
};

export default function Layout({ children, currentPageName }) {
  const [user, setUser] = useState(null);
  const [language, setLanguageState] = useState("en");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const fetchUserAndPrefs = async () => {
      try {
        const currentUser = await User.me();
        setUser(currentUser);
        const prefsList = await UserPreferences.filter({ created_by: currentUser.email });
        if (prefsList.length > 0) {
          setLanguageState(prefsList[0].language || "en");
        } else {
          // If no preferences, create them
          const newPrefs = await UserPreferences.create({ created_by: currentUser.email, language: "en" });
          setLanguageState(newPrefs.language);
        }
      } catch (error) {
        console.error("User not logged in or error fetching data:", error);
      }
    };
    fetchUserAndPrefs();
  }, []);

  const setLanguage = async (lang) => {
    setLanguageState(lang);
    if (user) {
      try {
        const prefsList = await UserPreferences.filter({ created_by: user.email });
        if (prefsList.length > 0) {
          await UserPreferences.update(prefsList[0].id, { language: lang });
        } else {
          await UserPreferences.create({ created_by: user.email, language: lang });
        }
      } catch (error) {
        console.error("Error updating language preference:", error);
      }
    }
  };

  const childrenWithProps = React.Children.map(children, (child) => {
    if (React.isValidElement(child)) {
      return React.cloneElement(child, { language });
    }
    return child;
  });

  return (
    <>
      <style>{`
        .meeting-gradient {
          background-image: linear-gradient(135deg, #8B5CF6, #3B82F6);
        }
        .whatsapp-gradient {
          background-image: linear-gradient(135deg, #4ADE80, #22C55E);
        }
        .glass-effect {
          background-color: rgba(255, 255, 255, 0.6);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.2);
        }
        .transition-all-smooth {
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .shadow-3xl {
           box-shadow: 0 30px 60px -15px rgba(0, 0, 0, 0.3);
        }
      `}</style>
      <div className="flex h-screen bg-gray-100">
        {/* Mobile Header */}
        <header className="md:hidden fixed top-0 left-0 right-0 bg-white shadow-md z-40 flex justify-between items-center p-4">
          <Link to={createPageUrl("Dashboard")} className="flex items-center gap-2">
            <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/816636779_file_00000000800861f89b8e5d3eba90a7691.png" alt="MeetingGuard AI Logo" className="h-8 w-8" />
            <span className="font-bold text-lg">MeetingGuard AI</span>
          </Link>
          <Button variant="ghost" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
            <Menu className="h-6 w-6" />
          </Button>
        </header>
        
        {/* Sidebar for Mobile - CORREGIDO CON SCROLL */}
        <AnimatePresence>
          {isSidebarOpen && (
             <motion.div
               initial={{ x: "-100%" }}
               animate={{ x: 0 }}
               exit={{ x: "-100%" }}
               transition={{ type: "spring", stiffness: 300, damping: 30 }}
               className="fixed inset-0 z-50 md:hidden flex"
             >
            <div className="w-64 flex-shrink-0 flex flex-col bg-gray-900 text-white overflow-y-auto">
                <SidebarContent language={language} setLanguage={setLanguage} onLinkClick={() => setIsSidebarOpen(false)} />
            </div>
            <div className="flex-1 bg-black/50" onClick={() => setIsSidebarOpen(false)}></div>
           </motion.div>
          )}
        </AnimatePresence>
        
        {/* Static Sidebar for Desktop */}
        <div className="hidden md:flex md:flex-shrink-0">
           <div className="flex w-64 flex-col bg-gray-900 shadow-lg">
              <SidebarContent language={language} setLanguage={setLanguage} />
           </div>
        </div>
        
        {/* Main Content */}
        <main className="flex-1 overflow-y-auto pt-20 md:pt-0">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {childrenWithProps}
          </div>
        </main>
      </div>
      
      {/* Add Cookie Consent */}
      <CookieConsent language={language} />
      
      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            {/* Company Info */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/816636779_file_00000000800861f89b8e5d3eba90a7691.png" alt="Logo" className="h-8 w-8" />
                <span className="font-bold text-lg">MeetingGuard AI</span>
              </div>
              <p className="text-gray-400 text-sm">
                {language === 'es' 
                  ? 'La plataforma de gestión de reuniones más inteligente del mundo, impulsada por IA.'
                  : 'The world\'s smartest AI-powered meeting management platform.'
                }
              </p>
              <div className="flex space-x-4">
                <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/></svg>
                </a>
                <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                </a>
                <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                </a>
                <a href="https://facebook.com" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                </a>
              </div>
            </div>
            
            {/* Quick Links */}
            <div>
              <h3 className="font-semibold text-lg mb-4">
                {language === 'es' ? 'Enlaces Rápidos' : 'Quick Links'}
              </h3>
              <ul className="space-y-2 text-sm">
                <li><Link to={createPageUrl("Dashboard")} className="text-gray-400 hover:text-white transition-colors">
                  {language === 'es' ? 'Panel Principal' : 'Dashboard'}
                </Link></li>
                <li><Link to={createPageUrl("ChooseCreationMethod")} className="text-gray-400 hover:text-white transition-colors">
                  {language === 'es' ? 'Crear Reunión' : 'Create Meeting'}
                </Link></li>
                <li><Link to={createPageUrl("Calendar")} className="text-gray-400 hover:text-white transition-colors">
                  {language === 'es' ? 'Calendario' : 'Calendar'}
                </Link></li>
                <li><Link to={createPageUrl("Settings")} className="text-gray-400 hover:text-white transition-colors">
                  {language === 'es' ? 'Configuración' : 'Settings'}
                </Link></li>
              </ul>
            </div>
            
            {/* Legal */}
            <div>
              <h3 className="font-semibold text-lg mb-4">
                {language === 'es' ? 'Legal' : 'Legal'}
              </h3>
              <ul className="space-y-2 text-sm">
                <li><Link to={createPageUrl("Privacy")} className="text-gray-400 hover:text-white transition-colors">
                  {language === 'es' ? 'Política de Privacidad' : 'Privacy Policy'}
                </Link></li>
                <li><Link to={createPageUrl("Terms")} className="text-gray-400 hover:text-white transition-colors">
                  {language === 'es' ? 'Términos de Servicio' : 'Terms of Service'}
                </Link></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition-colors">
                  {language === 'es' ? 'Política de Cookies' : 'Cookie Policy'}
                </a></li>
                <li><a href="mailto:legal@meetingguard.ai" className="text-gray-400 hover:text-white transition-colors">
                  {language === 'es' ? 'Contacto Legal' : 'Legal Contact'}
                </a></li>
              </ul>
            </div>
            
            {/* Support */}
            <div>
              <h3 className="font-semibold text-lg mb-4">
                {language === 'es' ? 'Soporte' : 'Support'}
              </h3>
              <ul className="space-y-2 text-sm">
                <li><a href="mailto:support@meetingguard.ai" className="text-gray-400 hover:text-white transition-colors">
                  {language === 'es' ? 'Centro de Ayuda' : 'Help Center'}
                </a></li>
                <li><a href="mailto:support@meetingguard.ai" className="text-gray-400 hover:text-white transition-colors">
                  {language === 'es' ? 'Contactar Soporte' : 'Contact Support'}
                </a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition-colors">
                  {language === 'es' ? 'Estado del Servicio' : 'Service Status'}
                </a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition-colors">
                  {language === 'es' ? 'Documentación API' : 'API Documentation'}
                </a></li>
              </ul>
            </div>
          </div>
          
          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-sm text-gray-400">
            <p>&copy; 2025 MeetingGuard AI. {language === 'es' ? 'Todos los derechos reservados.' : 'All rights reserved.'}</p>
            <p className="mt-2">
              {language === 'es' 
                ? 'Hecho con ❤️ para revolucionar la productividad de las reuniones.'
                : 'Made with ❤️ to revolutionize meeting productivity.'
              }
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}

