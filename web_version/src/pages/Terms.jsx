import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, AlertTriangle, Scale, Ban, RefreshCw, CreditCard, Users } from "lucide-react";
import { motion } from "framer-motion";

export default function Terms({ language = "en" }) {
  const termsContent = {
    en: {
      title: "Terms of Service",
      subtitle: "Please read these terms carefully",
      lastUpdated: "Last updated: January 18, 2025",
      sections: [
        {
          title: "Acceptance of Terms",
          icon: FileText,
          content: [
            "By accessing and using MeetingGuard AI, you accept and agree to be bound by these Terms of Service",
            "If you do not agree to these terms, you may not use our service",
            "We may update these terms from time to time, and continued use constitutes acceptance",
            "You must be at least 18 years old or have parental consent to use our service"
          ]
        },
        {
          title: "Service Description",
          icon: Users,
          content: [
            "MeetingGuard AI is an AI-powered meeting management platform",
            "We provide meeting scheduling, reminders, integrations, and productivity tools",
            "Our service includes AI-generated content, suggestions, and automations",
            "We offer both free and premium subscription tiers",
            "Service availability may vary by region and is subject to maintenance"
          ]
        },
        {
          title: "User Responsibilities",
          icon: AlertTriangle,
          content: [
            "You are responsible for maintaining the confidentiality of your account",
            "You must provide accurate and complete information",
            "You agree not to use the service for illegal or unauthorized purposes",
            "You are responsible for all activities that occur under your account",
            "You must respect the intellectual property rights of others",
            "You agree not to reverse engineer, decompile, or attempt to extract our source code"
          ]
        },
        {
          title: "Prohibited Uses",
          icon: Ban,
          content: [
            "Transmitting viruses, malware, or any malicious code",
            "Attempting to gain unauthorized access to our systems",
            "Using the service to spam, harass, or abuse other users",
            "Violating any applicable laws or regulations",
            "Impersonating another person or entity",
            "Interfering with or disrupting the service or servers"
          ]
        },
        {
          title: "Intellectual Property",
          icon: Scale,
          content: [
            "MeetingGuard AI and its original content are protected by copyright and trademark laws",
            "You retain ownership of your meeting data and content",
            "You grant us a limited license to use your content to provide our services",
            "Our AI models and algorithms are proprietary and protected",
            "You may not copy, modify, or create derivative works of our service"
          ]
        },
        {
          title: "Payment Terms",
          icon: CreditCard,
          content: [
            "Premium subscriptions are billed monthly or annually in advance",
            "All fees are non-refundable except as required by law",
            "We may change pricing with 30 days notice to existing subscribers",
            "Failed payments may result in service suspension",
            "Taxes are additional and your responsibility"
          ]
        },
        {
          title: "Service Modifications",
          icon: RefreshCw,
          content: [
            "We reserve the right to modify or discontinue the service at any time",
            "We will provide reasonable notice of material changes",
            "We may suspend or terminate accounts for violations of these terms",
            "Service interruptions may occur for maintenance or technical issues",
            "We are not liable for any modifications or discontinuation of service"
          ]
        }
      ],
      liability: {
        title: "Limitation of Liability",
        content: "TO THE MAXIMUM EXTENT PERMITTED BY LAW, MEETINGGUARD AI SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, USE, OR OTHER INTANGIBLE LOSSES."
      },
      governing: {
        title: "Governing Law",
        content: "These terms shall be governed by and construed in accordance with the laws of [Jurisdiction], without regard to its conflict of law provisions."
      }
    },
    es: {
      title: "Términos de Servicio",
      subtitle: "Por favor lee estos términos cuidadosamente",
      lastUpdated: "Última actualización: 18 de enero de 2025",
      sections: [
        {
          title: "Aceptación de Términos",
          icon: FileText,
          content: [
            "Al acceder y usar MeetingGuard AI, aceptas y acordas estar sujeto a estos Términos de Servicio",
            "Si no estás de acuerdo con estos términos, no puedes usar nuestro servicio",
            "Podemos actualizar estos términos de vez en cuando, y el uso continuado constituye aceptación",
            "Debes tener al menos 18 años o consentimiento parental para usar nuestro servicio"
          ]
        },
        {
          title: "Descripción del Servicio",
          icon: Users,
          content: [
            "MeetingGuard AI es una plataforma de gestión de reuniones impulsada por IA",
            "Proporcionamos programación de reuniones, recordatorios, integraciones y herramientas de productividad",
            "Nuestro servicio incluye contenido generado por IA, sugerencias y automatizaciones",
            "Ofrecemos niveles de suscripción gratuitos y premium",
            "La disponibilidad del servicio puede variar por región y está sujeta a mantenimiento"
          ]
        },
        {
          title: "Responsabilidades del Usuario",
          icon: AlertTriangle,
          content: [
            "Eres responsable de mantener la confidencialidad de tu cuenta",
            "Debes proporcionar información precisa y completa",
            "Aceptas no usar el servicio para propósitos ilegales o no autorizados",
            "Eres responsable de todas las actividades que ocurran bajo tu cuenta",
            "Debes respetar los derechos de propiedad intelectual de otros",
            "Aceptas no realizar ingeniería inversa, descompilar o intentar extraer nuestro código fuente"
          ]
        },
        {
          title: "Usos Prohibidos",
          icon: Ban,
          content: [
            "Transmitir virus, malware o cualquier código malicioso",
            "Intentar obtener acceso no autorizado a nuestros sistemas",
            "Usar el servicio para spam, acosar o abusar de otros usuarios",
            "Violar cualquier ley o regulación aplicable",
            "Hacerse pasar por otra persona o entidad",
            "Interferir con o interrumpir el servicio o servidores"
          ]
        },
        {
          title: "Propiedad Intelectual",
          icon: Scale,
          content: [
            "MeetingGuard AI y su contenido original están protegidos por leyes de derechos de autor y marcas registradas",
            "Mantienes la propiedad de tus datos de reuniones y contenido",
            "Nos otorgas una licencia limitada para usar tu contenido para proporcionar nuestros servicios",
            "Nuestros modelos de IA y algoritmos son propietarios y están protegidos",
            "No puedes copiar, modificar o crear trabajos derivados de nuestro servicio"
          ]
        },
        {
          title: "Términos de Pago",
          icon: CreditCard,
          content: [
            "Las suscripciones premium se facturan mensual o anualmente por adelantado",
            "Todas las tarifas no son reembolsables excepto según lo requerido por ley",
            "Podemos cambiar los precios con 30 días de aviso a los suscriptores existentes",
            "Los pagos fallidos pueden resultar en suspensión del servicio",
            "Los impuestos son adicionales y tu responsabilidad"
          ]
        },
        {
          title: "Modificaciones del Servicio",
          icon: RefreshCw,
          content: [
            "Nos reservamos el derecho de modificar o discontinuar el servicio en cualquier momento",
            "Proporcionaremos aviso razonable de cambios materiales",
            "Podemos suspender o terminar cuentas por violaciones de estos términos",
            "Pueden ocurrir interrupciones del servicio por mantenimiento o problemas técnicos",
            "No somos responsables por modificaciones o discontinuación del servicio"
          ]
        }
      ],
      liability: {
        title: "Limitación de Responsabilidad",
        content: "EN LA MÁXIMA MEDIDA PERMITIDA POR LA LEY, MEETINGGUARD AI NO SERÁ RESPONSABLE POR DAÑOS INDIRECTOS, INCIDENTALES, ESPECIALES, CONSECUENTES O PUNITIVOS, INCLUYENDO PERO NO LIMITADO A PÉRDIDA DE GANANCIAS, DATOS, USO U OTRAS PÉRDIDAS INTANGIBLES."
      },
      governing: {
        title: "Ley Aplicable",
        content: "Estos términos se regirán e interpretarán de acuerdo con las leyes de [Jurisdicción], sin consideración a sus disposiciones de conflicto de leyes."
      }
    }
  };

  const content = termsContent[language] || termsContent.en;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-4"
        >
          <div className="flex items-center justify-center gap-3 mb-4">
            <Scale className="w-12 h-12 text-blue-600" />
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

        {/* Legal Disclaimers */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
          className="space-y-4"
        >
          <Card className="shadow-lg bg-red-50 border-red-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-red-800">
                <AlertTriangle className="w-6 h-6" />
                {content.liability.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-red-700 font-medium">{content.liability.content}</p>
            </CardContent>
          </Card>

          <Card className="shadow-lg bg-blue-50 border-blue-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-blue-800">
                <Scale className="w-6 h-6" />
                {content.governing.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-blue-700">{content.governing.content}</p>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}