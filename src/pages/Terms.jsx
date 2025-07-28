import React from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
} from "react-native";
import {
  Card,
  Title,
  Paragraph,
  Divider,
} from "react-native-paper";
import { MaterialIcons } from "@expo/vector-icons";

export default function Terms({ navigation, language = "en" }) {
  const t = {
    en: {
      title: "Terms of Service",
      subtitle: "Please read these terms carefully before using our service",
      lastUpdated: "Last updated: December 2024",
      
      // Sections
      acceptance: "Acceptance of Terms",
      acceptanceDesc: "By accessing and using MeetingGuard AI, you accept and agree to be bound by the terms and provision of this agreement.",
      
      serviceDescription: "Service Description",
      serviceDescriptionDesc: "MeetingGuard AI is an intelligent meeting management platform that provides:",
      serviceDescriptionItems: [
        "AI-powered meeting scheduling and management",
        "Smart notifications and reminders",
        "Calendar integration and synchronization",
        "Meeting analytics and insights",
        "Team collaboration features"
      ],
      
      userAccounts: "User Accounts",
      userAccountsDesc: "To use our service, you must:",
      userAccountsItems: [
        "Be at least 18 years old or have parental consent",
        "Provide accurate and complete information",
        "Maintain the security of your account credentials",
        "Notify us immediately of any unauthorized use",
        "Accept responsibility for all activities under your account"
      ],
      
      acceptableUse: "Acceptable Use",
      acceptableUseDesc: "You agree to use our service only for lawful purposes and in accordance with these terms. You agree not to:",
      acceptableUseItems: [
        "Use the service for any illegal or unauthorized purpose",
        "Interfere with or disrupt the service or servers",
        "Attempt to gain unauthorized access to any part of the service",
        "Use automated systems to access the service",
        "Share your account credentials with others"
      ],
      
      intellectualProperty: "Intellectual Property",
      intellectualPropertyDesc: "The service and its original content, features, and functionality are owned by MeetingGuard AI and are protected by international copyright, trademark, patent, trade secret, and other intellectual property laws.",
      
      privacy: "Privacy",
      privacyDesc: "Your privacy is important to us. Please review our Privacy Policy, which also governs your use of the service, to understand our practices.",
      
      termination: "Termination",
      terminationDesc: "We may terminate or suspend your account and bar access to the service immediately, without prior notice or liability, under our sole discretion, for any reason whatsoever, including without limitation if you breach the terms.",
      
      disclaimers: "Disclaimers",
      disclaimersDesc: "The service is provided on an 'AS IS' and 'AS AVAILABLE' basis. MeetingGuard AI makes no warranties, expressed or implied, and hereby disclaims all warranties, including without limitation:",
      disclaimersItems: [
        "That the service will meet your specific requirements",
        "That the service will be uninterrupted, timely, secure, or error-free",
        "That the results obtained from using the service will be accurate or reliable",
        "That the quality of any products, services, information, or other material will meet your expectations"
      ],
      
      limitations: "Limitations of Liability",
      limitationsDesc: "In no event shall MeetingGuard AI, nor its directors, employees, partners, agents, suppliers, or affiliates, be liable for any indirect, incidental, special, consequential, or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses.",
      
      changes: "Changes to Terms",
      changesDesc: "We reserve the right to modify or replace these terms at any time. If a revision is material, we will provide at least 30 days notice prior to any new terms taking effect.",
      
      contact: "Contact Information",
      contactDesc: "If you have any questions about these Terms of Service, please contact us at:",
      email: "legal@meetingguard.ai",
      address: "MeetingGuard AI\n123 Innovation Street\nTech City, TC 12345"
    },
    es: {
      title: "Términos de Servicio",
      subtitle: "Por favor lee estos términos cuidadosamente antes de usar nuestro servicio",
      lastUpdated: "Última actualización: Diciembre 2024",
      
      acceptance: "Aceptación de Términos",
      acceptanceDesc: "Al acceder y usar MeetingGuard AI, aceptas y acuerdas estar sujeto a los términos y disposiciones de este acuerdo.",
      
      serviceDescription: "Descripción del Servicio",
      serviceDescriptionDesc: "MeetingGuard AI es una plataforma inteligente de gestión de reuniones que proporciona:",
      serviceDescriptionItems: [
        "Programación y gestión de reuniones impulsada por IA",
        "Notificaciones y recordatorios inteligentes",
        "Integración y sincronización de calendarios",
        "Análisis e insights de reuniones",
        "Características de colaboración en equipo"
      ],
      
      userAccounts: "Cuentas de Usuario",
      userAccountsDesc: "Para usar nuestro servicio, debes:",
      userAccountsItems: [
        "Tener al menos 18 años o tener consentimiento parental",
        "Proporcionar información precisa y completa",
        "Mantener la seguridad de tus credenciales de cuenta",
        "Notificarnos inmediatamente de cualquier uso no autorizado",
        "Aceptar responsabilidad por todas las actividades bajo tu cuenta"
      ],
      
      acceptableUse: "Uso Aceptable",
      acceptableUseDesc: "Acuerdas usar nuestro servicio solo para propósitos legales y de acuerdo con estos términos. Acuerdas no:",
      acceptableUseItems: [
        "Usar el servicio para cualquier propósito ilegal o no autorizado",
        "Interferir o interrumpir el servicio o servidores",
        "Intentar obtener acceso no autorizado a cualquier parte del servicio",
        "Usar sistemas automatizados para acceder al servicio",
        "Compartir tus credenciales de cuenta con otros"
      ],
      
      intellectualProperty: "Propiedad Intelectual",
      intellectualPropertyDesc: "El servicio y su contenido original, características y funcionalidad son propiedad de MeetingGuard AI y están protegidos por leyes internacionales de derechos de autor, marcas comerciales, patentes, secretos comerciales y otras leyes de propiedad intelectual.",
      
      privacy: "Privacidad",
      privacyDesc: "Tu privacidad es importante para nosotros. Por favor revisa nuestra Política de Privacidad, que también rige tu uso del servicio, para entender nuestras prácticas.",
      
      termination: "Terminación",
      terminationDesc: "Podemos terminar o suspender tu cuenta y prohibir el acceso al servicio inmediatamente, sin previo aviso o responsabilidad, bajo nuestra única discreción, por cualquier motivo, incluyendo sin limitación si violas los términos.",
      
      disclaimers: "Descargos de Responsabilidad",
      disclaimersDesc: "El servicio se proporciona 'TAL COMO ESTÁ' y 'TAL COMO ESTÁ DISPONIBLE'. MeetingGuard AI no hace garantías, expresas o implícitas, y por la presente renuncia a todas las garantías, incluyendo sin limitación:",
      disclaimersItems: [
        "Que el servicio cumplirá con tus requisitos específicos",
        "Que el servicio será ininterrumpido, oportuno, seguro o libre de errores",
        "Que los resultados obtenidos del uso del servicio serán precisos o confiables",
        "Que la calidad de cualquier producto, servicio, información u otro material cumplirá con tus expectativas"
      ],
      
      limitations: "Limitaciones de Responsabilidad",
      limitationsDesc: "En ningún caso MeetingGuard AI, ni sus directores, empleados, socios, agentes, proveedores o afiliados, será responsable por daños indirectos, incidentales, especiales, consecuentes o punitivos, incluyendo sin limitación, pérdida de ganancias, datos, uso, buena voluntad u otras pérdidas intangibles.",
      
      changes: "Cambios en los Términos",
      changesDesc: "Nos reservamos el derecho de modificar o reemplazar estos términos en cualquier momento. Si una revisión es material, proporcionaremos al menos 30 días de aviso antes de que cualquier nuevo término entre en vigor.",
      
      contact: "Información de Contacto",
      contactDesc: "Si tienes alguna pregunta sobre estos Términos de Servicio, por favor contáctanos en:",
      email: "legal@meetingguard.ai",
      address: "MeetingGuard AI\n123 Innovation Street\nTech City, TC 12345"
    }
  };

  const renderSection = (title, description, items = null) => (
    <Card style={styles.sectionCard}>
      <Card.Content>
        <Title style={styles.sectionTitle}>{title}</Title>
        <Paragraph style={styles.sectionDescription}>{description}</Paragraph>
        
        {items && (
          <View style={styles.itemsList}>
            {items.map((item, index) => (
              <View key={index} style={styles.itemContainer}>
                <MaterialIcons name="check-circle" size={16} color="#10b981" style={styles.itemIcon} />
                <Text style={styles.itemText}>{item}</Text>
              </View>
            ))}
          </View>
        )}
      </Card.Content>
    </Card>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <MaterialIcons name="arrow-back" size={24} color="#1e293b" />
        </TouchableOpacity>
        
        <View style={styles.headerContent}>
          <Title style={styles.title}>{t[language].title}</Title>
          <Paragraph style={styles.subtitle}>{t[language].subtitle}</Paragraph>
          <Text style={styles.lastUpdated}>{t[language].lastUpdated}</Text>
        </View>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {renderSection(t[language].acceptance, t[language].acceptanceDesc)}
        
        {renderSection(
          t[language].serviceDescription,
          t[language].serviceDescriptionDesc,
          t[language].serviceDescriptionItems
        )}
        
        {renderSection(
          t[language].userAccounts,
          t[language].userAccountsDesc,
          t[language].userAccountsItems
        )}
        
        {renderSection(
          t[language].acceptableUse,
          t[language].acceptableUseDesc,
          t[language].acceptableUseItems
        )}
        
        {renderSection(t[language].intellectualProperty, t[language].intellectualPropertyDesc)}
        {renderSection(t[language].privacy, t[language].privacyDesc)}
        {renderSection(t[language].termination, t[language].terminationDesc)}
        
        {renderSection(
          t[language].disclaimers,
          t[language].disclaimersDesc,
          t[language].disclaimersItems
        )}
        
        {renderSection(t[language].limitations, t[language].limitationsDesc)}
        {renderSection(t[language].changes, t[language].changesDesc)}
        
        <Card style={styles.contactCard}>
          <Card.Content>
            <Title style={styles.sectionTitle}>{t[language].contact}</Title>
            <Paragraph style={styles.sectionDescription}>
              {t[language].contactDesc}
            </Paragraph>
            
            <View style={styles.contactInfo}>
              <View style={styles.contactItem}>
                <MaterialIcons name="email" size={20} color="#3b82f6" />
                <Text style={styles.contactText}>{t[language].email}</Text>
              </View>
              
              <View style={styles.contactItem}>
                <MaterialIcons name="location-on" size={20} color="#3b82f6" />
                <Text style={styles.contactText}>{t[language].address}</Text>
              </View>
            </View>
          </Card.Content>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F2F2F7",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 20,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  backButton: {
    marginRight: 16,
    padding: 4,
  },
  headerContent: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: "#64748b",
    marginBottom: 4,
  },
  lastUpdated: {
    fontSize: 12,
    color: "#94a3b8",
    fontStyle: "italic",
  },
  content: {
    flex: 1,
    padding: 20,
  },
  sectionCard: {
    marginBottom: 16,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
    color: "#1e293b",
  },
  sectionDescription: {
    fontSize: 14,
    color: "#64748b",
    marginBottom: 16,
    lineHeight: 20,
  },
  itemsList: {
    gap: 8,
  },
  itemContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 2,
  },
  itemIcon: {
    marginRight: 8,
    marginTop: 2,
  },
  itemText: {
    flex: 1,
    fontSize: 14,
    color: "#374151",
    lineHeight: 20,
  },
  contactCard: {
    marginBottom: 20,
    elevation: 2,
  },
  contactInfo: {
    marginTop: 16,
    gap: 12,
  },
  contactItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  contactText: {
    marginLeft: 8,
    fontSize: 14,
    color: "#374151",
    flex: 1,
  },
});