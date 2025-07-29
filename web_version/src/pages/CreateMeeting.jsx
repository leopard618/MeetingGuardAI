
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Meeting } from "@/api/entities";
import { UploadFile } from "@/api/integrations";
import { ArrowLeft, Video, CheckCircle, Loader2, Send, Users, PlusCircle, Trash2, MapPin, Paperclip, Mail } from "lucide-react"; // Added Mail icon
import { motion } from "framer-motion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ProviderButton = ({ provider, onClick, isLoading, isAdded }) => {
  const providerConfig = {
    Zoom: {
      icon: Video,
      color: "bg-blue-500 hover:bg-blue-600",
      textColor: "text-white"
    },
    Teams: {
      icon: Users,
      color: "bg-purple-600 hover:bg-purple-700",
      textColor: "text-white"
    },
    "Google Meet": {
      icon: Video,
      color: "bg-green-500 hover:bg-green-600",
      textColor: "text-white"
    }
  };

  const Icon = providerConfig[provider].icon;
  const config = providerConfig[provider];

  return (
    <Button
      onClick={onClick}
      disabled={isLoading}
      className={`${config.color} ${config.textColor} flex items-center gap-2 p-4 h-auto ${isAdded ? 'ring-2 ring-green-400' : ''}`}
    >
      {isLoading ? (
        <Loader2 className="w-5 h-5 animate-spin" />
      ) : isAdded ? (
        <CheckCircle className="w-5 h-5" />
      ) : (
        <Icon className="w-5 h-5" />
      )}
      <span className="font-medium">{provider}</span>
    </Button>
  );
};


