import React, { useState, useEffect } from "react";
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
  FAB,
  ActivityIndicator,
  Searchbar,
  Chip,
  TextInput, // <-- Use Paper's TextInput for consistent theming
} from "react-native-paper";
import { MaterialIcons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useTheme } from '../contexts/ThemeContext';
import { useTranslation } from '../components/translations.jsx';

export default function Notes({ navigation, language = "en" }) {
  const { isDarkMode } = useTheme();
  const { t } = useTranslation(language);
  const [notes, setNotes] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [showAddNote, setShowAddNote] = useState(false);
  const [newNote, setNewNote] = useState({
    title: "",
    content: "",
    category: "general",
  });


  useEffect(() => {
    loadNotes();
  }, []);

  const loadNotes = async () => {
    setIsLoading(true);
    try {
      // Simulate loading notes from storage
      const mockNotes = [
        {
          id: "1",
          title: "Meeting Preparation",
          content: "Prepare agenda for Q3 review meeting. Include budget discussion and team updates.",
          category: "work",
          createdAt: new Date(Date.now() - 86400000),
          updatedAt: new Date(),
        },
        {
          id: "2",
          title: "App Ideas",
          content: "Consider building a habit tracker with AI insights and social features.",
          category: "ideas",
          createdAt: new Date(Date.now() - 172800000),
          updatedAt: new Date(),
        },
        {
          id: "3",
          title: "Shopping List",
          content: "Milk, bread, eggs, vegetables, and some snacks for the weekend.",
          category: "personal",
          createdAt: new Date(Date.now() - 259200000),
          updatedAt: new Date(),
        },
      ];
      setNotes(mockNotes);
    } catch (error) {
      console.error("Error loading notes:", error);
      Alert.alert("Error", "Failed to load notes");
    }
    setIsLoading(false);
  };

  const getFilteredNotes = () => {
    let filtered = notes;

    // Filter by search query
    if (searchQuery) {
      filtered = filtered.filter(
        note =>
          note.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          note.content.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Filter by category
    if (selectedCategory !== "all") {
      filtered = filtered.filter(note => note.category === selectedCategory);
    }

    return filtered.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  };

  const formatDate = (date) => {
    try {
      const d = new Date(date);
      return d.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      });
    } catch (error) {
      return 'Invalid date';
    }
  };

  const handleSaveNote = () => {
    if (!newNote.title.trim() || !newNote.content.trim()) {
      Alert.alert("Error", "Please fill in both title and content");
      return;
    }

    const noteToSave = {
      ...newNote,
      id: Date.now().toString(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    setNotes(prev => [noteToSave, ...prev]);
    setNewNote({ title: "", content: "", category: "general" });
    setShowAddNote(false);
    Alert.alert("Success", t('notes.noteSaved'));
  };

  const handleDeleteNote = (noteId) => {
    Alert.alert(
      "Confirm Delete",
      t('notes.deleteConfirm'),
      [
        { text: t('notes.cancel'), style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setNotes(prev => prev.filter(note => note.id !== noteId));
            Alert.alert("Success", t('notes.noteDeleted'));
          },
        },
      ]
    );
  };

  const getCategoryColor = (category) => {
    const colors = {
      general: "#6b7280",
      work: "#3b82f6",
      personal: "#10b981",
      ideas: "#f59e0b",
      tasks: "#ef4444",
    };
    return colors[category] || colors.general;
  };

  const getCategoryIcon = (category) => {
    const icons = {
      general: "note-text",
      work: "work",
      personal: "account-circle",
      ideas: "lightbulb",
      tasks: "checkbox-marked",
    };
    return icons[category] || icons.general;
  };

  const renderNoteCard = (note) => (
    <Card key={note.id} style={styles.noteCard}>
      <Card.Content>
        <View style={styles.noteHeader}>
          <View style={styles.noteTitleContainer}>
            <Title style={styles.noteTitle}>
              {note.title}
            </Title>
            <Chip
              mode="outlined"
              textStyle={{ color: getCategoryColor(note.category) }}
              style={[styles.categoryChip, { borderColor: getCategoryColor(note.category) }]}
            >
              {t(`notes.categories.${note.category}`)}
            </Chip>
          </View>
          <View style={styles.noteActions}>
            <TouchableOpacity
              onPress={() => {
                setNewNote(note);
                setShowAddNote(true);
              }}
              style={styles.actionButton}
            >
              <MaterialIcons name="edit" size={20} color="#3b82f6" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleDeleteNote(note.id)}
              style={styles.actionButton}
            >
              <MaterialIcons name="delete" size={20} color="#ef4444" />
            </TouchableOpacity>
          </View>
        </View>
        
        <Paragraph style={styles.noteContent} numberOfLines={5}>
          {note.content}
        </Paragraph>
        
        <View style={styles.noteMeta}>
          <View style={styles.metaItem}>
            <MaterialIcons name="schedule" size={14} color="#666" />
            <Text style={styles.metaText}>
              {formatDate(note.updatedAt)}
            </Text>
          </View>
          <View style={styles.metaItem}>
            <MaterialIcons name={getCategoryIcon(note.category)} size={14} color={getCategoryColor(note.category)} />
            <Text style={[styles.metaText, { color: getCategoryColor(note.category) }]}>
              {t(`notes.categories.${note.category}`)}
            </Text>
          </View>
        </View>
      </Card.Content>
    </Card>
  );

  // --- FIX: Use Paper's TextInput for modal, and fix modalContent/modalBody/modalFooter layout ---
  const renderAddNoteModal = () => (
    <View style={styles.modalOverlay}>
      <View style={[styles.modalContent, { backgroundColor: isDarkMode ? "#18181b" : "#ffffff" }]}>
        <View style={styles.modalHeader}>
          <Title style={[styles.modalTitle, { color: isDarkMode ? "#fff" : "#18181b" }]}>
            {newNote.id ? t('notes.editNote') : t('notes.addNote')}
          </Title>
          <TouchableOpacity
            onPress={() => {
              setShowAddNote(false);
              setNewNote({ title: "", content: "", category: "general" });
            }}
          >
            <MaterialIcons name="close" size={24} color={isDarkMode ? "#a1a1aa" : "#666"} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.modalBody}
          contentContainerStyle={{ paddingBottom: 20 }}
          keyboardShouldPersistTaps="handled"
        >
          <TextInput
            label={t('notes.titlePlaceholder')}
            value={newNote.title}
            onChangeText={(text) => setNewNote(prev => ({ ...prev, title: text }))}
            style={[
              styles.input,
              { color: "#fff" } // Force input text color to white
            ]}
            mode="outlined"
            theme={{
              colors: {
                primary: isDarkMode ? "#ffffff" : "#1e293b",
                text: "#fff", // Always white when inputting
                placeholder: isDarkMode ? "#e0e0e0" : "#64748b",
                background: isDarkMode ? "#262626" : "#f8fafc",
              }
            }}
            placeholder={t('notes.titlePlaceholder')}
            placeholderTextColor={isDarkMode ? "#e0e0e0" : "#64748b"}
            autoFocus
          />

          <View style={styles.categorySelector}>
            <Text style={[styles.categoryLabel, { color: isDarkMode ? "#a1a1aa" : "#374151" }]}>Category:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {Object.keys(t('notes.categories')).filter(cat => cat !== 'all').map(category => (
                <TouchableOpacity
                  key={category}
                  onPress={() => setNewNote(prev => ({ ...prev, category }))}
                  style={[
                    styles.categoryOption,
                    newNote.category === category && {
                      backgroundColor: getCategoryColor(category),
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.categoryOptionText,
                      newNote.category === category && { color: "white" },
                    ]}
                  >
                    {t(`notes.categories.${category}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <TextInput
            label={t('notes.contentPlaceholder')}
            value={newNote.content}
            onChangeText={(text) => setNewNote(prev => ({ ...prev, content: text }))}
            style={styles.textArea}
            mode="outlined"
            multiline
            numberOfLines={8}
            theme={{
              colors: {
                primary: isDarkMode ? "#ffffff" : "#1e293b",
                // Make input text much brighter in dark mode
                text: isDarkMode ? "#f8fafc" : "#1e293b",
                placeholder: isDarkMode ? "#e0e0e0" : "#64748b",
                background: isDarkMode ? "#262626" : "#f8fafc",
              }
            }}
            placeholder={t('notes.contentPlaceholder')}
            placeholderTextColor={isDarkMode ? "#e0e0e0" : "#64748b"}
          />
        </ScrollView>

        <View style={styles.modalFooter}>
          <Button
            mode="outlined"
            onPress={() => {
              setShowAddNote(false);
              setNewNote({ title: "", content: "", category: "general" });
            }}
            style={styles.modalButton}
            labelStyle={{ color: isDarkMode ? "#fff" : "#1e293b" }}
          >
            {t('notes.cancel')}
          </Button>
          <Button
            mode="contained"
            onPress={handleSaveNote}
            style={styles.modalButton}
            labelStyle={{ color: "#fff" }}
          >
            {t('notes.save')}
          </Button>
        </View>
      </View>
    </View>
  );
  // --- END FIX ---

  const styles = getStyles(isDarkMode);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Loading notes...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const filteredNotes = getFilteredNotes();

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
          <Title style={styles.title}>{t('notes.title')}</Title>
          <Paragraph style={styles.subtitle}>{t('notes.subtitle')}</Paragraph>
        </View>
      </View>

      <View style={styles.searchContainer}>
        <Searchbar
          placeholder={t('notes.searchPlaceholder')}
          onChangeText={setSearchQuery}
          value={searchQuery}
          style={styles.searchbar}
        />
      </View>

      <View style={styles.categoryFilter}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {Object.keys(t('notes.categories')).map(category => (
            <TouchableOpacity
              key={category}
              onPress={() => setSelectedCategory(category)}
              style={[
                styles.categoryChip,
                selectedCategory === category && {
                  backgroundColor: getCategoryColor(category),
                },
              ]}
            >
              <Text
                style={[
                  styles.categoryChipText,
                  selectedCategory === category && { color: "white" },
                ]}
              >
                {t(`notes.categories.${category}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView style={styles.notesContainer} showsVerticalScrollIndicator={false}>
        {filteredNotes.length > 0 ? (
          filteredNotes.map(renderNoteCard)
        ) : (
          <View style={styles.emptyContainer}>
            <MaterialIcons name="note-add" size={64} color="#ccc" />
            <Text style={styles.emptyTitle}>{t('notes.noNotes')}</Text>
            <Text style={styles.emptySubtext}>{t('notes.noNotesSubtext')}</Text>
            <Button
              mode="contained"
              onPress={() => setShowAddNote(true)}
              style={styles.addFirstNoteButton}
            >
              {t('notes.addNote')}
            </Button>
          </View>
        )}
      </ScrollView>

      <FAB
        icon="plus"
        style={styles.fab}
        onPress={() => setShowAddNote(true)}
        label={t('notes.addNote')}
      />

      {showAddNote && renderAddNoteModal()}
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
  searchContainer: {
    padding: 20,
    backgroundColor: isDarkMode ? "#1a1a1a" : "#ffffff",
  },
  searchbar: {
    elevation: 2,
    backgroundColor: isDarkMode ? "#262626" : "#f8fafc",
  },
  categoryFilter: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: isDarkMode ? "#1a1a1a" : "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: isDarkMode ? "#262626" : "#e2e8f0",
  },
  categoryChip: {
    marginRight: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: isDarkMode ? "#262626" : "#e2e8f0",
    backgroundColor: isDarkMode ? "#262626" : "#f8fafc",
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: "500",
    color: isDarkMode ? "#a1a1aa" : "#64748b",
  },
  notesContainer: {
    flex: 1,
    padding: 20,
  },
  noteCard: {
    marginBottom: 16,
    elevation: 4,
    backgroundColor: isDarkMode ? "#1a1a1a" : "#ffffff",
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDarkMode ? 0.3 : 0.1,
    shadowRadius: 12,
  },
  noteHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  noteTitleContainer: {
    flex: 1,
    marginRight: 12,
  },
  noteTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
    color: isDarkMode ? "#ffffff" : "#1e293b",
  },
  noteActions: {
    flexDirection: "row",
    gap: 8,
  },
  actionButton: {
    padding: 4,
  },
  noteContent: {
    fontSize: 14,
    color: isDarkMode ? "#a1a1aa" : "#374151",
    lineHeight: 20,
    marginBottom: 12,
    fontWeight: "400",
  },
  noteMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  metaText: {
    fontSize: 12,
    color: isDarkMode ? "#a1a1aa" : "#666",
    marginLeft: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: isDarkMode ? "#a1a1aa" : "#64748b",
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: isDarkMode ? "#71717a" : "#94a3b8",
    textAlign: "center",
    marginBottom: 24,
  },
  addFirstNoteButton: {
    marginTop: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: "#64748b",
  },
  fab: {
    position: "absolute",
    margin: 16,
    right: 0,
    bottom: 0,
    backgroundColor: "#3b82f6",
  },
  modalOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
  modalContent: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    width: "90%",
    maxHeight: "80%",
    elevation: 5,
    overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  modalBody: {
    padding: 20,
    backgroundColor: "transparent",
  },
  input: {
    marginBottom: 16,
    backgroundColor: "transparent",
  },
  categorySelector: {
    marginBottom: 16,
  },
  categoryLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: "#374151",
    marginBottom: 8,
  },
  categoryOption: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    marginRight: 8,
  },
  categoryOptionText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#64748b",
  },
  textArea: {
    marginBottom: 16,
    backgroundColor: "transparent",
  },
  modalFooter: {
    flexDirection: "row",
    justifyContent: "flex-end",
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    gap: 12,
    backgroundColor: "transparent",
  },
  modalButton: {
    minWidth: 80,
  },
});