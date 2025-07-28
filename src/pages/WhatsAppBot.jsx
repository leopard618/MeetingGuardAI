import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Linking,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Card, Button } from 'react-native-paper';

export default function WhatsAppBot({ language = "en" }) {
  const navigation = useNavigation();
  const [isLoading, setIsLoading] = useState(false);

  const t = {
    en: {
      title: "WhatsApp Bot",
      subtitle: "Schedule meetings quickly via WhatsApp",
      description: "Send a message to our WhatsApp bot to create meetings on the go. Perfect for quick scheduling when you're busy.",
      features: [
        "Natural language processing",
        "Quick meeting creation",
        "Available 24/7",
        "Works from anywhere"
      ],
      startChat: "Start WhatsApp Chat",
      backToDashboard: "Back to Dashboard",
      comingSoon: "Coming Soon",
      notAvailable: "WhatsApp Bot is not available yet. Please use the manual creation method or AI Assistant.",
      openWhatsApp: "Open WhatsApp",
      whatsAppNumber: "+1234567890"
    },
    es: {
      title: "Bot de WhatsApp",
      subtitle: "Agenda reuniones rápidamente vía WhatsApp",
      description: "Envía un mensaje a nuestro bot de WhatsApp para crear reuniones sobre la marcha. Perfecto para agendar rápidamente cuando estés ocupado.",
      features: [
        "Procesamiento de lenguaje natural",
        "Creación rápida de reuniones",
        "Disponible 24/7",
        "Funciona desde cualquier lugar"
      ],
      startChat: "Iniciar Chat de WhatsApp",
      backToDashboard: "Volver al Panel",
      comingSoon: "Próximamente",
      notAvailable: "El Bot de WhatsApp no está disponible aún. Por favor usa el método de creación manual o el Asistente IA.",
      openWhatsApp: "Abrir WhatsApp",
      whatsAppNumber: "+1234567890"
    }
  };

  const handleBack = () => {
    navigation.navigate('Dashboard');
  };

  const handleWhatsApp = async () => {
    setIsLoading(true);
    try {
      const url = `whatsapp://send?phone=${t[language].whatsAppNumber}&text=Hello! I want to schedule a meeting.`;
      const supported = await Linking.canOpenURL(url);
      
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert(
          "WhatsApp Not Available",
          "Please install WhatsApp or use a different method to create meetings.",
          [
            { text: "OK", onPress: () => setIsLoading(false) },
            { text: "Manual Creation", onPress: () => {
              setIsLoading(false);
              navigation.navigate('CreateMeeting');
            }}
          ]
        );
      }
    } catch (error) {
      console.error('Error opening WhatsApp:', error);
      Alert.alert("Error", "Could not open WhatsApp. Please try again.");
    }
    setIsLoading(false);
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Button
            mode="text"
            onPress={handleBack}
            style={styles.backButton}
            icon="arrow-left"
          >
            {t[language].backToDashboard}
          </Button>
          
          <Text style={styles.title}>{t[language].title}</Text>
          <Text style={styles.subtitle}>{t[language].subtitle}</Text>
        </View>

        <Card style={styles.mainCard}>
          <Card.Content style={styles.cardContent}>
            <View style={styles.iconContainer}>
              <Ionicons name="logo-whatsapp" size={64} color="#25D366" />
            </View>
            
            <Text style={styles.description}>{t[language].description}</Text>
            
            <View style={styles.featuresContainer}>
              {t[language].features.map((feature, index) => (
                <View key={index} style={styles.featureItem}>
                  <Ionicons name="checkmark-circle" size={20} color="#25D366" />
                  <Text style={styles.featureText}>{feature}</Text>
                </View>
              ))}
            </View>

            <View style={styles.actionsContainer}>
              <Button
                mode="contained"
                onPress={handleWhatsApp}
                loading={isLoading}
                disabled={isLoading}
                style={styles.whatsappButton}
                icon="logo-whatsapp"
              >
                {t[language].startChat}
              </Button>
              
              <Button
                mode="outlined"
                onPress={() => navigation.navigate('CreateMeeting')}
                style={styles.manualButton}
                icon="create"
              >
                Manual Creation
              </Button>
            </View>
          </Card.Content>
        </Card>

        <Card style={styles.infoCard}>
          <Card.Content>
            <View style={styles.infoHeader}>
              <Ionicons name="information-circle" size={24} color="#3B82F6" />
              <Text style={styles.infoTitle}>{t[language].comingSoon}</Text>
            </View>
            <Text style={styles.infoText}>{t[language].notAvailable}</Text>
          </Card.Content>
        </Card>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  content: {
    padding: 16,
    paddingTop: 20,
  },
  header: {
    marginBottom: 24,
  },
  backButton: {
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1E293B',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#64748B',
    lineHeight: 24,
  },
  mainCard: {
    marginBottom: 16,
    backgroundColor: '#FFFFFF',
  },
  cardContent: {
    padding: 24,
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: 16,
  },
  description: {
    fontSize: 16,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 24,
  },
  featuresContainer: {
    width: '100%',
    marginBottom: 24,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  featureText: {
    fontSize: 14,
    color: '#374151',
    marginLeft: 12,
  },
  actionsContainer: {
    width: '100%',
    gap: 12,
  },
  whatsappButton: {
    backgroundColor: '#25D366',
    marginBottom: 8,
  },
  manualButton: {
    borderColor: '#8B5CF6',
  },
  infoCard: {
    backgroundColor: '#EFF6FF',
    borderColor: '#3B82F6',
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1E40AF',
    marginLeft: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
});