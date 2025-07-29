import React, { useState, useEffect } from "react";
import { Note, Meeting } from "@/api/entities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { 
  Plus, 
  Search, 
  Filter,
  StickyNote, 
  CheckSquare, 
  Calendar,
  Clock,
  Bell,
  Tag,
  Trash2,
  Edit,
  Check,
  X,
  MessageCircle,
  Mail,
  Smartphone,
  AlertTriangle,
  Circle,
  CheckCircle2
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "@/components/translations";
import NoteCard from "../components/NoteCard";
import CreateNoteModal from "../components/CreateNoteModal";
import ReminderSettingsModal from "../components/ReminderSettingsModal";

export default function Notes({ language = "en" }) {
  const [notes, setNotes] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [selectedNote, setSelectedNote] = useState(null);

  const { t } = useTranslation(language);

  const translations = {
    en: {
      title: "Notes & Tasks",
      subtitle: "Your digital brain for ideas, tasks, and reminders",
      createNew: "Create New",
      search: "Search notes and tasks...",
      filterType: "Filter by Type",
      filterPriority: "Priority",
      filterStatus: "Status",
      all: "All",
      note: "Note",
      task: "Task",
      meetingTask: "Meeting Task",
      low: "Low",
      medium: "Medium",
      high: "High",
      pending: "Pending",
      inProgress: "In Progress",
      completed: "Completed",
      cancelled: "Cancelled",
      noNotes: "No notes or tasks yet",
      noNotesSubtext: "Start organizing your thoughts and tasks",
      setupReminders: "Setup Reminders",
      editNote: "Edit Note",
      deleteNote: "Delete Note"
    },
    es: {
      title: "Notas y Tareas",
      subtitle: "Tu cerebro digital para ideas, tareas y recordatorios",
      createNew: "Crear Nuevo",
      search: "Buscar notas y tareas...",
      filterType: "Filtrar por Tipo",
      filterPriority: "Prioridad",
      filterStatus: "Estado",
      all: "Todo",
      note: "Nota",
      task: "Tarea",
      meetingTask: "Tarea de Reunión",
      low: "Baja",
      medium: "Media",
      high: "Alta",
      pending: "Pendiente",
      inProgress: "En Progreso",
      completed: "Completado",
      cancelled: "Cancelado",
      noNotes: "No hay notas o tareas aún",
      noNotesSubtext: "Comienza a organizar tus pensamientos y tareas",
      setupReminders: "Configurar Recordatorios",
      editNote: "Editar Nota",
      deleteNote: "Eliminar Nota"
    }
  };

  const tr = translations[language] || translations.en;

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [notesData, meetingsData] = await Promise.all([
        Note.list("-updated_date"),
        Meeting.list("-created_date")
      ]);
      setNotes(notesData);
      setMeetings(meetingsData);
    } catch (error) {
      console.error("Error loading notes and meetings:", error);
    }
    setIsLoading(false);
  };

  const handleCreateNote = async (noteData) => {
    try {
      await Note.create({
        ...noteData,
        language: language
      });
      loadData();
      setShowCreateModal(false);
    } catch (error) {
      console.error("Error creating note:", error);
    }
  };

  const handleEditNote = async (noteId, noteData) => {
    try {
      await Note.update(noteId, noteData);
      loadData();
      setEditingNote(null);
    } catch (error) {
      console.error("Error updating note:", error);
    }
  };

  const handleDeleteNote = async (noteId) => {
    if (confirm(language === 'es' ? '¿Estás seguro de que quieres eliminar esta nota?' : 'Are you sure you want to delete this note?')) {
      try {
        await Note.delete(noteId);
        loadData();
      } catch (error) {
        console.error("Error deleting note:", error);
      }
    }
  };

  const handleToggleTaskItem = async (noteId, itemIndex) => {
    const note = notes.find(n => n.id === noteId);
    const updatedChecklist = [...note.checklist];
    updatedChecklist[itemIndex].completed = !updatedChecklist[itemIndex].completed;
    
    try {
      await Note.update(noteId, { checklist: updatedChecklist });
      loadData();
    } catch (error) {
      console.error("Error updating checklist:", error);
    }
  };

  const handleSetupReminders = (note) => {
    setSelectedNote(note);
    setShowReminderModal(true);
  };

  const handleSaveReminders = async (noteId, reminders) => {
    try {
      await Note.update(noteId, { reminders });
      loadData();
      setShowReminderModal(false);
      setSelectedNote(null);
    } catch (error) {
      console.error("Error saving reminders:", error);
    }
  };

  const filteredNotes = notes.filter(note => {
    const matchesSearch = note.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         note.content?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = filterType === "all" || note.type === filterType;
    const matchesPriority = filterPriority === "all" || note.priority === filterPriority;
    const matchesStatus = filterStatus === "all" || note.status === filterStatus;
    
    return matchesSearch && matchesType && matchesPriority && matchesStatus;
  });

  const getTypeIcon = (type) => {
    switch (type) {
      case 'task':
        return CheckSquare;
      case 'meeting_task':
        return Calendar;
      default:
        return StickyNote;
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'in_progress':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'cancelled':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-4"
        >
          <h1 className="text-4xl font-bold text-gray-900">{tr.title}</h1>
          <p className="text-lg text-gray-600">{tr.subtitle}</p>
          
          <Button
            onClick={() => setShowCreateModal(true)}
            className="meeting-gradient text-white font-semibold py-3 px-6 shadow-lg hover:shadow-xl transition-all-smooth"
          >
            <Plus className="w-5 h-5 mr-2" />
            {tr.createNew}
          </Button>
        </motion.div>

        {/* Filters */}
        <Card className="glass-effect border-0 shadow-lg">
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row gap-4">
              {/* Search */}
              <div className="flex-1 relative">
                <Search className="w-5 h-5 absolute left-3 top-3 text-gray-400" />
                <Input
                  placeholder={tr.search}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 h-12"
                />
              </div>

              {/* Filters */}
              <div className="flex gap-3">
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder={tr.filterType} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{tr.all}</SelectItem>
                    <SelectItem value="note">{tr.note}</SelectItem>
                    <SelectItem value="task">{tr.task}</SelectItem>
                    <SelectItem value="meeting_task">{tr.meetingTask}</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={filterPriority} onValueChange={setFilterPriority}>
                  <SelectTrigger className="w-32">
                    <SelectValue placeholder={tr.filterPriority} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{tr.all}</SelectItem>
                    <SelectItem value="high">{tr.high}</SelectItem>
                    <SelectItem value="medium">{tr.medium}</SelectItem>
                    <SelectItem value="low">{tr.low}</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="w-32">
                    <SelectValue placeholder={tr.filterStatus} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{tr.all}</SelectItem>
                    <SelectItem value="pending">{tr.pending}</SelectItem>
                    <SelectItem value="in_progress">{tr.inProgress}</SelectItem>
                    <SelectItem value="completed">{tr.completed}</SelectItem>
                    <SelectItem value="cancelled">{tr.cancelled}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notes Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <Card key={i} className="animate-pulse">
                <CardHeader>
                  <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="h-3 bg-gray-200 rounded"></div>
                    <div className="h-3 bg-gray-200 rounded w-2/3"></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredNotes.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <AnimatePresence>
              {filteredNotes.map((note, index) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  language={language}
                  onEdit={setEditingNote}
                  onDelete={handleDeleteNote}
                  onToggleTaskItem={handleToggleTaskItem}
                  onSetupReminders={handleSetupReminders}
                  delay={index}
                />
              ))}
            </AnimatePresence>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-16"
          >
            <div className="w-24 h-24 mx-auto mb-6 bg-gray-100 rounded-full flex items-center justify-center">
              <StickyNote className="w-12 h-12 text-gray-400" />
            </div>
            <h3 className="text-xl font-medium text-gray-900 mb-2">
              {tr.noNotes}
            </h3>
            <p className="text-gray-600 mb-6">
              {tr.noNotesSubtext}
            </p>
            <Button
              onClick={() => setShowCreateModal(true)}
              className="meeting-gradient text-white"
            >
              <Plus className="w-5 h-5 mr-2" />
              {tr.createNew}
            </Button>
          </motion.div>
        )}
      </div>

      {/* Modals */}
      <CreateNoteModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSave={handleCreateNote}
        meetings={meetings}
        language={language}
      />

      {editingNote && (
        <CreateNoteModal
          isOpen={!!editingNote}
          onClose={() => setEditingNote(null)}
          onSave={(data) => handleEditNote(editingNote.id, data)}
          note={editingNote}
          meetings={meetings}
          language={language}
        />
      )}

      {showReminderModal && selectedNote && (
        <ReminderSettingsModal
          isOpen={showReminderModal}
          onClose={() => {
            setShowReminderModal(false);
            setSelectedNote(null);
          }}
          onSave={(reminders) => handleSaveReminders(selectedNote.id, reminders)}
          note={selectedNote}
          language={language}
        />
      )}
    </div>
  );
}