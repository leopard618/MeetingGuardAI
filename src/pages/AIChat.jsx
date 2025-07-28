
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
} from "react-native-paper";
import { MaterialIcons, MaterialCommunityIcons } from "@expo/vector-icons";

export default function AIChat({ navigation, language = "en" }) {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions] = useState([
    "Create a meeting for tomorrow at 2 PM",
    "Schedule a team standup for next week",
    "Plan a project review meeting",
    "Set up a client presentation",
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
    },
  };

  useEffect(() => {
    // Add welcome message
    setMessages([
      {
        id: "welcome",
        type: "ai",
        content: "Hello! I'm your AI assistant. I can help you create meetings, schedule appointments, and manage your calendar. What would you like to do today?",
        timestamp: new Date(),
      },
    ]);
  }, []);

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
      // Simulate AI response
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const aiResponse = {
        id: (Date.now() + 1).toString(),
        type: "ai",
        content: generateAIResponse(inputText),
        timestamp: new Date(),
        hasMeetingData: inputText.toLowerCase().includes("meeting") || inputText.toLowerCase().includes("reunión"),
      };

      setMessages(prev => [...prev, aiResponse]);
    } catch (error) {
      console.error("Error sending message:", error);
      Alert.alert("Error", t[language].error);
    } finally {
      setIsLoading(false);
    }
  };

  const generateAIResponse = (userInput) => {
    const input = userInput.toLowerCase();
    
    if (input.includes("meeting") || input.includes("reunión")) {
      return "I can help you create that meeting! I've identified the key details. Would you like me to create a meeting with the following information?\n\n• Title: Team Meeting\n• Date: Tomorrow\n• Time: 2:00 PM\n• Duration: 30 minutes\n• Participants: Team members\n\nTap 'Create Meeting' to proceed.";
    } else if (input.includes("hello") || input.includes("hi") || input.includes("hola")) {
      return "Hello! How can I help you today? I can assist with creating meetings, scheduling appointments, or answering questions about your calendar.";
    } else if (input.includes("help") || input.includes("ayuda")) {
      return "I can help you with:\n• Creating meetings and appointments\n• Scheduling team events\n• Setting up reminders\n• Managing your calendar\n\nJust describe what you need!";
    } else {
      return "I understand you're asking about that. Let me help you create a meeting or schedule an appointment. Could you provide more details about what you'd like to schedule?";
    }
  };

  const handleSuggestionPress = (suggestion) => {
    setInputText(suggestion);
  };

  const handleCreateMeeting = () => {
    Alert.alert(
      "Create Meeting",
      "Would you like to create a meeting based on the AI's suggestions?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Create", onPress: () => {
          Alert.alert(
            "Success",
            t[language].meetingCreated,
            [
              { text: "OK", style: "default" },
              { text: t[language].viewMeeting, onPress: () => navigation.navigate('CreateMeeting') }
            ]
          );
        }}
      ]
    );
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
              content: "Hello! I'm your AI assistant. I can help you create meetings, schedule appointments, and manage your calendar. What would you like to do today?",
              timestamp: new Date(),
            },
          ]);
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
        
        {message.hasMeetingData && message.type === "ai" && (
          <View style={styles.meetingAction}>
            <Button
              mode="contained"
              onPress={handleCreateMeeting}
              style={styles.createMeetingButton}
            >
              <MaterialIcons name="add" size={16} color="white" />
              {t[language].createMeeting}
            </Button>
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
  meetingAction: {
    marginTop: 12,
    marginBottom: 8,
  },
  createMeetingButton: {
    backgroundColor: "#10b981",
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
