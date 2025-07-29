import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Lock, Eye, UserCheck, Database, Globe, Mail, Phone } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslation } from "@/components/translations";

export default function Privacy({ language = "en" }) {
  const { t } = useTranslation(language);

  const privacyContent = {
    en: {
      title: "Privacy Policy",
      subtitle: "Your privacy is our priority",
      lastUpdated: "Last updated: January 18, 2025",
      sections: [
        {
          title: "Information We Collect",
          icon: Database,
          content: [
            "Personal Information: Name, email address, and profile information when you create an account",
            "Meeting Data: Meeting titles, descriptions, dates, times, participant information, and locations",
            "Usage Data: How you interact with our application, pages visited, and features used",
            "Device Information: Browser type, operating system, and device identifiers",
            "Third-party Integration Data: Calendar events and contact information when you connect external services"
          ]
        },
        {
          title: "How We Use Your Information",
          icon: UserCheck,
          content: [
            "Provide and maintain our meeting management services",
            "Send you meeting reminders and notifications",
            "Improve our AI-powered features and recommendations",
            "Integrate with third-party services you authorize (Google Calendar, etc.)",
            "Communicate with you about service updates and support",
            "Ensure security and prevent fraud"
          ]
        },
        {
          title: "Data Sharing and Disclosure",
          icon: Shield,
          content: [
            "We do NOT sell your personal information to third parties",
            "We may share data with authorized service providers who help us operate our service",
            "Third-party integrations only receive data you explicitly authorize",
            "We may disclose information if required by law or to protect our rights",
            "In case of business transfer, user data may be transferred with proper notice"
          ]
        },
        {
          title: "Data Security",
          icon: Lock,
          content: [
            "All data is encrypted in transit and at rest using industry-standard encryption",
            "We implement multi-factor authentication and access controls",
            "Regular security audits and penetration testing",
            "Data is stored in secure, SOC 2 compliant data centers",
            "Automatic data backups with encryption"
          ]
        },
        {
          title: "Your Rights",
          icon: Eye,
          content: [
            "Access: Request a copy of your personal data",
            "Correction: Update or correct inaccurate information",
            "Deletion: Request deletion of your account and data",
            "Portability: Export your data in a machine-readable format",
            "Restriction: Limit how we process your data",
            "Objection: Object to certain types of data processing"
          ]
        },
        {
          title: "International Data Transfers",
          icon: Globe,
          content: [
            "Your data may be processed in countries outside your residence",
            "We ensure adequate protection through appropriate safeguards",
            "EU users: We comply with GDPR requirements for international transfers",
            "We use standard contractual clauses and adequacy decisions where applicable"
          ]
        }
      ],
      contact: {
        title: "Contact Us",
        subtitle: "Questions about this privacy policy?",
        email: "privacy@meetingguard.ai",
        phone: "+1 (555) 123-4567",
        address: "123 Privacy Street, Data City, DC 12345"
      }
    },
    es: {
      title: "Política de Privacidad",
      subtitle: "Tu privacidad es nuestra prioridad",
      lastUpdated: "Última actualización: 18 de enero de 2025",
      sections: [
        {
          title: "Información que Recopilamos",
          icon: Database,
          content: [
            "Información Personal: Nombre, dirección de correo electrónico e información de perfil al crear una cuenta",
            "Datos de Reuniones: Títulos, descripciones, fechas, horarios, información de participantes y ubicaciones",
            "Datos de Uso: Cómo interactúas con nuestra aplicación, páginas visitadas y funciones utilizadas",
            "Información del Dispositivo: Tipo de navegador, sistema operativo e identificadores del dispositivo",
            "Datos de Integraciones: Eventos de calendario e información de contactos cuando conectas servicios externos"
          ]
        },
        {
          title: "Cómo Usamos tu Información",
          icon: UserCheck,
          content: [
            "Proporcionar y mantener nuestros servicios de gestión de reuniones",
            "Enviarte recordatorios y notificaciones de reuniones",
            "Mejorar nuestras funciones de IA y recomendaciones",
            "Integrar con servicios de terceros que autorices (Google Calendar, etc.)",
            "Comunicarnos contigo sobre actualizaciones del servicio y soporte",
            "Garantizar la seguridad y prevenir el fraude"
          ]
        },
        {
          title: "Compartir y Divulgación de Datos",
          icon: Shield,
          content: [
            "NO vendemos tu información personal a terceros",
            "Podemos compartir datos con proveedores de servicios autorizados que nos ayudan a operar nuestro servicio",
            "Las integraciones de terceros solo reciben datos que autorizas explícitamente",
            "Podemos divulgar información si es requerido por ley o para proteger nuestros derechos",
            "En caso de transferencia comercial, los datos del usuario pueden transferirse con aviso previo"
          ]
        },
        {
          title: "Seguridad de Datos",
          icon: Lock,
          content: [
            "Todos los datos están encriptados en tránsito y en reposo usando encriptación estándar de la industria",
            "Implementamos autenticación multifactor y controles de acceso",
            "Auditorías de seguridad regulares y pruebas de penetración",
            "Los datos se almacenan en centros de datos seguros y compatibles con SOC 2",
            "Copias de seguridad automáticas de datos con encriptación"
          ]
        },
        {
          title: "Tus Derechos",
          icon: Eye,
          content: [
            "Acceso: Solicitar una copia de tus datos personales",
            "Corrección: Actualizar o corregir información inexacta",
            "Eliminación: Solicitar la eliminación de tu cuenta y datos",
            "Portabilidad: Exportar tus datos en un formato legible por máquina",
            "Restricción: Limitar cómo procesamos tus datos",
            "Objeción: Oponerte a ciertos tipos de procesamiento de datos"
          ]
        },
        {
          title: "Transferencias Internacionales de Datos",
          icon: Globe,
          content: [
            "Tus datos pueden ser procesados en países fuera de tu residencia",
            "Aseguramos protección adecuada a través de salvaguardas apropiadas",
            "Usuarios de la UE: Cumplimos con los requisitos del GDPR para transferencias internacionales",
            "Utilizamos cláusulas contractuales estándar y decisiones de adecuación donde sea aplicable"
          ]
        }
      ],
      contact: {
        title: "Contáctanos",
        subtitle: "¿Preguntas sobre esta política de privacidad?",
        email: "privacidad@meetingguard.ai",
        phone: "+1 (555) 123-4567",
        address: "123 Calle Privacidad, Ciudad de Datos, DC 12345"
      }
    }
  };

  const content = privacyContent[language] || privacyContent.en;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-4"
        >
          <div className="flex items-center justify-center gap-3 mb-4">
            <Shield className="w-12 h-12 text-blue-600" />
            <h1 className="text-4xl font-bold text-gray-900">{content.title}</h1>
          </div>
          <p className="text-lg text-gray-600">{content.subtitle}</p>
          <p className="text-sm text-gray-500">{content.lastUpdated}</p>
        </motion.div>

        {content.sections.map((section, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <section.icon className="w-6 h-6 text-blue-600" />
                  {section.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {section.content.map((item, itemIndex) => (
                    <li key={itemIndex} className="flex items-start gap-3">
                      <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 flex-shrink-0"></div>
                      <span className="text-gray-700 leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </motion.div>
        ))}

        {/* Contact Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
        >
          <Card className="shadow-lg bg-blue-50 border-blue-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <Mail className="w-6 h-6 text-blue-600" />
                {content.contact.title}
              </CardTitle>
              <p className="text-gray-600">{content.contact.subtitle}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Mail className="w-5 h-5 text-blue-600" />
                <a href={`mailto:${content.contact.email}`} className="text-blue-600 hover:underline">
                  {content.contact.email}
                </a>
              </div>
              <div className="flex items-center gap-3">
                <Phone className="w-5 h-5 text-blue-600" />
                <a href={`tel:${content.contact.phone}`} className="text-blue-600 hover:underline">
                  {content.contact.phone}
                </a>
              </div>
              <div className="flex items-start gap-3">
                <Globe className="w-5 h-5 text-blue-600 mt-0.5" />
                <span className="text-gray-700">{content.contact.address}</span>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}