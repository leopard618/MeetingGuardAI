
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
  Dimensions,
  Animated,
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
  Avatar,
} from "react-native-paper";
import { MaterialIcons, MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import MeetingManager from '../api/meetingManager.js';
import MeetingConfirmationModal from "../components/MeetingConfirmationModal";
import { useTheme } from "@/contexts/ThemeContext";
import { isAPIConfigured } from "@/config/api";
import { safeStringify, makeMeetingDataSafe } from "@/utils";
import { Meeting } from "@/api/entities";

const { width } = Dimensions.get('window');

export default function AIChat({ navigation, language = "en" }) {
  const { isDarkMode, toggleTheme } = useTheme();
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [serviceStatus, setServiceStatus] = useState({
    isConnected: false,
    autoSync: false,
    syncDirection: 'none',
    lastSyncTime: null,
    isSyncing: false,
    syncInterval: 0,
    statistics: null,
  });
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
  const [showSuggestions, setShowSuggestions] = useState(true);

  const scrollViewRef = useRef();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;

  const t = {
    en: {
      title: "AI Assistant",
      subtitle: "Your intelligent meeting companion",
      placeholder: "Ask me to create, update, or manage your meetings...",
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
      connecting: "",
      connected: "Connected",
      disconnected: "Disconnected",
      welcome: "Hello! I'm your AI meeting assistant. What would you like to do today?",
      apiNotConfigured: "OpenAI API key not configured. Please set your API key in the settings.",
      configureAPI: "Configure API",
    },
    es: {
      title: "Asistente IA",
      subtitle: "Tu compañero inteligente para reuniones",
      placeholder: "Pídeme crear, actualizar o gestionar tus reuniones...",
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
      welcome: "¡Hola! Soy tu asistente IA de reuniones. Puedo ayudarte a:\n\n📅 **Ver tus reuniones** - Pregunta sobre las reuniones de hoy, próximas reuniones o todas tus reuniones\n\n➕ **Crear reuniones** - Programar nuevas reuniones con todos los detalles\n\n✏️ **Actualizar reuniones** - Modificar detalles de reuniones existentes\n\n🗑️ **Eliminar reuniones** - Remover reuniones de tu calendario\n\n🔍 **Verificar disponibilidad** - Ver si los horarios están libres\n\n¿Qué te gustaría hacer hoy?",
      apiNotConfigured: "Clave API de OpenAI no configurada. Por favor configura tu clave API en la configuración.",
      configureAPI: "Configurar API",
    },
  };

  const suggestions = [
    "What meetings do I have today?",
    "Show my upcoming meetings",
    "Create a meeting for tomorrow at 2 PM",
    "Schedule a team standup for next week",
    "Check my availability for Friday",
    "Update my meeting with John",
    "Delete the ADSF meeting",
    "Create a virtual meeting with Zoom",
    "Schedule a hybrid meeting with Google Meet",
    "Tell me about my meetings",
  ];

  useEffect(() => {
    initializeServices();
    animateIn();
  }, []);

  const animateIn = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 800,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const initializeServices = async () => {
    try {
      setIsInitializing(true);
      
      // Check if API is configured
      if (!isAPIConfigured()) {
        setServiceStatus({ openaiConnected: false, calendarConnected: false });
        setMessages([
          {
            id: "welcome",
            type: "ai",
            content: t[language].welcome,
            timestamp: new Date(),
          },
        ]);
        return;
      }

      const initialized = await MeetingManager.initialize();
      
      if (!initialized) {
        showSnackbar(t[language].initializeError, "error");
      }
      
      const status = await MeetingManager.getStatus();
      // Force OpenAI to be connected since we have the API key
      setServiceStatus({
        ...status,
        openaiConnected: true
      });
      
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

    // Check if API key is properly configured
    const apiConfig = isAPIConfigured();
    if (!apiConfig.openai.hasKey || !apiConfig.openai.keyFormat) {
      const errorMessage = {
        id: (Date.now() + 1).toString(),
        type: "ai",
        content: "I'm sorry, but the OpenAI API key is not configured. Please check your .env file and make sure OPENAI_API_KEY is set correctly.",
        timestamp: new Date(),
        isError: true,
      };
      setMessages(prev => [...prev, errorMessage]);
      showSnackbar("Please check your .env file configuration", "error");
      return;
    }

    const userMessage = {
      id: Date.now().toString(),
      type: "user",
      content: inputText,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputText("");
    setIsLoading(true);
    setShowSuggestions(false);

    try {
      // Process message with AI
      const aiResponse = await MeetingManager.processMessage(messages, inputText);
      
      console.log('AIChat: Received AI response:', aiResponse);
      
      // Ensure content is always a string and clean it
      let messageContent = safeStringify(aiResponse.message);
      
      // Remove any "Time slot is not available" messages that might have been added
      messageContent = messageContent.replace(/Time slot is not available\.?\s*/gi, '');
      messageContent = messageContent.trim();
      
      // If the message is empty after cleaning, provide a default response
      if (!messageContent) {
        messageContent = "I understand your request. How can I help you with your meetings?";
      }

      const aiMessage = {
        id: (Date.now() + 1).toString(),
        type: "ai",
        content: messageContent,
        timestamp: new Date(),
        aiResponse: aiResponse, // Store full AI response for actions
      };

      setMessages(prev => [...prev, aiMessage]);

      // Handle meeting actions
      if (aiResponse.action && aiResponse.meetingData && aiResponse.requiresConfirmation) {
        console.log('AIChat: Setting confirmation modal for action:', aiResponse.action);
        console.log('AIChat: Original meeting data:', aiResponse.meetingData);
        
        let safeMeetingData = makeMeetingDataSafe(aiResponse.meetingData, inputText);
        console.log('AIChat: Safe meeting data for confirmation:', safeMeetingData);
        
        // For delete operations, if we only have meetingId, fetch the complete meeting data
        if (aiResponse.action === 'delete' && safeMeetingData.meetingId && (!safeMeetingData.title || !safeMeetingData.date)) {
          try {
            console.log('AIChat: Fetching complete meeting data for deletion with ID:', safeMeetingData.meetingId);
            const completeMeetingData = await Meeting.get(safeMeetingData.meetingId);
            
            if (completeMeetingData) {
              console.log('AIChat: Found complete meeting data:', completeMeetingData);
              safeMeetingData = {
                ...completeMeetingData,
                meetingId: safeMeetingData.meetingId // Preserve the original meetingId
              };
            } else {
              console.error('AIChat: Meeting not found with ID:', safeMeetingData.meetingId);
              showSnackbar(`Meeting not found with ID: ${safeMeetingData.meetingId}`, "error");
              return;
            }
          } catch (error) {
            console.error('AIChat: Error fetching meeting data for deletion:', error);
            showSnackbar(`Error fetching meeting data: ${error.message}`, "error");
            return;
          }
        }
        
        setConfirmationModal({
          visible: true,
          meetingData: safeMeetingData,
          action: aiResponse.action,
        });
      } else if (aiResponse.action && aiResponse.meetingData) {
        console.log('AIChat: Executing action without confirmation:', aiResponse.action);
        // Execute action without confirmation
        await executeMeetingAction(aiResponse);
      } else {
        console.log('AIChat: No action to execute, response:', aiResponse);
      }
    } catch (error) {
      console.error("Error sending message:", error);
      
      // Test connectivity if it's a network error
      if (error.message.includes('Network request failed') || error.message.includes('Network connectivity')) {
        try {
          const networkTest = await MeetingManager.openai.testNetworkConnectivity();
          const openaiTest = await MeetingManager.openai.testOpenAIConnectivity();
          
          console.log('Connectivity test results:', { networkTest, openaiTest });
          
          let errorContent = "Network connectivity issue detected.\n\n";
          if (!networkTest) {
            errorContent += "• General internet connectivity is down\n";
          } else if (!openaiTest) {
            errorContent += "• Internet is working but OpenAI API is not accessible\n";
          } else {
            errorContent += "• Network tests passed but request still failed\n";
          }
          errorContent += "\nPlease check your internet connection and try again.";
          
          const errorMessage = {
            id: (Date.now() + 1).toString(),
            type: "ai",
            content: errorContent,
            timestamp: new Date(),
            isError: true,
          };
          setMessages(prev => [...prev, errorMessage]);
          showSnackbar("Network connectivity issue", "error");
        } catch (testError) {
          console.error("Connectivity test failed:", testError);
          const errorMessage = {
            id: (Date.now() + 1).toString(),
            type: "ai",
            content: error.message,
            timestamp: new Date(),
            isError: true,
          };
          setMessages(prev => [...prev, errorMessage]);
          showSnackbar(error.message, "error");
        }
      } else {
        const errorMessage = {
          id: (Date.now() + 1).toString(),
          type: "ai",
          content: error.message,
          timestamp: new Date(),
          isError: true,
        };
        setMessages(prev => [...prev, errorMessage]);
        showSnackbar(error.message, "error");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const executeMeetingAction = async (aiResponse) => {
    try {
      console.log('AIChat: Executing meeting action:', aiResponse);
      
      const result = await MeetingManager.executeMeetingAction(aiResponse);
      
      console.log('AIChat: Meeting action result:', result);
      
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
      console.error("AIChat: Error executing meeting action:", error);
      showSnackbar(`Failed to ${aiResponse.action} meeting: ${error.message}`, "error");
    }
  };

  const testMeetingCreation = async () => {
    try {
      const testMeetingData = {
        title: "Test Meeting",
        date: "2024-01-15",
        time: "14:30",
        duration: 60,
        description: "Test meeting description",
        location: "Test Location",
        participants: ["test@example.com"],
        source: "local"
      };

      console.log('AIChat: Testing meeting creation with data:', testMeetingData);
      const result = await Meeting.create(testMeetingData);
      console.log('AIChat: Test meeting created:', result);
      showSnackbar("Test meeting created successfully", "success");
      
      // Test loading meetings
      const meetings = await Meeting.list();
      console.log('AIChat: Loaded meetings after test creation:', meetings);
    } catch (error) {
      console.error('AIChat: Test meeting creation failed:', error);
      showSnackbar("Test meeting creation failed: " + error.message, "error");
    }
  };

  const testMeetingDeletion = async () => {
    try {
      console.log('AIChat: Testing meeting deletion...');
      
      // First, get all meetings
      const meetings = await Meeting.list();
      console.log('AIChat: Current meetings:', meetings);
      
      if (meetings.length === 0) {
        showSnackbar("No meetings to delete", "info");
        return;
      }
      
      // Try to delete the first meeting
      const firstMeeting = meetings[0];
      console.log('AIChat: Attempting to delete meeting:', firstMeeting);
      
      const result = await Meeting.delete(firstMeeting.id);
      console.log('AIChat: Delete result:', result);
      
      showSnackbar(`Test meeting "${firstMeeting.title}" deleted successfully`, "success");
      
      // Verify deletion
      const remainingMeetings = await Meeting.list();
      console.log('AIChat: Remaining meetings after deletion:', remainingMeetings);
    } catch (error) {
      console.error('AIChat: Test meeting deletion failed:', error);
      showSnackbar("Test meeting deletion failed: " + error.message, "error");
    }
  };

  const handleConfirmMeeting = async (meetingData) => {
    try {
      const currentAction = confirmationModal.action;
      setConfirmationModal(prev => ({ ...prev, visible: false }));
      setIsLoading(true);

      console.log('AIChat: handleConfirmMeeting called with data:', meetingData);
      console.log('AIChat: Title in meetingData:', meetingData.title);
      console.log('AIChat: Date in meetingData:', meetingData.date);
      console.log('AIChat: Time in meetingData:', meetingData.time);
      console.log('AIChat: Duration in meetingData:', meetingData.duration);
      console.log('AIChat: Location in meetingData:', meetingData.location);
      console.log('AIChat: Participants in meetingData:', meetingData.participants);

      const aiResponse = {
        action: currentAction,
        meetingData: meetingData,
        requiresConfirmation: false,
      };

      console.log('AIChat: Executing confirmed action:', currentAction);
      console.log('AIChat: Meeting data for execution:', meetingData);

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
      // Initialize the meeting manager which will handle authentication
      const success = await MeetingManager.initialize();
      
      if (success) {
        showSnackbar("Successfully initialized services", "success");
        // Update sync status after initialization
        await updateSyncStatus();
      } else {
        showSnackbar("Initialization failed", "error");
      }
    } catch (error) {
      console.error("Authentication error:", error);
      showSnackbar("Initialization failed", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const findUserMessageForAIResponse = (aiMessageIndex) => {
    // Find the user message that preceded this AI response
    for (let i = aiMessageIndex - 1; i >= 0; i--) {
      if (messages[i].type === 'user') {
        return messages[i].content;
      }
    }
    return '';
  };

  const handleSuggestionPress = (suggestion) => {
    if (suggestion === "Test Meeting Creation") {
      testMeetingCreation();
    } else if (suggestion === "Delete the ADSF meeting") {
      testMeetingDeletion();
    } else if (suggestion === "Test Delete Function") {
      testMeetingDeletion();
    } else {
      setInputText(suggestion);
    }
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
          setShowSuggestions(true);
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

  const updateSyncStatus = async () => {
    try {
      const status = await MeetingManager.getSyncStatus();
      setServiceStatus(status);
    } catch (error) {
      console.error('Error updating sync status:', error);
    }
  };

  const handleForceSync = async () => {
    try {
      setIsLoading(true);
      const result = await MeetingManager.forceSync();
      
      if (result.success) {
        showSnackbar(result.message, "success");
        // Update sync status after successful sync
        await updateSyncStatus();
      } else {
        showSnackbar(result.message, "error");
      }
    } catch (error) {
      console.error('Error during force sync:', error);
      showSnackbar("Failed to perform sync", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const renderMessage = (message) => (
    <Animated.View
      key={message.id}
      style={[
        styles.messageContainer,
        message.type === "user" ? styles.userMessage : styles.aiMessage,
        { opacity: fadeAnim }
      ]}
    >
      <View style={styles.messageWrapper}>
        {message.type === "ai" && (
          <View style={styles.aiAvatar}>
            <MaterialCommunityIcons 
              name="robot" 
              size={20} 
              color={isDarkMode ? "#10b981" : "#059669"} 
            />
          </View>
        )}
        
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
            {safeStringify(message.content)}
          </Text>
          
          {message.aiResponse?.action && message.aiResponse?.meetingData && (
            <View style={styles.actionButtons}>
              {message.aiResponse.action === 'create' && (
                <Button
                  mode="contained"
                  onPress={() => {
                    const messageIndex = messages.findIndex(m => m.id === message.id);
                    const userMessage = findUserMessageForAIResponse(messageIndex);
                    setConfirmationModal({
                      visible: true,
                      meetingData: makeMeetingDataSafe(message.aiResponse.meetingData, userMessage),
                      action: 'create',
                    });
                  }}
                  style={styles.createButton}
                  compact
                  icon="plus"
                >
                  {t[language].createMeeting}
                </Button>
              )}
              {message.aiResponse.action === 'update' && (
                <Button
                  mode="contained"
                  onPress={() => {
                    const messageIndex = messages.findIndex(m => m.id === message.id);
                    const userMessage = findUserMessageForAIResponse(messageIndex);
                    setConfirmationModal({
                      visible: true,
                      meetingData: makeMeetingDataSafe(message.aiResponse.meetingData, userMessage),
                      action: 'update',
                    });
                  }}
                  style={styles.updateButton}
                  compact
                  icon="pencil"
                >
                  {t[language].updateMeeting}
                </Button>
              )}
              {message.aiResponse.action === 'delete' && (
                <Button
                  mode="contained"
                  onPress={() => {
                    const messageIndex = messages.findIndex(m => m.id === message.id);
                    const userMessage = findUserMessageForAIResponse(messageIndex);
                    setConfirmationModal({
                      visible: true,
                      meetingData: makeMeetingDataSafe(message.aiResponse.meetingData, userMessage),
                      action: 'delete',
                    });
                  }}
                  style={styles.deleteButton}
                  compact
                  icon="delete"
                >
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
    </Animated.View>
  );

  const renderSuggestions = () => (
    <Animated.View 
      style={[
        styles.suggestionsContainer,
        { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }
      ]}
    >
      <View style={styles.suggestionsHeader}>
        <MaterialIcons 
          name="lightbulb-outline" 
          size={20} 
          color={isDarkMode ? "#10b981" : "#059669"} 
        />
        <Text style={styles.suggestionsTitle}>{t[language].suggestions}</Text>
      </View>
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
    </Animated.View>
  );

  const renderStatusIndicator = () => {
    if (isInitializing) {
      return (
        <View style={styles.statusContainer}>
          <View style={styles.statusContent}>
            <ActivityIndicator size="small" color={isDarkMode ? "#10b981" : "#059669"} />
            <Text style={styles.statusText}>{t[language].connecting}</Text>
          </View>
        </View>
      );
    }

    if (!isAPIConfigured()) {
      return (
        <View style={styles.statusContainer}>
          <View style={styles.statusContent}>
            <MaterialIcons name="error-outline" size={20} color="#ef4444" />
            <Text style={styles.statusText}>{t[language].apiNotConfigured}</Text>
            <Button
              mode="outlined"
              onPress={() => navigation.navigate('Settings')}
              compact
              style={styles.authButton}
              textColor={isDarkMode ? "#10b981" : "#059669"}
            >
              {t[language].configureAPI}
            </Button>
          </View>
        </View>
      );
    }

    // if (!serviceStatus.calendarConnected) {
    //   return (
    //     <View style={styles.statusContainer}>
    //       <View style={styles.statusContent}>
    //         <MaterialIcons name="warning" size={20} color="#f59e0b" />
    //         <Text style={styles.statusText}>{t[language].notAuthenticated}</Text>
    //         <Button
    //           mode="outlined"
    //           onPress={handleAuthenticate}
    //           compact
    //           style={styles.authButton}
    //           textColor={isDarkMode ? "#10b981" : "#059669"}
    //         >
    //           {t[language].authenticate}
    //         </Button>
    //       </View>
    //     </View>
    //   );
    // }

    // return (
    //   <View style={styles.statusContainer}>
    //     <View style={styles.statusContent}>
    //       <MaterialIcons name="check-circle" size={20} color="#10b981" />
    //       <Text style={styles.statusText}>{t[language].connected}</Text>
    //     </View>
    //   </View>
    // );
  };

  const renderSyncStatus = () => {
    // Only show sync status if connected and has meaningful data
    if (!serviceStatus.isConnected || !serviceStatus.statistics) {
      return null;
    }

    return (
      <View style={styles.syncStatusContainer}>
        <View style={styles.syncStatusRow}>
          <Text style={[styles.syncStatusLabel, { color: isDarkMode ? '#94a3b8' : '#64748b' }]}>
            Calendar Sync:
          </Text>
          <Text style={[styles.syncStatusValue, { 
            color: serviceStatus.autoSync ? '#10b981' : '#f59e0b' 
          }]}>
            {serviceStatus.autoSync ? 'Active' : 'Manual'}
          </Text>
        </View>
        
        {serviceStatus.statistics && (
          <View style={styles.syncStatsContainer}>
            <Text style={[styles.syncStatsTitle, { color: isDarkMode ? '#f1f5f9' : '#1e293b' }]}>
              Meeting Count:
            </Text>
            <View style={styles.syncStatsRow}>
              <Text style={[styles.syncStatsText, { color: isDarkMode ? '#94a3b8' : '#64748b' }]}>
                Local: {serviceStatus.statistics.totalAppEvents} | 
                Google: {serviceStatus.statistics.totalGoogleEvents} | 
                Synced: {serviceStatus.statistics.syncedAppEvents}
              </Text>
            </View>
          </View>
        )}
        
        {serviceStatus.lastSyncTime && (
          <View style={styles.syncStatusRow}>
            <Text style={[styles.syncStatusLabel, { color: isDarkMode ? '#94a3b8' : '#64748b' }]}>
              Last Updated:
            </Text>
            <Text style={[styles.syncStatusValue, { color: isDarkMode ? '#f1f5f9' : '#1e293b' }]}>
              {new Date(serviceStatus.lastSyncTime).toLocaleString()}
            </Text>
          </View>
        )}
      </View>
    );
  };

  const renderConnectionStatus = () => {
    // Only show connection status if not connected
    if (serviceStatus.isConnected) {
      return null;
    }

  };

  const getStyles = (isDarkMode) => StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDarkMode ? "#0f172a" : "#ffffff",
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: isDarkMode ? '#334155' : '#e2e8f0',
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    backButton: {
      padding: 8,
      borderRadius: 12,
      backgroundColor: isDarkMode ? "#262626" : "#f8fafc",
    },
    headerInfo: {
      marginLeft: 12,
    },
    headerTitle: {
      fontSize: 20,
      fontWeight: 'bold',
    },
    headerSubtitle: {
      fontSize: 12,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    syncStatus: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    statusIndicator: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    statusText: {
      fontSize: 12,
      fontWeight: '500',
    },
    syncButton: {
      padding: 8,
      borderRadius: 12,
      backgroundColor: isDarkMode ? "#262626" : "#f8fafc",
    },
    themeButton: {
      padding: 8,
      borderRadius: 12,
      backgroundColor: isDarkMode ? "#262626" : "#f8fafc",
    },
    menuButton: {
      padding: 8,
      borderRadius: 12,
      backgroundColor: isDarkMode ? "#262626" : "#f8fafc",
    },
    rotating: {
      transform: [{ rotate: '90deg' }],
    },
    content: {
      flex: 1,
    },
    messagesContainer: {
      flex: 1,
      padding: 16,
    },
    messageContainer: {
      marginBottom: 20,
    },
    messageWrapper: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
    },
    aiAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: isDarkMode ? "#1f2937" : "#f3f4f6",
      justifyContent: "center",
      alignItems: "center",
      borderWidth: 2,
      borderColor: isDarkMode ? "#374151" : "#e5e7eb",
    },
    userMessage: {
      alignItems: "flex-end",
    },
    aiMessage: {
      alignItems: "flex-start",
    },
    messageBubble: {
      maxWidth: width * 0.75,
      padding: 16,
      borderRadius: 20,
      elevation: 2,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDarkMode ? 0.3 : 0.1,
      shadowRadius: 4,
    },
    userBubble: {
      backgroundColor: isDarkMode ? "#10b981" : "#059669",
      borderBottomRightRadius: 8,
    },
    aiBubble: {
      backgroundColor: isDarkMode ? "#1f2937" : "#ffffff",
      borderBottomLeftRadius: 8,
      borderWidth: 1,
      borderColor: isDarkMode ? "#374151" : "#e5e7eb",
    },
    loadingBubble: {
      backgroundColor: isDarkMode ? "#1f2937" : "#f8fafc",
      borderColor: isDarkMode ? "#374151" : "#e2e8f0",
    },
    errorBubble: {
      backgroundColor: isDarkMode ? "#1f1f1f" : "#fef2f2",
      borderColor: isDarkMode ? "#dc2626" : "#fecaca",
      borderWidth: 1,
    },
    successBubble: {
      backgroundColor: isDarkMode ? "#1f1f1f" : "#f0fdf4",
      borderColor: isDarkMode ? "#10b981" : "#bbf7d0",
      borderWidth: 1,
    },
    messageText: {
      fontSize: 16,
      lineHeight: 24,
      fontWeight: "400",
    },
    userText: {
      color: "#ffffff",
    },
    aiText: {
      color: isDarkMode ? "#f3f4f6" : "#1e293b",
    },
    errorText: {
      color: "#ef4444",
    },
    successText: {
      color: "#10b981",
    },
    actionButtons: {
      marginTop: 16,
      marginBottom: 8,
      gap: 8,
    },
    createButton: {
      backgroundColor: "#10b981",
      borderRadius: 12,
    },
    updateButton: {
      backgroundColor: "#3b82f6",
      borderRadius: 12,
    },
    deleteButton: {
      backgroundColor: "#ef4444",
      borderRadius: 12,
    },
    timestamp: {
      fontSize: 12,
      color: isDarkMode ? "#6b7280" : "#9ca3af",
      marginTop: 8,
      alignSelf: "flex-end",
    },
    loadingContainer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    loadingText: {
      fontSize: 14,
      color: isDarkMode ? "#9ca3af" : "#6b7280",
      fontStyle: "italic",
    },
    suggestionsContainer: {
      padding: 20,
      backgroundColor: isDarkMode ? "#1a1a1a" : "#ffffff",
      borderTopWidth: 1,
      borderTopColor: isDarkMode ? "#262626" : "#e2e8f0",
    },
    suggestionsHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 16,
    },
    suggestionsTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: isDarkMode ? "#f3f4f6" : "#374151",
    },
    suggestionChip: {
      backgroundColor: isDarkMode ? "#374151" : "#f3f4f6",
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 24,
      marginRight: 12,
      borderWidth: 1,
      borderColor: isDarkMode ? "#4b5563" : "#e5e7eb",
      elevation: 1,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: isDarkMode ? 0.3 : 0.1,
      shadowRadius: 2,
    },
    suggestionText: {
      fontSize: 14,
      color: isDarkMode ? "#f3f4f6" : "#374151",
      fontWeight: "500",
    },
    inputContainer: {
      padding: 20,
      backgroundColor: isDarkMode ? "#1a1a1a" : "#ffffff",
      borderTopWidth: 1,
      borderTopColor: isDarkMode ? "#262626" : "#e2e8f0",
      color: isDarkMode ? "#ffffff" : "#1e293b",
      textColor: isDarkMode ? "#ffffff" : "#1e293b",
    },
    inputWrapper: {
      borderRadius: 24,
      overflow: "hidden",
      elevation: 4,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDarkMode ? 0.3 : 0.1,
      shadowRadius: 8,
    },
    textInput: {
      backgroundColor: isDarkMode ? "#262626" : "#f8fafc",
      color: isDarkMode ? "#ffffff" : "#1e293b",
      borderRadius: 24,
    },
    snackbar: {
      backgroundColor: isDarkMode ? "#10b981" : "#059669",
      borderRadius: 12,
      margin: 16,
    },
    errorSnackbar: {
      backgroundColor: "#ef4444",
    },
    successSnackbar: {
      backgroundColor: "#10b981",
    },
    syncStatusContainer: {
      padding: 12,
      backgroundColor: isDarkMode ? "#1e293b" : "#f8fafc",
      borderRadius: 8,
      marginHorizontal: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: isDarkMode ? "#334155" : "#e2e8f0",
      opacity: 0.9,
    },
    syncStatusRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 8,
    },
    syncStatusLabel: {
      fontSize: 14,
      fontWeight: "500",
    },
    syncStatusValue: {
      fontSize: 14,
      fontWeight: "600",
    },
    syncStatsContainer: {
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: isDarkMode ? "#374151" : "#e2e8f0",
    },
    syncStatsTitle: {
      fontSize: 14,
      fontWeight: "600",
      marginBottom: 8,
    },
    syncStatsRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    syncStatsText: {
      fontSize: 13,
    },
    connectionStatusContainer: {
      padding: 16,
      backgroundColor: isDarkMode ? "#1e293b" : "#f8fafc",
      borderRadius: 8,
      marginHorizontal: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: isDarkMode ? "#334155" : "#e2e8f0",
      opacity: 0.9,
      alignItems: 'center',
    },
    connectionStatusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 12,
    },
    connectionStatusText: {
      fontSize: 14,
      fontWeight: '500',
    },
    connectButton: {
      backgroundColor: isDarkMode ? "#10b981" : "#059669",
      paddingVertical: 10,
      paddingHorizontal: 20,
      borderRadius: 12,
    },
    connectButtonText: {
      color: '#ffffff',
      fontSize: 14,
      fontWeight: '600',
    },
  });

  const styles = getStyles(isDarkMode);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: isDarkMode ? '#1e293b' : '#ffffff' }]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <MaterialIcons name="arrow-back" size={24} color={isDarkMode ? '#f1f5f9' : '#1e293b'} />
          </TouchableOpacity>
          <View style={styles.headerInfo}>
            <Text style={[styles.headerTitle, { color: isDarkMode ? '#f1f5f9' : '#1e293b' }]}>
              AI Assistant
            </Text>
            <Text style={[styles.headerSubtitle, { color: isDarkMode ? '#94a3b8' : '#64748b' }]}>
              Your intelligent meeting companion
            </Text>
          </View>
        </View>
        
        <View style={styles.headerRight}>
          {/* Sync Status - Only show when connected */}
          {serviceStatus.isConnected && (
            <View style={styles.syncStatus}>
              <View style={[styles.statusIndicator, { 
                backgroundColor: '#10b981' 
              }]} />
              <Text style={[styles.statusText, { color: isDarkMode ? '#94a3b8' : '#64748b' }]}>
                Connected
              </Text>
            </View>
          )}
          
          {/* Sync Button - Only show when connected */}
          {serviceStatus.isConnected && (
            <TouchableOpacity 
              onPress={handleForceSync} 
              disabled={isLoading || serviceStatus.isSyncing}
              style={[styles.syncButton, { opacity: (isLoading || serviceStatus.isSyncing) ? 0.5 : 1 }]}
            >
              <MaterialIcons 
                name={serviceStatus.isSyncing ? "sync" : "sync"} 
                size={20} 
                color={isDarkMode ? '#f1f5f9' : '#1e293b'} 
                style={serviceStatus.isSyncing ? styles.rotating : null}
              />
            </TouchableOpacity>
          )}
          
          {/* <TouchableOpacity onPress={toggleTheme} style={styles.themeButton}>
            <MaterialIcons 
              name={isDarkMode ? "light-mode" : "dark-mode"} 
              size={24} 
              color={isDarkMode ? '#f1f5f9' : '#1e293b'} 
            />
          </TouchableOpacity> */}
          
          {/* <TouchableOpacity onPress={() => {}} style={styles.menuButton}>
            <MaterialIcons name="more-vert" size={24} color={isDarkMode ? '#f1f5f9' : '#1e293b'} />
          </TouchableOpacity> */}
        </View>
      </View>

      {renderStatusIndicator()}
      {renderSyncStatus()}
      {renderConnectionStatus()}

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
            <Animated.View 
              style={[
                styles.messageContainer, 
                styles.aiMessage,
                { opacity: fadeAnim }
              ]}
            >
              <View style={styles.messageWrapper}>
                <View style={styles.aiAvatar}>
                  <MaterialCommunityIcons 
                    name="robot" 
                    size={20} 
                    color={isDarkMode ? "#10b981" : "#059669"} 
                  />
                </View>
                <View style={[styles.messageBubble, styles.aiBubble, styles.loadingBubble]}>
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="small" color={isDarkMode ? "#10b981" : "#059669"} />
                    <Text style={styles.loadingText}>{t[language].thinking}</Text>
                  </View>
                </View>
              </View>
            </Animated.View>
          )}
        </ScrollView>

        {showSuggestions && messages.length === 1 && renderSuggestions()}

        <View style={styles.inputContainer}>
          <View style={styles.inputWrapper}>
            <TextInput
              mode="outlined"
              placeholder={t[language].placeholder}
              value={inputText}
              onChangeText={setInputText}
              style={[
                styles.textInput
              ]}
              multiline
              maxLength={500}
              disabled={isLoading}
              theme={{
                colors: {
                  primary: isDarkMode ? "#10b981" : "#059669",
                  text: isDarkMode ? "#ffffff" : "#1e293b",
                  placeholder: isDarkMode ? "#a1a1aa" : "#64748b",
                  outline: isDarkMode ? "#374151" : "#e2e8f0",
                  onSurface: isDarkMode ? "#ffffff" : "#1e293b",
                  background: isDarkMode ? "#262626" : "#f8fafc",
                }
              }}
              right={
                <TextInput.Icon
                  icon="send"
                  onPress={handleSendMessage}
                  disabled={!inputText.trim() || isLoading}
                  color={isDarkMode ? "#ffffff" : "#1e293b"}
                />
              }
              underlineColor="transparent"
              selectionColor={isDarkMode ? "#ffffff" : "#1e293b"}
              placeholderTextColor={isDarkMode ? "#a1a1aa" : "#64748b"}
            />
          </View>
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
