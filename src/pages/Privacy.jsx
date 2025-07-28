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

export default function Privacy({ navigation, language = "en" }) {
  const t = {
    en: {
      title: "Privacy Policy",
      subtitle: "How we protect your data and privacy",
      lastUpdated: "Last updated: December 2024",
      
      // Sections
      dataCollection: "Data Collection",
      dataCollectionDesc: "We collect only the information necessary to provide our services:",
      dataCollectionItems: [
        "Meeting details (title, date, time, participants)",
        "User preferences and settings",
        "Usage analytics to improve our service",
        "Communication data when you contact us"
      ],
      
      dataUsage: "How We Use Your Data",
      dataUsageDesc: "Your data is used exclusively for:",
      dataUsageItems: [
        "Providing meeting management services",
        "Sending notifications and reminders",
        "Personalizing your experience",
        "Improving our AI capabilities"
      ],
      
      dataSharing: "Data Sharing",
      dataSharingDesc: "We do not sell, trade, or rent your personal information. We may share data only when:",
      dataSharingItems: [
        "Required by law or legal process",
        "Necessary to protect our rights and safety",
        "With your explicit consent",
        "With service providers who assist in our operations"
      ],
      
      dataSecurity: "Data Security",
      dataSecurityDesc: "We implement industry-standard security measures:",
      dataSecurityItems: [
        "End-to-end encryption for sensitive data",
        "Regular security audits and updates",
        "Secure data centers with 99.9% uptime",
        "Access controls and authentication"
      ],
      
      yourRights: "Your Rights",
      yourRightsDesc: "You have the right to:",
      yourRightsItems: [
        "Access your personal data",
        "Correct inaccurate information",
        "Request deletion of your data",
        "Export your data in a portable format",
        "Opt-out of non-essential communications"
      ],
      
      cookies: "Cookies and Tracking",
      cookiesDesc: "We use cookies and similar technologies to:",
      cookiesItems: [
        "Remember your preferences",
        "Analyze usage patterns",
        "Provide personalized content",
        "Ensure security and prevent fraud"
      ],
      
      contact: "Contact Us",
      contactDesc: "If you have questions about this privacy policy, contact us at:",
      email: "privacy@meetingguard.ai",
      address: "MeetingGuard AI\n123 Innovation Street\nTech City, TC 12345"
    },
    es: {
      title: "Política de Privacidad",
      subtitle: "Cómo protegemos tus datos y privacidad",
      lastUpdated: "Última actualización: Diciembre 2024",
      
      dataCollection: "Recopilación de Datos",
      dataCollectionDesc: "Solo recopilamos la información necesaria para brindar nuestros servicios:",
      dataCollectionItems: [
        "Detalles de reuniones (título, fecha, hora, participantes)",
        "Preferencias y configuraciones del usuario",
        "Análisis de uso para mejorar nuestro servicio",
        "Datos de comunicación cuando nos contactas"
      ],
      
      dataUsage: "Cómo Usamos Tus Datos",
      dataUsageDesc: "Tus datos se usan exclusivamente para:",
      dataUsageItems: [
        "Brindar servicios de gestión de reuniones",
        "Enviar notificaciones y recordatorios",
        "Personalizar tu experiencia",
        "Mejorar nuestras capacidades de IA"
      ],
      
      dataSharing: "Compartir Datos",
      dataSharingDesc: "No vendemos, intercambiamos o alquilamos tu información personal. Solo podemos compartir datos cuando:",
      dataSharingItems: [
        "Lo requiera la ley o proceso legal",
        "Sea necesario para proteger nuestros derechos y seguridad",
        "Con tu consentimiento explícito",
        "Con proveedores de servicios que ayudan en nuestras operaciones"
      ],
      
      dataSecurity: "Seguridad de Datos",
      dataSecurityDesc: "Implementamos medidas de seguridad estándar de la industria:",
      dataSecurityItems: [
        "Cifrado de extremo a extremo para datos sensibles",
        "Auditorías de seguridad regulares y actualizaciones",
        "Centros de datos seguros con 99.9% de tiempo de actividad",
        "Controles de acceso y autenticación"
      ],
      
      yourRights: "Tus Derechos",
      yourRightsDesc: "Tienes derecho a:",
      yourRightsItems: [
        "Acceder a tus datos personales",
        "Corregir información inexacta",
        "Solicitar la eliminación de tus datos",
        "Exportar tus datos en formato portable",
        "Optar por no recibir comunicaciones no esenciales"
      ],
      
      cookies: "Cookies y Seguimiento",
      cookiesDesc: "Usamos cookies y tecnologías similares para:",
      cookiesItems: [
        "Recordar tus preferencias",
        "Analizar patrones de uso",
        "Proporcionar contenido personalizado",
        "Asegurar la seguridad y prevenir el fraude"
      ],
      
      contact: "Contáctanos",
      contactDesc: "Si tienes preguntas sobre esta política de privacidad, contáctanos en:",
      email: "privacy@meetingguard.ai",
      address: "MeetingGuard AI\n123 Innovation Street\nTech City, TC 12345"
    }
  };

  const renderSection = (title, description, items) => (
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
        {renderSection(
          t[language].dataCollection,
          t[language].dataCollectionDesc,
          t[language].dataCollectionItems
        )}
        
        {renderSection(
          t[language].dataUsage,
          t[language].dataUsageDesc,
          t[language].dataUsageItems
        )}
        
        {renderSection(
          t[language].dataSharing,
          t[language].dataSharingDesc,
          t[language].dataSharingItems
        )}
        
        {renderSection(
          t[language].dataSecurity,
          t[language].dataSecurityDesc,
          t[language].dataSecurityItems
        )}
        
        {renderSection(
          t[language].yourRights,
          t[language].yourRightsDesc,
          t[language].yourRightsItems
        )}
        
        {renderSection(
          t[language].cookies,
          t[language].cookiesDesc,
          t[language].cookiesItems
        )}
        
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