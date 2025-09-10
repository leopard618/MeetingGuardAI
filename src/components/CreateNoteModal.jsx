import React, { useState, useEffect } from "react";
import { Button } from './ui\button';
import { Input } from './ui\input';
import { Textarea } from './ui\textarea';
import { Card, CardContent, CardHeader, CardTitle } from './ui\card';
import { Badge } from './ui\badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui\select';
import { Label } from './ui\label';
import { 
  X,
  Plus,
  Trash2,
  Save,
  StickyNote,
  CheckSquare,
  Calendar,
  Tag,
  Circle,
  CheckCircle2
} from "lucide-react-native";
import { motion, AnimatePresence } from "framer-motion";

export default function CreateNoteModal({ 
  isOpen, 
  onClose, 
  onSave, 
  note = null, 
  meetings = [], 
  language = "en" 
}) {
  const [formData, setFormData] = useState({
    title: "",
    content: "",
    type: "note",
    priority: "medium",
    status: "pending",
    due_date: "",
    due_time: "",
    tags: [],
    checklist: [],
    linked_meeting_id: "",
  });

  const [newTag, setNewTag] = useState("");
  const [newChecklistItem, setNewChecklistItem] = useState("");

  const translations = {
    en: {
      createNote: "Create Note/Task",
      editNote: "Edit Note/Task",
      title: "Title",
      titlePlaceholder: "Enter title...",
      content: "Content",
      contentPlaceholder: "Write your note or task details...",
      type: "Type",
      note: "Quick Note",
      task: "Task",
      meetingTask: "Meeting Task",
      priority: "Priority",
      high: "High",
      medium: "Medium",
      low: "Low",
      status: "Status",
      pending: "Pending",
      inProgress: "In Progress",
      completed: "Completed",
      cancelled: "Cancelled",
      dueDate: "Due Date",
      dueTime: "Due Time",
      linkedMeeting: "Link to Meeting",
      selectMeeting: "Select a meeting...",
      tags: "Tags",
      tagsPlaceholder: "Add tag and press Enter...",
      checklist: "Checklist",
      checklistPlaceholder: "Add checklist item...",
      addItem: "Add Item",
      save: "Save",
      cancel: "Cancel"
    },
    es: {
      createNote: "Crear Nota/Tarea",
      editNote: "Editar Nota/Tarea",
      title: "Título",
      titlePlaceholder: "Ingresa el título...",
      content: "Contenido",
      contentPlaceholder: "Escribe los detalles de tu nota o tarea...",
      type: "Tipo",
      note: "Nota Rápida",
      task: "Tarea",
      meetingTask: "Tarea de Reunión",
      priority: "Prioridad",
      high: "Alta",
      medium: "Media",
      low: "Baja",
      status: "Estado",
      pending: "Pendiente",
      inProgress: "En Progreso",
      completed: "Completado",
      cancelled: "Cancelado",
      dueDate: "Fecha de Vencimiento",
      dueTime: "Hora de Vencimiento",
      linkedMeeting: "Vincular a Reunión",
      selectMeeting: "Seleccionar reunión...",
      tags: "Etiquetas",
      tagsPlaceholder: "Agregar etiqueta y presionar Enter...",
      checklist: "Lista de Tareas",
      checklistPlaceholder: "Agregar elemento...",
      addItem: "Agregar",
      save: "Guardar",
      cancel: "Cancelar"
    }
  };

  const tr = translations[language] || translations.en;

  useEffect(() => {
    if (note) {
      setFormData({
        title: note.title || "",
        content: note.content || "",
        type: note.type || "note",
        priority: note.priority || "medium",
        status: note.status || "pending",
        due_date: note.due_date || "",
        due_time: note.due_time || "",
        tags: note.tags || [],
        checklist: note.checklist || [],
        linked_meeting_id: note.linked_meeting_id || "",
      });
    } else {
      // Reset form for new note
      setFormData({
        title: "",
        content: "",
        type: "note",
        priority: "medium",
        status: "pending",
        due_date: "",
        due_time: "",
        tags: [],
        checklist: [],
        linked_meeting_id: "",
      });
    }
  }, [note, isOpen]);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleAddTag = (e) => {
    if (e.key === 'Enter' && newTag.trim()) {
      e.preventDefault();
      if (!formData.tags.includes(newTag.trim())) {
        setFormData(prev => ({
          ...prev,
          tags: [...prev.tags, newTag.trim()]
        }));
      }
      setNewTag("");
    }
  };

  const handleRemoveTag = (tagToRemove) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(tag => tag !== tagToRemove)
    }));
  };

  const handleAddChecklistItem = () => {
    if (newChecklistItem.trim()) {
      setFormData(prev => ({
        ...prev,
        checklist: [...prev.checklist, { text: newChecklistItem.trim(), completed: false }]
      }));
      setNewChecklistItem("");
    }
  };

  const handleRemoveChecklistItem = (index) => {
    setFormData(prev => ({
      ...prev,
      checklist: prev.checklist.filter((_, i) => i !== index)
    }));
  };

  const handleToggleChecklistItem = (index) => {
    setFormData(prev => ({
      ...prev,
      checklist: prev.checklist.map((item, i) => 
        i === index ? { ...item, completed: !item.completed } : item
      )
    }));
  };

  const handleSave = () => {
    if (!formData.title.trim()) return;
    onSave(formData);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 rounded-t-xl">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">
              {note ? tr.editNote : tr.createNote}
            </h2>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Title */}
          <div>
            <Label htmlFor="title" className="text-sm font-medium text-gray-700">
              {tr.title} *
            </Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) => handleInputChange('title', e.target.value)}
              placeholder={tr.titlePlaceholder}
              className="mt-1"
            />
          </div>

          {/* Type and Priority */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-medium text-gray-700">{tr.type}</Label>
              <Select value={formData.type} onValueChange={(value) => handleInputChange('type', value)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="note">
                    <div className="flex items-center gap-2">
                      <StickyNote className="w-4 h-4" />
                      {tr.note}
                    </div>
                  </SelectItem>
                  <SelectItem value="task">
                    <div className="flex items-center gap-2">
                      <CheckSquare className="w-4 h-4" />
                      {tr.task}
                    </div>
                  </SelectItem>
                  <SelectItem value="meeting_task">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      {tr.meetingTask}
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-sm font-medium text-gray-700">{tr.priority}</Label>
              <Select value={formData.priority} onValueChange={(value) => handleInputChange('priority', value)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{tr.low}</SelectItem>
                  <SelectItem value="medium">{tr.medium}</SelectItem>
                  <SelectItem value="high">{tr.high}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Status (only for tasks) */}
          {formData.type !== 'note' && (
            <div>
              <Label className="text-sm font-medium text-gray-700">{tr.status}</Label>
              <Select value={formData.status} onValueChange={(value) => handleInputChange('status', value)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">{tr.pending}</SelectItem>
                  <SelectItem value="in_progress">{tr.inProgress}</SelectItem>
                  <SelectItem value="completed">{tr.completed}</SelectItem>
                  <SelectItem value="cancelled">{tr.cancelled}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Due Date and Time */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-medium text-gray-700">{tr.dueDate}</Label>
              <Input
                type="date"
                value={formData.due_date}
                onChange={(e) => handleInputChange('due_date', e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm font-medium text-gray-700">{tr.dueTime}</Label>
              <Input
                type="time"
                value={formData.due_time}
                onChange={(e) => handleInputChange('due_time', e.target.value)}
                className="mt-1"
              />
            </div>
          </div>

          {/* Linked Meeting */}
          {formData.type === 'meeting_task' && (
            <div>
              <Label className="text-sm font-medium text-gray-700">{tr.linkedMeeting}</Label>
              <Select value={formData.linked_meeting_id} onValueChange={(value) => handleInputChange('linked_meeting_id', value)}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder={tr.selectMeeting} />
                </SelectTrigger>
                <SelectContent>
                  {meetings.map(meeting => (
                    <SelectItem key={meeting.id} value={meeting.id}>
                      {meeting.title} - {meeting.date}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Content */}
          <div>
            <Label className="text-sm font-medium text-gray-700">{tr.content}</Label>
            <Textarea
              value={formData.content}
              onChange={(e) => handleInputChange('content', e.target.value)}
              placeholder={tr.contentPlaceholder}
              rows={4}
              className="mt-1"
            />
          </div>

          {/* Tags */}
          <div>
            <Label className="text-sm font-medium text-gray-700">{tr.tags}</Label>
            <Input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyPress={handleAddTag}
              placeholder={tr.tagsPlaceholder}
              className="mt-1"
            />
            {formData.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {formData.tags.map((tag, index) => (
                  <Badge key={index} variant="secondary" className="flex items-center gap-1">
                    <Tag className="w-3 h-3" />
                    {tag}
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="ml-1 hover:text-red-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Checklist (only for tasks) */}
          {formData.type !== 'note' && (
            <div>
              <Label className="text-sm font-medium text-gray-700">{tr.checklist}</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={newChecklistItem}
                  onChange={(e) => setNewChecklistItem(e.target.value)}
                  placeholder={tr.checklistPlaceholder}
                  onKeyPress={(e) => e.key === 'Enter' && handleAddChecklistItem()}
                />
                <Button type="button" onClick={handleAddChecklistItem} size="icon">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              {formData.checklist.length > 0 && (
                <div className="space-y-2 mt-3">
                  {formData.checklist.map((item, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleChecklistItem(index)}
                        className="flex-shrink-0"
                      >
                        {item.completed ? (
                          <CheckCircle2 className="w-4 h-4 text-green-600" />
                        ) : (
                          <Circle className="w-4 h-4 text-gray-400" />
                        )}
                      </button>
                      <span className={`flex-1 ${item.completed ? 'line-through text-gray-500' : ''}`}>
                        {item.text}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveChecklistItem(index)}
                        className="h-8 w-8 text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 rounded-b-xl">
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={onClose}>
              {tr.cancel}
            </Button>
            <Button 
              onClick={handleSave}
              disabled={!formData.title.trim()}
              className="meeting-gradient text-white"
            >
              <Save className="w-4 h-4 mr-2" />
              {tr.save}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}