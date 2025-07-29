
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
  Chip,
  Snackbar,
} from "react-native-paper";
import { MaterialIcons, MaterialCommunityIcons } from "@expo/vector-icons";
import MeetingManager from "../api/meetingManager";
import MeetingConfirmationModal from "../components/MeetingConfirmationModal";

export default function AIChat({ navigation, language = "en" }) {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [serviceStatus, setServiceStatus] = useState({});
  const [confirmationModal, setConfirmationModal] = useState({
    visible: false,
    meetingData: null,
    action: null,
  });
  const [snackbar, setSnackbar] = useState({
    visible: false,
    message: "",
    type: "info",
  });

  const scrollViewRef = useRef();

  const t = {
    en: {
      title: "AI Meeting Assistant",
      subtitle: "Create and manage meetings with AI",
      placeholder: "Describe the meeting you want to create or manage...",
      send: "Send",
      createMeeting: "Create Meeting",
      updateMeeting: "Update Meeting",
      deleteMeeting: "Delete Meeting",
      suggestions: "Quick suggestions:",
      thinking: "AI is thinking...",
      error: "Error communicating with AI",
      retry: "Retry",
      clear: "Clear Chat",
      confirmClear: "Are you sure you want to clear the chat?",
      meetingCreated: "Meeting created successfully!",
      meetingUpdated: "Meeting updated successfully!",
      meetingDeleted: "Meeting deleted successfully!",
      viewMeeting: "View Meeting",
      initializeError: "Failed to initialize services. Please check your configuration.",
      notAuthenticated: "Please authenticate with Google Calendar to manage meetings.",
      authenticate: "Authenticate",
      connecting: "Connecting to services...",
      connected: "Connected",
      disconnected: "Disconnected",
      welcome: "Hello! I'm your AI meeting assistant. I can help you create, update, delete, and manage your meetings. What would you like to do today?",
    },
    es: {
      title: "Asistente IA de Reuniones",
      subtitle: "Crea y gestiona reuniones con IA",
      placeholder: "Describe la reunión que quieres crear o gestionar...",
      send: "Enviar",
      createMeeting: "Crear Reunión",
      updateMeeting: "Actualizar Reunión",
      deleteMeeting: "Eliminar Reunión",
      suggestions: "Sugerencias rápidas:",
      thinking: "La IA está pensando...",
      error: "Error al comunicarse con la IA",
      retry: "Reintentar",
      clear: "Limpiar Chat",
      confirmClear: "¿Estás seguro de que quieres limpiar el chat?",
      meetingCreated: "¡Reunión creada exitosamente!",
      meetingUpdated: "¡Reunión actualizada exitosamente!",
      meetingDeleted: "¡Reunión eliminada exitosamente!",
      viewMeeting: "Ver Reunión",
      initializeError: "Error al inicializar servicios. Por favor verifica tu configuración.",
      notAuthenticated: "Por favor autentícate con Google Calendar para gestionar reuniones.",
      authenticate: "Autenticar",
      connecting: "Conectando a servicios...",
      connected: "Conectado",
      disconnected: "Desconectado",
      welcome: "¡Hola! Soy tu asistente IA de reuniones. Puedo ayudarte a crear, actualizar, eliminar y gestionar tus reuniones. ¿Qué te gustaría hacer hoy?",
    },
  };

  const suggestions = [
    "Create a meeting for tomorrow at 2 PM",
    "Schedule a team standup for next week",
    "Check my availability for Friday",
    "Update my meeting with John",
    "Delete the meeting on Monday",
    "What meetings do I have today?",
  ];

  useEffect(() => {
    initializeServices();
  }, []);

  const initializeServices = async () => {
    try {
      setIsInitializing(true);
      const initialized = await MeetingManager.initialize();
      
      if (!initialized) {
        showSnackbar(t[language].initializeError, "error");
      }
      
      const status = await MeetingManager.getStatus();
      setServiceStatus(status);
      
      // Add welcome message
      setMessages([
        {
          id: "welcome",
          type: "ai",
          content: t[language].welcome,
          timestamp: new Date(),
        },
      ]);
    } catch (error) {
      console.error("Initialization error:", error);
      showSnackbar(t[language].initializeError, "error");
    } finally {
      setIsInitializing(false);
    }
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() || isLoading) return;

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
      // Process message with AI
      const aiResponse = await MeetingManager.processMessage(messages, inputText);
      
      const aiMessage = {
        id: (Date.now() + 1).toString(),
        type: "ai",
        content: aiResponse.message,
        timestamp: new Date(),
        aiResponse: aiResponse, // Store full AI response for actions
      };

      setMessages(prev => [...prev, aiMessage]);

      // Handle meeting actions
      if (aiResponse.action && aiResponse.meetingData && aiResponse.requiresConfirmation) {
        setConfirmationModal({
          visible: true,
          meetingData: aiResponse.meetingData,
          action: aiResponse.action,
        });
      } else if (aiResponse.action && aiResponse.meetingData) {
        // Execute action without confirmation
        await executeMeetingAction(aiResponse);
      }
    } catch (error) {
      console.error("Error sending message:", error);
      const errorMessage = {
        id: (Date.now() + 1).toString(),
        type: "ai",
        content: t[language].error,
        timestamp: new Date(),
        isError: true,
      };
      setMessages(prev => [...prev, errorMessage]);
      showSnackbar(t[language].error, "error");
    } finally {
      setIsLoading(false);
    }
  };

  const executeMeetingAction = async (aiResponse) => {
    try {
      const result = await MeetingManager.executeMeetingAction(aiResponse);
      
      if (result.success) {
        showSnackbar(result.message, "success");
        
        // Add success message to chat
        const successMessage = {
          id: Date.now().toString(),
          type: "ai",
          content: result.message,
          timestamp: new Date(),
          isSuccess: true,
        };
        setMessages(prev => [...prev, successMessage]);
      } else {
        showSnackbar(result.message, "error");
      }
    } catch (error) {
      console.error("Error executing meeting action:", error);
      showSnackbar(`Failed to ${aiResponse.action} meeting: ${error.message}`, "error");
    }
  };

  const handleConfirmMeeting = async (meetingData) => {
    try {
      setConfirmationModal(prev => ({ ...prev, visible: false }));
      setIsLoading(true);

      const aiResponse = {
        action: confirmationModal.action,
        meetingData: meetingData,
        requiresConfirmation: false,
      };

      await executeMeetingAction(aiResponse);
    } catch (error) {
      console.error("Error confirming meeting:", error);
      showSnackbar("Failed to process meeting action", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAuthenticate = async () => {
    try {
      setIsLoading(true);
      const success = await MeetingManager.authenticate();
      
      if (success) {
        showSnackbar("Successfully authenticated with Google Calendar", "success");
        const status = await MeetingManager.getStatus();
        setServiceStatus(status);
      } else {
        showSnackbar("Authentication failed", "error");
      }
    } catch (error) {
      console.error("Authentication error:", error);
      showSnackbar("Authentication failed", "error");
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
              content: t[language].welcome,
              timestamp: new Date(),
            },
          ]);
        }}
      ]
    );
  };

  const showSnackbar = (message, type = "info") => {
    setSnackbar({
      visible: true,
      message,
      type,
    });
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
          message.isError && styles.errorBubble,
          message.isSuccess && styles.successBubble,
        ]}
      >
        <Text style={[
          styles.messageText,
          message.type === "user" ? styles.userText : styles.aiText,
          message.isError && styles.errorText,
          message.isSuccess && styles.successText,
        ]}>
          {message.content}
        </Text>
        
        {message.aiResponse?.action && message.aiResponse?.meetingData && (
          <View style={styles.actionButtons}>
            {message.aiResponse.action === 'create' && (
              <Button
                mode="contained"
                onPress={() => setConfirmationModal({
                  visible: true,
                  meetingData: message.aiResponse.meetingData,
                  action: 'create',
                })}
                style={styles.createButton}
                compact
              >
                <MaterialIcons name="add" size={16} color="white" />
                {t[language].createMeeting}
              </Button>
            )}
            {message.aiResponse.action === 'update' && (
              <Button
                mode="contained"
                onPress={() => setConfirmationModal({
                  visible: true,
                  meetingData: message.aiResponse.meetingData,
                  action: 'update',
                })}
                style={styles.updateButton}
                compact
              >
                <MaterialIcons name="edit" size={16} color="white" />
                {t[language].updateMeeting}
              </Button>
            )}
            {message.aiResponse.action === 'delete' && (
              <Button
                mode="contained"
                onPress={() => setConfirmationModal({
                  visible: true,
                  meetingData: message.aiResponse.meetingData,
                  action: 'delete',
                })}
                style={styles.deleteButton}
                compact
              >
                <MaterialIcons name="delete" size={16} color="white" />
                {t[language].deleteMeeting}
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

  const renderStatusIndicator = () => {
    if (isInitializing) {
      return (
        <View style={styles.statusContainer}>
          <ActivityIndicator size="small" color="#3b82f6" />
          <Text style={styles.statusText}>{t[language].connecting}</Text>
        </View>
      );
    }

    if (!serviceStatus.calendarConnected) {
      return (
        <View style={styles.statusContainer}>
          <MaterialIcons name="warning" size={16} color="#f59e0b" />
          <Text style={styles.statusText}>{t[language].notAuthenticated}</Text>
          <Button
            mode="outlined"
            onPress={handleAuthenticate}
            compact
            style={styles.authButton}
          >
            {t[language].authenticate}
          </Button>
        </View>
      );
    }

    return (
      <View style={styles.statusContainer}>
        <MaterialIcons name="check-circle" size={16} color="#10b981" />
        <Text style={styles.statusText}>{t[language].connected}</Text>
      </View>
    );
  };

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

      {renderStatusIndicator()}

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
            disabled={isLoading || !serviceStatus.openaiConnected}
            right={
              <TextInput.Icon
                icon="send"
                onPress={handleSendMessage}
                disabled={!inputText.trim() || isLoading || !serviceStatus.openaiConnected}
              />
            }
          />
        </View>
      </KeyboardAvoidingView>

      <MeetingConfirmationModal
        visible={confirmationModal.visible}
        onDismiss={() => setConfirmationModal(prev => ({ ...prev, visible: false }))}
        meetingData={confirmationModal.meetingData}
        action={confirmationModal.action}
        onConfirm={handleConfirmMeeting}
        isLoading={isLoading}
        language={language}
      />

      <Snackbar
        visible={snackbar.visible}
        onDismiss={() => setSnackbar(prev => ({ ...prev, visible: false }))}
        duration={3000}
        style={[
          styles.snackbar,
          snackbar.type === 'error' && styles.errorSnackbar,
          snackbar.type === 'success' && styles.successSnackbar,
        ]}
      >
        {snackbar.message}
      </Snackbar>
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
  statusContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    gap: 8,
  },
  statusText: {
    fontSize: 14,
    color: "#64748b",
    flex: 1,
  },
  authButton: {
    marginLeft: 8,
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
  errorBubble: {
    backgroundColor: "#fef2f2",
    borderColor: "#fecaca",
    borderWidth: 1,
  },
  successBubble: {
    backgroundColor: "#f0fdf4",
    borderColor: "#bbf7d0",
    borderWidth: 1,
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
  errorText: {
    color: "#dc2626",
  },
  successText: {
    color: "#16a34a",
  },
  actionButtons: {
    marginTop: 12,
    marginBottom: 8,
    gap: 8,
  },
  createButton: {
    backgroundColor: "#10b981",
  },
  updateButton: {
    backgroundColor: "#3b82f6",
  },
  deleteButton: {
    backgroundColor: "#ef4444",
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
  snackbar: {
    backgroundColor: "#3b82f6",
  },
  errorSnackbar: {
    backgroundColor: "#ef4444",
  },
  successSnackbar: {
    backgroundColor: "#10b981",
  },
});
