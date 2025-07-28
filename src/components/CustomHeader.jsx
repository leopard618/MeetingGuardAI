import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

const CustomHeader = ({ title, onMenuPress, showMenu = true }) => {
  const navigation = useNavigation();

  return (
    <View style={styles.header}>
      <View style={styles.headerContent}>
        {/* Logo and Title */}
        <TouchableOpacity
          style={styles.logoContainer}
          onPress={() => navigation.navigate('Dashboard')}
        >
          <Image
            source={{ uri: "https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/816636779_file_00000000800861f89b8e5d3eba90a7691.png" }}
            style={styles.logo}
          />
          <Text style={styles.title}>{title || 'MeetingGuard AI'}</Text>
        </TouchableOpacity>
        {/* Menu Button */}
        {showMenu && (
          <TouchableOpacity
            style={styles.menuButton}
            onPress={onMenuPress}
          >
            <Ionicons name="menu" size={24} color="#1E293B" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 56,
    marginTop:40
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  logo: {
    width: 32,
    height: 32,
    marginRight: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1E293B',
  },
  menuButton: {
    padding: 8,
    borderRadius: 8,
  },
});

export default CustomHeader; 