export default function CreateMeeting({ language = "es" }) {
  const navigate = useNavigate();
  const [meetingDetails, setMeetingDetails] = useState({
    title: "",
    date: "",
    time: "",
    duration: 60,
    description: "",
  });
  const [participants, setParticipants] = useState([{ name: "", email: "" }]);
  const [location, setLocation] = useState({ type: "physical", address: "", virtual_link: null, virtual_provider: null });
  const [attachments, setAttachments] = useState([]);
  const [attachmentSettings, setAttachmentSettings] = useState({}); // Para controlar qué archivos enviar
  const [loadingProvider, setLoadingProvider] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const t = {
    es: {
      title: "Crear Nueva Reunión",
      subtitle: "Completa todos los detalles para una planificación perfecta.",
      meetingTitle: "Título de la Reunión",
      meetingTitlePlaceholder: "Ej: Sincronización Proyecto Q3",
      date: "Fecha",
      time: "Hora",
      duration: "Duración (minutos)",
      description: "Descripción / Agenda",
      descriptionPlaceholder: "Temas a cubrir, notas...",
      participants: "Participantes",
      addParticipant: "Añadir Participante",
      participantName: "Nombre",
      participantEmail: "Email (opcional)",
      location: "Ubicación",
      locationType: "Tipo de Ubicación", // Used as a generic placeholder
      selectLocation: "Selecciona Tipo de Ubicación", // New specific placeholder for the Select
      physical: "Física",
      virtual: "Virtual",
      hybrid: "Híbrido", // New
      address: "Dirección",
      addConference: "Añadir Enlace de Videoconferencia",
      attachments: "Archivos Adjuntos",
      uploadFile: "Subir Archivo",
      uploading: "Subiendo...",
      attachmentEmailSettings: "Configuración de Envío por Email",
      sendToParticipants: "Enviar a participantes",
      attachmentDescription: "Selecciona qué archivos quieres enviar a los participantes por email",
      allAttachments: "Todos los archivos",
      selectedAttachments: "archivos seleccionados",
      noAttachmentsSelected: "No se enviarán archivos adjuntos",
      save: "Guardar y Agendar Reunión",
      saving: "Guardando...",
    },
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setMeetingDetails((prev) => ({ ...prev, [name]: value }));
  };

  const handleParticipantChange = (index, field, value) => {
    const newParticipants = [...participants];
    newParticipants[index][field] = value;
    setParticipants(newParticipants);
  };

  const addParticipant = () => {
    setParticipants([...participants, { name: "", email: "" }]);
  };

  const removeParticipant = (index) => {
    setParticipants(participants.filter((_, i) => i !== index));
  };
  
  // Lógica de subida refactorizada para ser llamada directamente
  const uploadFile = async (file) => {
    if (!file) return;

    setIsUploading(true);
    try {
      const { file_url } = await UploadFile({ file });
      const newAttachment = { 
        name: file.name, 
        url: file_url, 
        type: file.type, 
        size: file.size,
        id: Date.now() // Añadir ID único para control
      };
      setAttachments(prev => [...prev, newAttachment]);
      
      // Por defecto, marcar el archivo como NO seleccionado para envío
      setAttachmentSettings(prev => ({
        ...prev,
        [newAttachment.id]: false
      }));
    } catch (error) {
      console.error("Error uploading file:", error);
    }
    setIsUploading(false);
  };

  // **VERSIÓN FINAL Y MÁS ROBUSTA**
  const handleUploadClick = () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    
    // **CLAVE DE LA SOLUCIÓN:** El atributo 'multiple' es una pista para que el
    // navegador móvil muestre un selector de archivos completo.
    fileInput.multiple = true;
    
    fileInput.onchange = async e => {
      // Aunque permitimos selección múltiple, solo procesamos el primer archivo
      // para mantener la funcionalidad actual.
      if (e.target.files && e.target.files.length > 0) {
        const file = e.target.files[0];
        await uploadFile(file); // Ensure upload completes before other actions
      }
    }

    fileInput.click();
  };

  const removeAttachment = (index) => {
    const attachmentToRemove = attachments[index];
    setAttachments(attachments.filter((_, i) => i !== index));
    
    // Remover también de la configuración de envío
    if (attachmentToRemove && attachmentToRemove.id) { // Check if attachmentToRemove exists and has an id
      setAttachmentSettings(prev => {
        const newSettings = { ...prev };
        delete newSettings[attachmentToRemove.id];
        return newSettings;
      });
    }
  };

  const toggleAttachmentForEmail = (attachmentId) => {
    setAttachmentSettings(prev => ({
      ...prev,
      [attachmentId]: !prev[attachmentId]
    }));
  };

  const toggleAllAttachments = () => {
    // Check if ALL current attachments are selected
    const allAreSelected = attachments.length > 0 && attachments.every(att => attachmentSettings[att.id]);
    const newSettings = {};
    attachments.forEach(att => {
      newSettings[att.id] = !allAreSelected; // If all were selected, deselect all; otherwise, select all
    });
    setAttachmentSettings(newSettings);
  };

  const getSelectedAttachments = () => {
    return attachments.filter(att => attachmentSettings[att.id]);
  };

  const handleProviderClick = async (provider) => {
    setLoadingProvider(provider);
    
    // Simular generación de enlaces (aquí irían las APIs reales)
    const mockLinks = {
      "Zoom": `https://zoom.us/j/${Math.random().toString(36).substring(2, 12)}?pwd=example`,
      "Teams": `https://teams.microsoft.com/l/meetup-join/${Math.random().toString(36).substring(2, 12)}`,
      "Google Meet": `https://meet.google.com/${Math.random().toString(36).substring(2, 12)}-${Math.random().toString(36).substring(2, 6)}-${Math.random().toString(36).substring(2, 6)}`
    };

    setTimeout(() => {
      setLocation({
        ...location,
        virtual_provider: provider,
        virtual_link: mockLinks[provider]
      });
      setLoadingProvider(null);
    }, 1500);
  };

  // Función para buscar ubicación con Google Maps
  const searchLocationOnMaps = () => {
    if (location.address) {
      const encodedAddress = encodeURIComponent(location.address);
      window.open(`https://maps.google.com/maps?q=${encodedAddress}`, '_blank');
    }
  };

  // Función para obtener coordenadas (simulada)
  const getLocationCoordinates = async (address) => {
    // En una implementación real, usarías la Google Maps Geocoding API
    // Por ahora simulamos coordenadas
    return {
      lat: 40.7128 + Math.random() * 0.01,
      lng: -74.0060 + Math.random() * 0.01
    };
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Obtener archivos seleccionados para envío
      const selectedAttachments = getSelectedAttachments();
      
      // Create the meeting with attachment settings
      const createdMeeting = await Meeting.create({
        ...meetingDetails,
        participants: participants.filter(p => p.name),
        location,
        attachments, // All attachments are saved with the meeting
        source: 'Manual',
        attachment_email_settings: {
          send_attachments: selectedAttachments.length > 0,
          selected_attachment_ids: selectedAttachments.map(att => att.id) // Only send IDs for persistence
        }
      });

      // Send invitations with selected attachments
      const participantsWithEmail = participants.filter(p => p.name && p.email);
      if (participantsWithEmail.length > 0) {
        try {
          const { sendMeetingInvitation } = await import("@/api/functions");
          await sendMeetingInvitation({
            meetingId: createdMeeting.id,
            method: 'email',
            recipients: participantsWithEmail.map(p => p.email),
            includeAttachments: selectedAttachments // Pass full attachment objects
          });
          
          console.log(`Invitaciones enviadas a ${participantsWithEmail.length} participantes con ${selectedAttachments.length} archivos adjuntos`);
        } catch (invitationError) {
          console.error('Error sending invitations:', invitationError);
          // Don't fail the meeting creation if invitations fail
        }
      }

      setTimeout(() => {
        navigate(createPageUrl("Dashboard"));
      }, 1500);
    } catch (error) {
      console.error("Error saving meeting:", error);
      setIsSaving(false);
    }
  };

  const getFileIcon = (fileType) => {
    if (fileType.startsWith('image/')) return '🖼️';
    if (fileType.includes('pdf')) return '📄';
    if (fileType.includes('word') || fileType.includes('document')) return '📝';
    if (fileType.includes('sheet') || fileType.includes('excel')) return '📊';
    if (fileType.includes('presentation') || fileType.includes('powerpoint')) return '📽️';
    if (fileType.includes('zip') || fileType.includes('rar') || fileType.includes('x-7z-compressed')) return '🗜️';
    if (fileType.includes('video')) return '🎥';
    if (fileType.includes('audio')) return '🎵';
    if (fileType.includes('text/plain')) return '📜'; // for .txt
    return '📎';
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const isFormValid = meetingDetails.title && meetingDetails.date && meetingDetails.time;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t.es.title}</h1>
          <p className="text-lg text-gray-600">{t.es.subtitle}</p>
        </div>

        {/* Basic Details */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Detalles Básicos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input name="title" placeholder={t.es.meetingTitlePlaceholder} value={meetingDetails.title} onChange={handleInputChange} className="h-12"/>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Input name="date" type="date" value={meetingDetails.date} onChange={handleInputChange} className="h-12"/>
              <Input name="time" type="time" value={meetingDetails.time} onChange={handleInputChange} className="h-12"/>
              <Input name="duration" type="number" placeholder={t.es.duration} value={meetingDetails.duration} onChange={handleInputChange} className="h-12"/>
            </div>
            <Textarea name="description" placeholder={t.es.descriptionPlaceholder} value={meetingDetails.description} onChange={handleInputChange} rows={4}/>
          </CardContent>
        </Card>

        {/* Participants */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>{t.es.participants}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {participants.map((p, index) => (
              <div key={index} className="flex items-center gap-3">
                <Input placeholder={t.es.participantName} value={p.name} onChange={(e) => handleParticipantChange(index, 'name', e.target.value)} />
                <Input type="email" placeholder={t.es.participantEmail} value={p.email} onChange={(e) => handleParticipantChange(index, 'email', e.target.value)} />
                <Button variant="ghost" size="icon" onClick={() => removeParticipant(index)} className="text-red-500 hover:bg-red-50">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" onClick={addParticipant}>
              <PlusCircle className="w-4 h-4 mr-2" />
              {t.es.addParticipant}
            </Button>
          </CardContent>
        </Card>
        
        {/* Location - MEJORADO CON GOOGLE MAPS */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5" />
              {t.es.location}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select onValueChange={(value) => setLocation({ type: value, address: '', virtual_link: null, virtual_provider: null })} defaultValue={location.type}>
              <SelectTrigger>
                <SelectValue placeholder={t.es.selectLocation} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="physical">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    {t.es.physical}
                  </div>
                </SelectItem>
                <SelectItem value="virtual">
                  <div className="flex items-center gap-2">
                    <Video className="w-4 h-4" />
                    {t.es.virtual}
                  </div>
                </SelectItem>
                <SelectItem value="hybrid">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    <Video className="w-4 h-4" />
                    {t.es.hybrid}
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>

            {/* Ubicación Física con Google Maps */}
            {(location.type === 'physical' || location.type === 'hybrid') && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Input 
                    placeholder="Dirección completa (ej: Calle 123, Ciudad, País)" 
                    value={location.address} 
                    onChange={(e) => setLocation({...location, address: e.target.value})}
                    className="flex-1"
                  />
                  <Button 
                    variant="outline" 
                    onClick={searchLocationOnMaps}
                    disabled={!location.address}
                    title="Buscar en Google Maps"
                  >
                    <MapPin className="w-4 h-4" />
                  </Button>
                </div>
                {location.address && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <p className="text-sm text-blue-700">
                      🗺️ <strong>Google Maps:</strong> Los participantes podrán ver la ubicación en Google Maps
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Reunión Virtual con Google Meet incluido */}
            {(location.type === 'virtual' || location.type === 'hybrid') && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-3">
                  <Video className="w-5 h-5 text-blue-600" />
                  <p className="text-sm font-medium">Selecciona plataforma de videollamada:</p>
                </div>
                 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <ProviderButton 
                      provider="Zoom" 
                      onClick={() => handleProviderClick("Zoom")} 
                      isLoading={loadingProvider === "Zoom"} 
                      isAdded={location.virtual_provider === "Zoom"} 
                    />
                    <ProviderButton 
                      provider="Teams" 
                      onClick={() => handleProviderClick("Teams")} 
                      isLoading={loadingProvider === "Teams"} 
                      isAdded={location.virtual_provider === "Teams"} 
                    />
                    <ProviderButton 
                      provider="Google Meet" 
                      onClick={() => handleProviderClick("Google Meet")} 
                      isLoading={loadingProvider === "Google Meet"} 
                      isAdded={location.virtual_provider === "Google Meet"} 
                    />
                 </div>
                {location.virtual_link && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }} 
                    animate={{ opacity: 1, y: 0 }} 
                    className="bg-green-50 border border-green-200 rounded-lg p-4"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle className="w-5 h-5 text-green-600" />
                      <span className="font-medium text-green-800">Enlace generado automáticamente</span>
                    </div>
                    <p className="text-sm text-green-700">
                      <strong>Plataforma:</strong> {location.virtual_provider}
                    </p>
                    <p className="text-sm text-green-700">
                      <strong>Enlace:</strong> 
                      <a href={location.virtual_link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline ml-1">
                        {location.virtual_link}
                      </a>
                    </p>
                  </motion.div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Attachments - MEJORADO CON CONFIGURACIÓN DE ENVÍO */}
        <Card className="shadow-lg">
            <CardHeader>
              <CardTitle>{t.es.attachments}</CardTitle>
              <CardDescription>
                Sube documentos, presentaciones, imágenes y otros archivos relevantes para la reunión
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Lista de archivos subidos */}
                <div className="space-y-3">
                  {attachments.map((file, index) => (
                      <div key={file.id || index} className="flex items-center justify-between bg-gray-50 p-3 rounded-lg border">
                          <div className="flex items-center gap-3 flex-1">
                            <span className="text-2xl">{getFileIcon(file.type)}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                              <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                            </div>
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => removeAttachment(index)} className="text-red-500 hover:bg-red-50 flex-shrink-0">
                              <Trash2 className="w-4 h-4" />
                          </Button>
                      </div>
                  ))}
                  
                  {/* Botón de subida */}
                  <div className="relative">
                    <Button 
                      variant="outline" 
                      className="w-full"
                      onClick={handleUploadClick}
                      disabled={isUploading}
                    >
                      {isUploading ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <PlusCircle className="w-4 h-4 mr-2" />
                      )}
                      {isUploading ? t.es.uploading : t.es.uploadFile}
                    </Button>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    📄 PDFs • 📊 Excel/Word • 🖼️ Imágenes • 🎥 Videos • 📁 ZIP/RAR • 🎵 Audio • 📝 Texto
                  </p>
                </div>

                {/* Configuración de envío por email */}
                {attachments.length > 0 && (
                  <div className="border-t pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-medium text-gray-900">{t.es.attachmentEmailSettings}</h4>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={toggleAllAttachments}
                        className="text-xs"
                      >
                        <Paperclip className="w-3 h-3 mr-1" />
                        {attachments.length > 0 && attachments.every(att => attachmentSettings[att.id]) ? 'Deseleccionar todo' : 'Seleccionar todo'}
                      </Button>
                    </div>
                    <p className="text-xs text-gray-600 mb-3">{t.es.attachmentDescription}</p>
                    
                    <div className="space-y-2">
                      {attachments.map((file) => (
                        <div key={file.id} className="flex items-center justify-between p-2 bg-white rounded border">
                          <div className="flex items-center gap-3">
                            <span className="text-lg">{getFileIcon(file.type)}</span>
                            <div>
                              <p className="text-sm font-medium text-gray-700 truncate max-w-[150px]">
                                {file.name}
                              </p>
                              <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <label htmlFor={`checkbox-${file.id}`} className="text-xs text-gray-600 cursor-pointer">{t.es.sendToParticipants}</label>
                            <input
                              id={`checkbox-${file.id}`}
                              type="checkbox"
                              checked={attachmentSettings[file.id] || false}
                              onChange={() => toggleAttachmentForEmail(file.id)}
                              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-4 w-4 cursor-pointer"
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Resumen de selección */}
                    <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <Mail className="w-4 h-4 text-blue-600" />
                        <span className="text-sm font-medium text-blue-800">
                          {getSelectedAttachments().length > 0 ? (
                            `${getSelectedAttachments().length} ${t.es.selectedAttachments} se enviarán por email`
                          ) : (
                            t.es.noAttachmentsSelected
                          )}
                        </span>
                      </div>
                      {getSelectedAttachments().length > 0 && (
                        <ul className="mt-2 text-xs text-blue-700 list-disc list-inside space-y-1">
                          {getSelectedAttachments().map(file => (
                            <li key={file.id} className="flex items-center gap-1">
                              <span className="truncate">{file.name}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={!isFormValid || isSaving} className="meeting-gradient text-white font-bold py-3 px-8 text-lg shadow-lg">
            {isSaving ? <Loader2 className="w-6 h-6 mr-2 animate-spin" /> : <Send className="w-5 h-5 mr-2"/>}
            {isSaving ? t.es.saving : t.es.save}
          </Button>
        </div>
      </div>
    </div>
  );
}
