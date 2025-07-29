
import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import {
  Card,
  Title,
  Paragraph,
  Button,
  TextInput,
  ActivityIndicator,
  FAB,
  Chip,
  Menu,
  Divider,
} from "react-native-paper";
import { MaterialIcons, MaterialCommunityIcons } from "@expo/vector-icons";
import aiService from "@/api/aiService";
import { Meeting } from "@/api/entities";

export default function AIChat({ navigation, language = "en" }) {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationHistory, setConversationHistory] = useState([]);
  const [detectedLanguage, setDetectedLanguage] = useState(language);
  const [showLanguageMenu, setShowLanguageMenu] = useState(false);
  const [currentContext, setCurrentContext] = useState({});
  const [suggestions] = useState([
    "Create a meeting for tomorrow at 2 PM",
    "Schedule a team standup for next week",
    "Plan a project review meeting",
    "Set up a client presentation",
    "Analyze my meeting schedule",
    "Translate this meeting description",
  ]);

  const scrollViewRef = useRef();

  const t = {
    en: {
      title: "AI Chat",
      subtitle: "Create meetings with AI assistance",
      placeholder: "Describe the meeting you want to create...",
      send: "Send",
      createMeeting: "Create Meeting",
      suggestions: "Quick suggestions:",
      thinking: "AI is thinking...",
      error: "Error communicating with AI",
      retry: "Retry",
      clear: "Clear Chat",
      confirmClear: "Are you sure you want to clear the chat?",
      meetingCreated: "Meeting created successfully!",
      viewMeeting: "View Meeting",
      language: "Language",
      translate: "Translate",
      analyze: "Analyze",
      optimize: "Optimize",
      detectLanguage: "Detect Language",
      meetingAnalysis: "Meeting Analysis",
      preparationTips: "Preparation Tips",
      optimizationSuggestions: "Optimization Suggestions",
    },
    es: {
      title: "Chat IA",
      subtitle: "Crea reuniones con asistencia de IA",
      placeholder: "Describe la reunión que quieres crear...",
      send: "Enviar",
      createMeeting: "Crear Reunión",
      suggestions: "Sugerencias rápidas:",
      thinking: "La IA está pensando...",
      error: "Error al comunicarse con la IA",
      retry: "Reintentar",
      clear: "Limpiar Chat",
      confirmClear: "¿Estás seguro de que quieres limpiar el chat?",
      meetingCreated: "¡Reunión creada exitosamente!",
      viewMeeting: "Ver Reunión",
      language: "Idioma",
      translate: "Traducir",
      analyze: "Analizar",
      optimize: "Optimizar",
      detectLanguage: "Detectar Idioma",
      meetingAnalysis: "Análisis de Reunión",
      preparationTips: "Consejos de Preparación",
      optimizationSuggestions: "Sugerencias de Optimización",
    },
  };

  useEffect(() => {
    // Add welcome message
    const welcomeMessage = {
      id: "welcome",
      type: "ai",
      content: language === "es" 
        ? "¡Hola! Soy tu asistente de IA. Puedo ayudarte a crear reuniones, programar citas y gestionar tu calendario. ¿En qué puedo ayudarte hoy?"
        : "Hello! I'm your AI assistant. I can help you create meetings, schedule appointments, and manage your calendar. What would you like to do today?",
      timestamp: new Date(),
    };
    setMessages([welcomeMessage]);
  }, [language]);

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;

    const userMessage = {
      id: Date.now().toString(),
      type: "user",
      content: inputText,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputText("");
    setIsLoading(true);

    try {
      // Detect language if not already set
      if (detectedLanguage === language) {
        const langDetection = await aiService.detectLanguage(inputText);
        setDetectedLanguage(langDetection.language);
      }

      // Update conversation history
      const updatedHistory = [
        ...conversationHistory,
        { role: 'user', content: inputText }
      ];
      setConversationHistory(updatedHistory);

      // Get AI response with context
      const aiResponse = await aiService.chatWithAI(
        inputText, 
        updatedHistory, 
        detectedLanguage, 
        currentContext
      );

      const aiMessage = {
        id: (Date.now() + 1).toString(),
        type: "ai",
        content: aiResponse,
        timestamp: new Date(),
        hasMeetingData: inputText.toLowerCase().includes("meeting") || 
                       inputText.toLowerCase().includes("reunión") ||
                       aiResponse.toLowerCase().includes("meeting") ||
                       aiResponse.toLowerCase().includes("reunión"),
        actions: getMessageActions(inputText, aiResponse),
      };

      setMessages(prev => [...prev, aiMessage]);
      
      // Update conversation history with AI response
      setConversationHistory([
        ...updatedHistory,
        { role: 'assistant', content: aiResponse }
      ]);

    } catch (error) {
      console.error("Error sending message:", error);
      Alert.alert("Error", t[language].error);
    } finally {
      setIsLoading(false);
    }
  };

  const getMessageActions = (userInput, aiResponse) => {
    const actions = [];
    const input = userInput.toLowerCase();
    const response = aiResponse.toLowerCase();

    if (input.includes("meeting") || input.includes("reunión") || 
        response.includes("meeting") || response.includes("reunión")) {
      actions.push("createMeeting");
    }

    if (input.includes("translate") || input.includes("traducir")) {
      actions.push("translate");
    }

    if (input.includes("analyze") || input.includes("analizar")) {
      actions.push("analyze");
    }

    if (input.includes("optimize") || input.includes("optimizar")) {
      actions.push("optimize");
    }

    return actions;
  };

  const handleCreateMeetingFromChat = async (messageContent) => {
    try {
      setIsLoading(true);
      
      const meetingData = await aiService.createMeetingFromText(
        messageContent, 
        detectedLanguage
      );

      if (meetingData) {
        const meeting = await Meeting.create({
          ...meetingData,
          source: "AI Chat",
          confidence: meetingData.confidence || 85,
          created_by: "user@example.com",
        });

        Alert.alert(
          "Success",
          t[language].meetingCreated,
          [
            { text: "OK", style: "default" },
            { text: t[language].viewMeeting, onPress: () => navigation.navigate('Dashboard') }
          ]
        );
      }
    } catch (error) {
      console.error("Error creating meeting:", error);
      Alert.alert("Error", "Failed to create meeting");
    } finally {
      setIsLoading(false);
    }
  };

  const handleTranslate = async (text) => {
    try {
      setIsLoading(true);
      const targetLang = detectedLanguage === 'en' ? 'es' : 'en';
      const translation = await aiService.translateText(
        text, 
        targetLang, 
        detectedLanguage, 
        'meeting'
      );
      
      const translationMessage = {
        id: Date.now().toString(),
        type: "ai",
        content: `Translation (${targetLang}): ${translation}`,
        timestamp: new Date(),
      };
      
      setMessages(prev => [...prev, translationMessage]);
    } catch (error) {
      console.error("Error translating:", error);
      Alert.alert("Error", "Failed to translate text");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnalyzeMeeting = async (text) => {
    try {
      setIsLoading(true);
      
      // Extract meeting info from text
      const meetingData = await aiService.createMeetingFromText(text, detectedLanguage);
      
      if (meetingData) {
        const analysis = await aiService.analyzeMeeting(meetingData, detectedLanguage);
        
        const analysisMessage = {
          id: Date.now().toString(),
          type: "ai",
          content: `**${t[language].meetingAnalysis}**\n\n` +
                   `Confidence: ${analysis.confidence}%\n\n` +
                   `**${t[language].preparationTips}:**\n` +
                   analysis.preparation_tips.map(tip => `• ${tip}`).join('\n') + '\n\n' +
                   `**Key Topics:**\n` +
                   analysis.key_topics.map(topic => `• ${topic}`).join('\n') + '\n\n' +
                   `**Suggested Questions:**\n` +
                   analysis.suggested_questions.map(q => `• ${q}`).join('\n'),
          timestamp: new Date(),
        };
        
        setMessages(prev => [...prev, analysisMessage]);
      }
    } catch (error) {
      console.error("Error analyzing meeting:", error);
      Alert.alert("Error", "Failed to analyze meeting");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestionPress = (suggestion) => {
    setInputText(suggestion);
  };

  const handleClearChat = () => {
    Alert.alert(
      "Clear Chat",
      t[language].confirmClear,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Clear", style: "destructive", onPress: () => {
          setMessages([
            {
              id: "welcome",
              type: "ai",
              content: language === "es" 
                ? "¡Hola! Soy tu asistente de IA. ¿En qué puedo ayudarte hoy?"
                : "Hello! I'm your AI assistant. What can I help you with today?",
              timestamp: new Date(),
            },
          ]);
          setConversationHistory([]);
          setCurrentContext({});
        }}
      ]
    );
  };

  const renderMessage = (message) => (
    <View
      key={message.id}
      style={[
        styles.messageContainer,
        message.type === "user" ? styles.userMessage : styles.aiMessage,
      ]}
    >
      <View
        style={[
          styles.messageBubble,
          message.type === "user" ? styles.userBubble : styles.aiBubble,
        ]}
      >
        <Text style={[
          styles.messageText,
          message.type === "user" ? styles.userText : styles.aiText,
        ]}>
          {message.content}
        </Text>
        
        {message.actions && message.actions.length > 0 && (
          <View style={styles.messageActions}>
            {message.actions.includes("createMeeting") && (
              <Button
                mode="contained"
                onPress={() => handleCreateMeetingFromChat(message.content)}
                style={styles.actionButton}
                compact
              >
                <MaterialIcons name="add" size={16} color="white" />
                {t[language].createMeeting}
              </Button>
            )}
            {message.actions.includes("translate") && (
              <Button
                mode="outlined"
                onPress={() => handleTranslate(message.content)}
                style={styles.actionButton}
                compact
              >
                <MaterialIcons name="translate" size={16} color="#3b82f6" />
                {t[language].translate}
              </Button>
            )}
            {message.actions.includes("analyze") && (
              <Button
                mode="outlined"
                onPress={() => handleAnalyzeMeeting(message.content)}
                style={styles.actionButton}
                compact
              >
                <MaterialIcons name="analytics" size={16} color="#10b981" />
                {t[language].analyze}
              </Button>
            )}
          </View>
        )}
        
        <Text style={styles.timestamp}>
          {message.timestamp.toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
          })}
        </Text>
      </View>
    </View>
  );

  const renderSuggestions = () => (
    <View style={styles.suggestionsContainer}>
      <Text style={styles.suggestionsTitle}>{t[language].suggestions}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {suggestions.map((suggestion, index) => (
          <TouchableOpacity
            key={index}
            onPress={() => handleSuggestionPress(suggestion)}
            style={styles.suggestionChip}
          >
            <Text style={styles.suggestionText}>{suggestion}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
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
        </View>
        
        <Menu
          visible={showLanguageMenu}
          onDismiss={() => setShowLanguageMenu(false)}
          anchor={
            <TouchableOpacity onPress={() => setShowLanguageMenu(true)} style={styles.languageButton}>
              <MaterialIcons name="language" size={24} color="#64748b" />
            </TouchableOpacity>
          }
        >
          <Menu.Item onPress={() => { setDetectedLanguage('en'); setShowLanguageMenu(false); }} title="English" />
          <Menu.Item onPress={() => { setDetectedLanguage('es'); setShowLanguageMenu(false); }} title="Español" />
        </Menu>
        
        <TouchableOpacity onPress={handleClearChat} style={styles.clearButton}>
          <MaterialIcons name="clear-all" size={24} color="#64748b" />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView 
        style={styles.content}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <ScrollView
          ref={scrollViewRef}
          style={styles.messagesContainer}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
        >
          {messages.map(renderMessage)}
          
          {isLoading && (
            <View style={[styles.messageContainer, styles.aiMessage]}>
              <View style={[styles.messageBubble, styles.aiBubble]}>
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color="#3b82f6" />
                  <Text style={styles.loadingText}>{t[language].thinking}</Text>
                </View>
              </View>
            </View>
          )}
        </ScrollView>

        {messages.length === 1 && renderSuggestions()}

        <View style={styles.inputContainer}>
          <TextInput
            mode="outlined"
            placeholder={t[language].placeholder}
            value={inputText}
            onChangeText={setInputText}
            style={styles.textInput}
            multiline
            maxLength={500}
            right={
              <TextInput.Icon
                icon="send"
                onPress={handleSendMessage}
                disabled={!inputText.trim() || isLoading}
              />
            }
          />
        </View>
      </KeyboardAvoidingView>
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
  },
  languageButton: {
    padding: 4,
    marginRight: 8,
  },
  clearButton: {
    padding: 4,
  },
  content: {
    flex: 1,
  },
  messagesContainer: {
    flex: 1,
    padding: 16,
  },
  messageContainer: {
    marginBottom: 16,
  },
  userMessage: {
    alignItems: "flex-end",
  },
  aiMessage: {
    alignItems: "flex-start",
  },
  messageBubble: {
    maxWidth: "80%",
    padding: 12,
    borderRadius: 16,
  },
  userBubble: {
    backgroundColor: "#3b82f6",
    borderBottomRightRadius: 4,
  },
  aiBubble: {
    backgroundColor: "#ffffff",
    borderBottomLeftRadius: 4,
    elevation: 2,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
  },
  userText: {
    color: "#ffffff",
  },
  aiText: {
    color: "#1e293b",
  },
  messageActions: {
    marginTop: 12,
    marginBottom: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  actionButton: {
    marginRight: 8,
  },
  timestamp: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 4,
    alignSelf: "flex-end",
  },
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
    color: "#64748b",
    fontStyle: "italic",
  },
  suggestionsContainer: {
    padding: 16,
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  suggestionsTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 12,
  },
  suggestionChip: {
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  suggestionText: {
    fontSize: 14,
    color: "#374151",
  },
  inputContainer: {
    padding: 16,
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  textInput: {
    backgroundColor: "#ffffff",
  },
});
