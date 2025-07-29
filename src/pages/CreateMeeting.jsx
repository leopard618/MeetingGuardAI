
import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  Alert,
  Platform,
} from "react-native";
import {
  TextInput,
  Button,
  Card,
  Title,
  Paragraph,
  Switch,
  Divider,
  ActivityIndicator,
  Chip,
} from "react-native-paper";
import { MaterialIcons } from "@expo/vector-icons";
import { Meeting } from "@/api/entities";
import aiService from "@/api/aiService";

export default function CreateMeeting({ navigation, language = "en" }) {
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    date: new Date().toISOString().split('T')[0], // YYYY-MM-DD format
    time: new Date().toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    }), // HH:MM format
    duration: "30",
    location: "",
    participants: "",
    preparation_tips: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showAiSuggestions, setShowAiSuggestions] = useState(false);

  const t = {
    en: {
      title: "Create New Meeting",
      subtitle: "Add a new meeting to your schedule",
      meetingTitle: "Meeting Title *",
      description: "Description",
      date: "Date (YYYY-MM-DD) *",
      time: "Time (HH:MM) *",
      duration: "Duration (minutes)",
      location: "Location",
      participants: "Participants (comma separated)",
      preparationTips: "Preparation Tips (one per line)",
      createMeeting: "Create Meeting",
      cancel: "Cancel",
      analyzeWithAI: "Analyze with AI",
      aiAnalysis: "AI Analysis",
      preparationTipsTitle: "Preparation Tips",
      keyTopics: "Key Topics",
      suggestedQuestions: "Suggested Questions",
      meetingType: "Meeting Type",
      durationOptimization: "Duration Optimization",
      engagementSuggestions: "Engagement Suggestions",
      applySuggestions: "Apply AI Suggestions",
      confidence: "Confidence",
      error: "Error",
      success: "Success",
      meetingCreated: "Meeting created successfully!",
      pleaseEnterTitle: "Please enter a meeting title",
      invalidDate: "Please enter a valid date (YYYY-MM-DD format)",
      invalidTime: "Please enter a valid time (HH:MM format, 24-hour)",
      failedToCreate: "Failed to create meeting. Please try again.",
      failedToAnalyze: "Failed to analyze meeting. Please try again.",
    },
    es: {
      title: "Crear Nueva Reunión",
      subtitle: "Añadir una nueva reunión a tu agenda",
      meetingTitle: "Título de la Reunión *",
      description: "Descripción",
      date: "Fecha (YYYY-MM-DD) *",
      time: "Hora (HH:MM) *",
      duration: "Duración (minutos)",
      location: "Ubicación",
      participants: "Participantes (separados por comas)",
      preparationTips: "Consejos de Preparación (uno por línea)",
      createMeeting: "Crear Reunión",
      cancel: "Cancelar",
      analyzeWithAI: "Analizar con IA",
      aiAnalysis: "Análisis de IA",
      preparationTipsTitle: "Consejos de Preparación",
      keyTopics: "Temas Clave",
      suggestedQuestions: "Preguntas Sugeridas",
      meetingType: "Tipo de Reunión",
      durationOptimization: "Optimización de Duración",
      engagementSuggestions: "Sugerencias de Participación",
      applySuggestions: "Aplicar Sugerencias de IA",
      confidence: "Confianza",
      error: "Error",
      success: "Éxito",
      meetingCreated: "¡Reunión creada exitosamente!",
      pleaseEnterTitle: "Por favor ingresa un título para la reunión",
      invalidDate: "Por favor ingresa una fecha válida (formato YYYY-MM-DD)",
      invalidTime: "Por favor ingresa una hora válida (formato HH:MM, 24 horas)",
      failedToCreate: "Error al crear la reunión. Por favor inténtalo de nuevo.",
      failedToAnalyze: "Error al analizar la reunión. Por favor inténtalo de nuevo.",
    },
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const validateDate = (dateString) => {
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date) && date >= new Date().setHours(0, 0, 0, 0);
  };

  const validateTime = (timeString) => {
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    return timeRegex.test(timeString);
  };

  const handleAnalyzeWithAI = async () => {
    if (!formData.title.trim()) {
      Alert.alert(t[language].error, t[language].pleaseEnterTitle);
      return;
    }

    setIsAnalyzing(true);
    try {
      const meetingData = {
        title: formData.title,
        description: formData.description,
        participants: formData.participants ? formData.participants.split(',').map(p => p.trim()) : [],
        duration: parseInt(formData.duration) || 30,
        date: formData.date,
      };

      const analysis = await aiService.analyzeMeeting(meetingData, language);
      setAiAnalysis(analysis);
      setShowAiSuggestions(true);
    } catch (error) {
      console.error("Error analyzing meeting:", error);
      Alert.alert(t[language].error, t[language].failedToAnalyze);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const applyAISuggestions = () => {
    if (!aiAnalysis) return;

    setFormData(prev => ({
      ...prev,
      preparation_tips: aiAnalysis.preparation_tips.join('\n'),
      duration: aiAnalysis.duration_optimization.includes('30') ? '30' : 
                aiAnalysis.duration_optimization.includes('60') ? '60' : 
                aiAnalysis.duration_optimization.includes('45') ? '45' : prev.duration,
    }));

    setShowAiSuggestions(false);
    Alert.alert(t[language].success, "AI suggestions applied successfully!");
  };

  const handleSubmit = async () => {
    if (!formData.title.trim()) {
      Alert.alert(t[language].error, t[language].pleaseEnterTitle);
      return;
    }

    if (!validateDate(formData.date)) {
      Alert.alert(t[language].error, t[language].invalidDate);
      return;
    }

    if (!validateTime(formData.time)) {
      Alert.alert(t[language].error, t[language].invalidTime);
      return;
    }

    setIsLoading(true);
    try {
      const meetingData = {
        title: formData.title,
        description: formData.description,
        date: formData.date,
        time: formData.time,
        duration: parseInt(formData.duration),
        location: formData.location,
        participants: formData.participants,
        preparation_tips: formData.preparation_tips ? 
          formData.preparation_tips.split('\n').filter(tip => tip.trim()) : [],
        source: "Manual",
        confidence: aiAnalysis ? aiAnalysis.confidence : 100,
        created_by: "user@example.com", // This should come from user context
      };

      await Meeting.create(meetingData);
      Alert.alert(
        t[language].success, 
        t[language].meetingCreated,
        [
          {
            text: "OK",
            onPress: () => navigation.goBack()
          }
        ]
      );
    } catch (error) {
      console.error("Error creating meeting:", error);
      Alert.alert(t[language].error, t[language].failedToCreate);
    } finally {
      setIsLoading(false);
    }
  };

  const renderAIAnalysis = () => {
    if (!aiAnalysis) return null;

    return (
      <Card style={styles.aiCard}>
        <Card.Content>
          <View style={styles.aiHeader}>
            <MaterialIcons name="psychology" size={24} color="#8B5CF6" />
            <Title style={styles.aiTitle}>{t[language].aiAnalysis}</Title>
            <Chip mode="outlined" style={styles.confidenceChip}>
              {aiAnalysis.confidence}% {t[language].confidence}
            </Chip>
          </View>

          <View style={styles.aiSection}>
            <Text style={styles.sectionTitle}>{t[language].preparationTipsTitle}</Text>
            {aiAnalysis.preparation_tips.map((tip, index) => (
              <Text key={index} style={styles.tipText}>• {tip}</Text>
            ))}
          </View>

          <View style={styles.aiSection}>
            <Text style={styles.sectionTitle}>{t[language].keyTopics}</Text>
            {aiAnalysis.key_topics.map((topic, index) => (
              <Text key={index} style={styles.tipText}>• {topic}</Text>
            ))}
          </View>

          <View style={styles.aiSection}>
            <Text style={styles.sectionTitle}>{t[language].suggestedQuestions}</Text>
            {aiAnalysis.suggested_questions.map((question, index) => (
              <Text key={index} style={styles.tipText}>• {question}</Text>
            ))}
          </View>

          <View style={styles.aiSection}>
            <Text style={styles.sectionTitle}>{t[language].meetingType}</Text>
            <Text style={styles.tipText}>{aiAnalysis.meeting_type}</Text>
          </View>

          <View style={styles.aiSection}>
            <Text style={styles.sectionTitle}>{t[language].durationOptimization}</Text>
            <Text style={styles.tipText}>{aiAnalysis.duration_optimization}</Text>
          </View>

          <View style={styles.aiSection}>
            <Text style={styles.sectionTitle}>{t[language].engagementSuggestions}</Text>
            {aiAnalysis.engagement_suggestions.map((suggestion, index) => (
              <Text key={index} style={styles.tipText}>• {suggestion}</Text>
            ))}
          </View>

          <Button
            mode="contained"
            onPress={applyAISuggestions}
            style={styles.applyButton}
            icon="check"
          >
            {t[language].applySuggestions}
          </Button>
        </Card.Content>
      </Card>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Title style={styles.headerTitle}>{t[language].title}</Title>
          <Paragraph style={styles.headerSubtitle}>
            {t[language].subtitle}
          </Paragraph>
        </View>

        <Card style={styles.formCard}>
          <Card.Content>
            <TextInput
              label={t[language].meetingTitle}
              value={formData.title}
              onChangeText={(text) => handleInputChange('title', text)}
              style={styles.input}
              mode="outlined"
            />

            <TextInput
              label={t[language].description}
              value={formData.description}
              onChangeText={(text) => handleInputChange('description', text)}
              style={styles.input}
              mode="outlined"
              multiline
              numberOfLines={3}
            />

            <View style={styles.row}>
              <View style={styles.halfWidth}>
                <TextInput
                  label={t[language].date}
                  value={formData.date}
                  onChangeText={(text) => handleInputChange('date', text)}
                  style={styles.input}
                  mode="outlined"
                  placeholder="2024-01-15"
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.halfWidth}>
                <TextInput
                  label={t[language].time}
                  value={formData.time}
                  onChangeText={(text) => handleInputChange('time', text)}
                  style={styles.input}
                  mode="outlined"
                  placeholder="14:30"
                  keyboardType="numeric"
                />
              </View>
            </View>

            <View style={styles.row}>
              <View style={styles.halfWidth}>
                <TextInput
                  label={t[language].duration}
                  value={formData.duration}
                  onChangeText={(text) => handleInputChange('duration', text)}
                  style={styles.input}
                  mode="outlined"
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.halfWidth}>
                <TextInput
                  label={t[language].location}
                  value={formData.location}
                  onChangeText={(text) => handleInputChange('location', text)}
                  style={styles.input}
                  mode="outlined"
                />
              </View>
            </View>

            <TextInput
              label={t[language].participants}
              value={formData.participants}
              onChangeText={(text) => handleInputChange('participants', text)}
              style={styles.input}
              mode="outlined"
              placeholder="john@example.com, jane@example.com"
            />

            <TextInput
              label={t[language].preparationTips}
              value={formData.preparation_tips}
              onChangeText={(text) => handleInputChange('preparation_tips', text)}
              style={styles.input}
              mode="outlined"
              multiline
              numberOfLines={4}
              placeholder="Review agenda\nPrepare slides\nTest equipment"
            />

            <Button
              mode="outlined"
              onPress={handleAnalyzeWithAI}
              loading={isAnalyzing}
              disabled={isAnalyzing || !formData.title.trim()}
              style={styles.analyzeButton}
              icon="brain"
            >
              {t[language].analyzeWithAI}
            </Button>
          </Card.Content>
        </Card>

        {showAiSuggestions && renderAIAnalysis()}

        <View style={styles.buttonContainer}>
          <Button
            mode="contained"
            onPress={handleSubmit}
            loading={isLoading}
            disabled={isLoading}
            style={styles.submitButton}
            contentStyle={styles.submitButtonContent}
          >
            {t[language].createMeeting}
          </Button>
          
          <Button
            mode="outlined"
            onPress={() => navigation.goBack()}
            style={styles.cancelButton}
          >
            {t[language].cancel}
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F2F2F7",
  },
  scrollView: {
    flex: 1,
  },
  header: {
    padding: 20,
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 8,
  },
  headerSubtitle: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
  },
  formCard: {
    margin: 20,
    elevation: 2,
  },
  input: {
    marginBottom: 16,
  },
  row: {
    flexDirection: "row",
    marginBottom: 16,
  },
  halfWidth: {
    flex: 1,
    marginHorizontal: 4,
  },
  analyzeButton: {
    marginTop: 8,
    borderColor: "#8B5CF6",
  },
  aiCard: {
    margin: 20,
    marginTop: 0,
    backgroundColor: "#F8FAFC",
    borderColor: "#8B5CF6",
    borderWidth: 1,
  },
  aiHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  aiTitle: {
    flex: 1,
    marginLeft: 8,
    fontSize: 18,
  },
  confidenceChip: {
    borderColor: "#8B5CF6",
  },
  aiSection: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#1E293B",
    marginBottom: 8,
  },
  tipText: {
    fontSize: 14,
    color: "#475569",
    lineHeight: 20,
    marginBottom: 4,
  },
  applyButton: {
    backgroundColor: "#8B5CF6",
    marginTop: 8,
  },
  buttonContainer: {
    padding: 20,
    gap: 12,
  },
  submitButton: {
    marginBottom: 8,
  },
  submitButtonContent: {
    height: 48,
  },
  cancelButton: {
    height: 48,
  },
});
