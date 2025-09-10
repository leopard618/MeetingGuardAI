import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Alert,
} from "react-native";
import {
  Card,
  Title,
  Paragraph,
  Button,
  TextInput,
  ActivityIndicator,
  List,
  Divider,
  Chip,
} from "react-native-paper";
import { MaterialIcons, MaterialCommunityIcons } from "@expo/vector-icons";
import { ApiKey } from '../api/entities';
import React, { useState, useEffect } from "react";
import { useTheme } from '../contexts/ThemeContext';
import * as Clipboard from 'expo-clipboard';

export default function ApiSettings({ navigation, language = "en" }) {
  const { isDarkMode } = useTheme();
  const [apiKeys, setApiKeys] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [copiedKey, setCopiedKey] = useState(null);

  const t = {
    en: {
      title: "API Key Management",
      description: "Generate and manage API keys for your B2B clients.",
      companyName: "Company Name",
      apiKey: "API Key",
      status: "Status",
      usage: "Usage",
      actions: "Actions",
      generate: "Generate New Key",
      revoke: "Revoke",
      active: "Active",
      inactive: "Inactive",
      revoked: "Revoked",
      noKeys: "No API keys found. Generate your first one to get started.",
      confirmRevoke: "Are you sure you want to revoke this key? This action cannot be undone.",
      keyCopied: "API key copied to clipboard",
      enterCompanyName: "Please enter a company name.",
    },
    es: {
      title: "Gestión de Claves API",
      description: "Genera y gestiona las claves de API para tus clientes B2B.",
      companyName: "Nombre de la Empresa",
      apiKey: "Clave de API",
      status: "Estado",
      usage: "Uso",
      actions: "Acciones",
      generate: "Generar Nueva Clave",
      revoke: "Revocar",
      active: "Activa",
      inactive: "Inactiva",
      revoked: "Revocada",
      noKeys: "No se encontraron claves de API. Genera la primera para empezar.",
      confirmRevoke: "¿Estás seguro de que quieres revocar esta clave? Esta acción no se puede deshacer.",
      keyCopied: "Clave API copiada al portapapeles",
      enterCompanyName: "Por favor ingresa un nombre de empresa.",
    },
  };

  useEffect(() => {
    loadApiKeys();
  }, []);

  const loadApiKeys = async () => {
    setIsLoading(true);
    try {
      const keys = await ApiKey.list("-created_date");
      setApiKeys(keys);
    } catch (error) {
      console.error("Error loading API keys:", error);
      Alert.alert("Error", "Failed to load API keys");
    }
    setIsLoading(false);
  };

  const generateApiKey = async () => {
    if (!newCompanyName.trim()) {
      Alert.alert("Error", t[language].enterCompanyName);
      return;
    }
    setIsGenerating(true);
    try {
      const newKey = `mg_sk_${[...Array(32)].map(() => Math.random().toString(36)[2]).join('')}`;
      await ApiKey.create({
        key: newKey,
        company_name: newCompanyName,
        status: "active",
        usage_count: 0,
      });
      setNewCompanyName("");
      await loadApiKeys();
      Alert.alert("Success", "API key generated successfully");
    } catch (error) {
      console.error("Error generating API key:", error);
      Alert.alert("Error", "Failed to generate API key");
    }
    setIsGenerating(false);
  };

  const revokeApiKey = async (id) => {
    Alert.alert(
      "Confirm Revoke",
      t[language].confirmRevoke,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Revoke", style: "destructive", onPress: async () => {
          try {
            await ApiKey.update(id, { status: "revoked" });
            await loadApiKeys();
            Alert.alert("Success", "API key revoked successfully");
          } catch (error) {
            console.error("Error revoking API key:", error);
            Alert.alert("Error", "Failed to revoke API key");
          }
        }},
      ]
    );
  };

  const copyToClipboard = async (key) => {
    try {
      await Clipboard.setStringAsync(key);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
      Alert.alert("Success", t[language].keyCopied);
    } catch (error) {
      console.error("Error copying to clipboard:", error);
      Alert.alert("Error", "Failed to copy to clipboard");
    }
  };

  const renderApiKeyItem = (apiKey) => (
    <Card key={apiKey.id} style={styles.apiKeyCard}>
      <Card.Content>
        <View style={styles.apiKeyHeader}>
          <View style={styles.apiKeyInfo}>
            <Title style={styles.companyName}>{apiKey.company_name}</Title>
            <View style={styles.apiKeyDetails}>
              <Text style={styles.apiKeyText}>
                {`••••••••${apiKey.key.slice(-4)}`}
              </Text>
              <TouchableOpacity
                onPress={() => copyToClipboard(apiKey.key)}
                style={styles.copyButton}
              >
                <MaterialIcons
                  name={copiedKey === apiKey.key ? "check" : "content-copy"}
                  size={20}
                  color={copiedKey === apiKey.key ? "#10b981" : (isDarkMode ? "#a1a1aa" : "#64748b")}
                />
              </TouchableOpacity>
            </View>
          </View>
          
          <View style={styles.apiKeyStatus}>
            <Chip
              mode="outlined"
              style={[
                styles.statusChip,
                apiKey.status === "active" && styles.activeChip,
                apiKey.status === "revoked" && styles.revokedChip,
              ]}
            >
              {t[language][apiKey.status]}
            </Chip>
            <Text style={styles.usageText}>
              {apiKey.usage_count || 0} uses
            </Text>
          </View>
        </View>
        
        {apiKey.status !== "revoked" && (
          <Button
            mode="outlined"
            onPress={() => revokeApiKey(apiKey.id)}
            style={styles.revokeButton}
            textColor="#ef4444"
          >
            <MaterialIcons name="delete" size={16} color="#ef4444" />
            {t[language].revoke}
          </Button>
        )}
      </Card.Content>
    </Card>
  );

  const styles = getStyles(isDarkMode);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Loading API keys...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <MaterialIcons name="arrow-back" size={24} color={isDarkMode ? "#ffffff" : "#1e293b"} />
        </TouchableOpacity>
        
        <View style={styles.headerContent}>
          <Title style={styles.title}>{t[language].title}</Title>
          <Paragraph style={styles.subtitle}>{t[language].description}</Paragraph>
        </View>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <Card style={styles.generateCard}>
          <Card.Content>
            <Title style={styles.sectionTitle}>Generate New API Key</Title>
            <View style={styles.inputContainer}>
              <TextInput
                mode="outlined"
                label={t[language].companyName}
                placeholder={t[language].companyName}
                value={newCompanyName}
                onChangeText={setNewCompanyName}
                style={styles.textInput}
                theme={{
                  colors: {
                    primary: isDarkMode ? "#ffffff" : "#1e293b",
                    text: isDarkMode ? "#ffffff" : "#1e293b",
                    placeholder: isDarkMode ? "#a1a1aa" : "#64748b",
                  }
                }}
              />
              <Button
                mode="contained"
                onPress={generateApiKey}
                loading={isGenerating}
                disabled={isGenerating || !newCompanyName.trim()}
                style={styles.generateButton}
              >
                <MaterialIcons name="add" size={20} color="white" />
                {t[language].generate}
              </Button>
            </View>
          </Card.Content>
        </Card>

        <Card style={styles.keysCard}>
          <Card.Content>
            <Title style={styles.sectionTitle}>Existing API Keys</Title>
            
            {apiKeys.length === 0 ? (
              <View style={styles.emptyContainer}>
                <MaterialIcons name="key" size={48} color={isDarkMode ? "#71717a" : "#ccc"} />
                <Text style={styles.emptyText}>{t[language].noKeys}</Text>
              </View>
            ) : (
              <View style={styles.keysList}>
                {apiKeys.map(renderApiKeyItem)}
              </View>
            )}
          </Card.Content>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (isDarkMode) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: isDarkMode ? "#0a0a0a" : "#F2F2F7",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 24,
    paddingTop: 32,
    backgroundColor: isDarkMode ? "#1a1a1a" : "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: isDarkMode ? "#262626" : "#e2e8f0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDarkMode ? 0.3 : 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  backButton: {
    marginRight: 16,
    padding: 4,
  },
  headerContent: {
    flex: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    marginBottom: 4,
    color: isDarkMode ? "#ffffff" : "#1e293b",
  },
  subtitle: {
    fontSize: 14,
    color: isDarkMode ? "#a1a1aa" : "#64748b",
  },
  content: {
    flex: 1,
    padding: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: isDarkMode ? "#a1a1aa" : "#64748b",
  },
  generateCard: {
    marginBottom: 20,
    elevation: 4,
    backgroundColor: isDarkMode ? "#1a1a1a" : "#ffffff",
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDarkMode ? 0.3 : 0.1,
    shadowRadius: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 16,
    color: isDarkMode ? "#ffffff" : "#1e293b",
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  textInput: {
    flex: 1,
    backgroundColor: isDarkMode ? "#262626" : "#f8fafc",
  },
  generateButton: {
    backgroundColor: "#3b82f6",
    borderRadius: 12,
  },
  keysCard: {
    marginBottom: 20,
    elevation: 4,
    backgroundColor: isDarkMode ? "#1a1a1a" : "#ffffff",
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDarkMode ? 0.3 : 0.1,
    shadowRadius: 12,
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
    color: isDarkMode ? "#a1a1aa" : "#64748b",
    textAlign: "center",
  },
  keysList: {
    gap: 12,
  },
  apiKeyCard: {
    marginBottom: 12,
    elevation: 2,
    backgroundColor: isDarkMode ? "#262626" : "#f8fafc",
    borderRadius: 12,
  },
  apiKeyHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  apiKeyInfo: {
    flex: 1,
  },
  companyName: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
    color: isDarkMode ? "#ffffff" : "#1e293b",
  },
  apiKeyDetails: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  apiKeyText: {
    fontSize: 14,
    fontFamily: "monospace",
    color: isDarkMode ? "#a1a1aa" : "#64748b",
  },
  copyButton: {
    padding: 4,
  },
  apiKeyStatus: {
    alignItems: "flex-end",
  },
  statusChip: {
    marginBottom: 4,
  },
  activeChip: {
    borderColor: "#10b981",
  },
  revokedChip: {
    borderColor: "#ef4444",
  },
  usageText: {
    fontSize: 12,
    color: isDarkMode ? "#a1a1aa" : "#64748b",
  },
  revokeButton: {
    borderColor: "#ef4444",
    alignSelf: "flex-start",
    borderRadius: 12,
  },
});