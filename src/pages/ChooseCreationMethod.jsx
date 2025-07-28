import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Card, Button } from 'react-native-paper';

const { width } = Dimensions.get('window');

const MethodCard = ({ onPress, icon, title, description, delay }) => (
  <TouchableOpacity
    style={styles.methodCard}
    onPress={onPress}
    activeOpacity={0.8}
  >
    <Card style={styles.card}>
      <Card.Content style={styles.cardContent}>
        <View style={styles.iconContainer}>
          <Ionicons name={icon} size={32} color="#FFFFFF" />
        </View>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardDescription}>{description}</Text>
      </Card.Content>
    </Card>
  </TouchableOpacity>
);

export default function ChooseCreationMethod({ language = "en" }) {
  const navigation = useNavigation();

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

  const handleManual = () => {
    navigation.navigate('CreateMeeting');
  };

  const handleAI = () => {
    navigation.navigate('AIChat');
  };

  const handleWhatsApp = () => {
    navigation.navigate('WhatsAppBot');
  };

  const handleBack = () => {
    navigation.navigate('Dashboard');
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
            {t[language].back}
          </Button>
          
          <Text style={styles.title}>{t[language].title}</Text>
          <Text style={styles.subtitle}>{t[language].subtitle}</Text>
        </View>
        
        <View style={styles.methodsContainer}>
          <MethodCard 
            onPress={handleManual}
            icon="create-outline"
            title={t[language].manualTitle}
            description={t[language].manualDesc}
            delay={0}
          />
          
          <MethodCard 
            onPress={handleAI}
            icon="bulb-outline"
            title={t[language].aiTitle}
            description={t[language].aiDesc}
            delay={1}
          />
          
          <MethodCard 
            onPress={handleWhatsApp}
            icon="chatbubble-outline"
            title={t[language].whatsappTitle}
            description={t[language].whatsappDesc}
            delay={2}
          />
        </View>
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
    marginBottom: 32,
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
  methodsContainer: {
    gap: 16,
  },
  methodCard: {
    marginBottom: 16,
  },
  card: {
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  cardContent: {
    padding: 24,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1E293B',
    marginBottom: 8,
  },
  cardDescription: {
    fontSize: 14,
    color: '#64748B',
    lineHeight: 20,
  },
});