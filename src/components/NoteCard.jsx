import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from './ui\card';
import { Button } from './ui\button';
import { Badge } from './ui\badge';
import { 
  StickyNote,
  CheckSquare,
  Calendar,
  Clock,
  Bell,
  Tag,
  Edit,
  Trash2,
  Circle,
  CheckCircle2,
  AlertTriangle,
  MessageCircle,
  Mail,
  Smartphone
} from "lucide-react-native";
import { motion } from "framer-motion";

export default function NoteCard({ 
  note, 
  language = "en", 
  onEdit, 
  onDelete, 
  onToggleTaskItem, 
  onSetupReminders,
  delay = 0 
}) {
  const translations = {
    en: {
      setupReminders: "Setup Reminders",
      edit: "Edit",
      delete: "Delete",
      dueDate: "Due",
      priority: "Priority",
      status: "Status",
      tags: "Tags",
      linkedMeeting: "Linked Meeting",
      checklist: "Checklist",
      reminderActive: "Reminder Active",
      high: "High",
      medium: "Medium",
      low: "Low",
      pending: "Pending",
      inProgress: "In Progress", 
      completed: "Completed",
      cancelled: "Cancelled"
    },
    es: {
      setupReminders: "Configurar Recordatorios",
      edit: "Editar",
      delete: "Eliminar",
      dueDate: "Vence",
      priority: "Prioridad",
      status: "Estado",
      tags: "Etiquetas",
      linkedMeeting: "Reunión Vinculada",
      checklist: "Lista de Tareas",
      reminderActive: "Recordatorio Activo",
      high: "Alta",
      medium: "Media", 
      low: "Baja",
      pending: "Pendiente",
      inProgress: "En Progreso",
      completed: "Completado",
      cancelled: "Cancelado"
    }
  };

  const tr = translations[language] || translations.en;

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

  const TypeIcon = getTypeIcon(note.type);
  
  const hasReminders = note.reminders?.internal?.enabled || 
                      (note.reminders?.external && note.reminders.external.some(r => r.enabled));

  const completedTasks = note.checklist ? note.checklist.filter(item => item.completed).length : 0;
  const totalTasks = note.checklist ? note.checklist.length : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: delay * 0.1 }}
    >
      <Card className="glass-effect border-0 shadow-lg hover:shadow-xl transition-all-smooth h-full">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                <TypeIcon className="w-5 h-5 text-purple-600" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-lg text-gray-900 line-clamp-2">
                  {note.title}
                </CardTitle>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {hasReminders && (
                <div className="w-6 h-6 bg-orange-100 rounded-full flex items-center justify-center" title={tr.reminderActive}>
                  <Bell className="w-3 h-3 text-orange-600" />
                </div>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-gray-400 hover:text-gray-600"
                onClick={() => onEdit(note)}
              >
                <Edit className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-gray-400 hover:text-red-600"
                onClick={() => onDelete(note.id)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={getPriorityColor(note.priority)} variant="outline">
              {tr[note.priority]}
            </Badge>
            {note.type !== 'note' && (
              <Badge className={getStatusColor(note.status)} variant="outline">
                {tr[note.status]}
              </Badge>
            )}
            {note.due_date && (
              <Badge variant="outline" className="text-xs">
                <Clock className="w-3 h-3 mr-1" />
                {note.due_date}
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Content */}
          {note.content && (
            <p className="text-gray-700 text-sm line-clamp-3">
              {note.content}
            </p>
          )}

          {/* Checklist Preview */}
          {note.checklist && note.checklist.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-600">{tr.checklist}</span>
                <span className="text-xs text-gray-500">
                  {completedTasks}/{totalTasks}
                </span>
              </div>
              <div className="space-y-1">
                {note.checklist.slice(0, 3).map((item, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <button
                      onClick={() => onToggleTaskItem(note.id, index)}
                      className="flex-shrink-0"
                    >
                      {item.completed ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                      ) : (
                        <Circle className="w-4 h-4 text-gray-400" />
                      )}
                    </button>
                    <span className={`text-sm ${item.completed ? 'line-through text-gray-500' : 'text-gray-700'}`}>
                      {item.text}
                    </span>
                  </div>
                ))}
                {note.checklist.length > 3 && (
                  <p className="text-xs text-gray-500">
                    +{note.checklist.length - 3} more items
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Tags */}
          {note.tags && note.tags.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <Tag className="w-3 h-3 text-gray-400" />
              {note.tags.slice(0, 3).map((tag, index) => (
                <Badge key={index} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
              {note.tags.length > 3 && (
                <span className="text-xs text-gray-500">+{note.tags.length - 3}</span>
              )}
            </div>
          )}

          {/* External Reminders */}
          {note.reminders?.external && note.reminders.external.some(r => r.enabled) && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">External reminders:</span>
              <div className="flex gap-1">
                {note.reminders.external.map((reminder, index) => {
                  if (!reminder.enabled) return null;
                  const icons = {
                    whatsapp: MessageCircle,
                    email: Mail,
                    sms: Smartphone
                  };
                  const Icon = icons[reminder.channel];
                  return Icon ? (
                    <Icon key={index} className="w-3 h-3 text-blue-500" />
                  ) : null;
                })}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 pt-2 border-t border-gray-100">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs"
              onClick={() => onSetupReminders(note)}
            >
              <Bell className="w-3 h-3 mr-1" />
              {tr.setupReminders}
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}