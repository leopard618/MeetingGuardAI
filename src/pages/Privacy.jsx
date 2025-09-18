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
import { useTranslation } from "../components/translations.jsx";

export default function Privacy({ navigation, language = "en" }) {
  const { t } = useTranslation(language);
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
          <Title style={styles.title}>{t('privacy.title')}</Title>
          <Paragraph style={styles.subtitle}>{t('privacy.subtitle')}</Paragraph>
          <Text style={styles.lastUpdated}>{t('privacy.lastUpdated')}</Text>
        </View>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {renderSection(
          t('privacy.dataCollection'),
          t('privacy.dataCollectionDesc'),
          t('privacy.dataCollectionItems')
        )}
        
        {renderSection(
          t('privacy.dataUsage'),
          t('privacy.dataUsageDesc'),
          t('privacy.dataUsageItems')
        )}
        
        {renderSection(
          t('privacy.dataSharing'),
          t('privacy.dataSharingDesc'),
          t('privacy.dataSharingItems')
        )}
        
        {renderSection(
          t('privacy.dataSecurity'),
          t('privacy.dataSecurityDesc'),
          t('privacy.dataSecurityItems')
        )}
        
        {renderSection(
          t('privacy.yourRights'),
          t('privacy.yourRightsDesc'),
          t('privacy.yourRightsItems')
        )}
        
        {renderSection(
          t('privacy.cookies'),
          t('privacy.cookiesDesc'),
          t('privacy.cookiesItems')
        )}
        
        <Card style={styles.contactCard}>
          <Card.Content>
            <Title style={styles.sectionTitle}>{t('privacy.contact')}</Title>
            <Paragraph style={styles.sectionDescription}>
              {t('privacy.contactDesc')}
            </Paragraph>
            
            <View style={styles.contactInfo}>
              <View style={styles.contactItem}>
                <MaterialIcons name="email" size={20} color="#3b82f6" />
                <Text style={styles.contactText}>{t('privacy.email')}</Text>
              </View>
              
              <View style={styles.contactItem}>
                <MaterialIcons name="location-on" size={20} color="#3b82f6" />
                <Text style={styles.contactText}>{t('privacy.address')}</Text>
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
