
// Sistema de traducción centralizado
export const translations = {
  en: {
    // Dashboard
    dashboard: {
      title: "Dashboard",
      subtitle: "Your AI-powered meeting command center",
      createNewMeeting: "Create New Meeting",
      meetingsToday: "Meetings Today",
      aiAssisted: "AI-Assisted",
      aiAssistedSubtext: "Meetings created with AI help",
      smartAlerts: "Smart Alerts",
      aiInsights: "AI Insights",
      needsReview: "Need Review",
      allGood: "All Good",
      testGlobalAlert: "Test Global Alert",
      testAlertSubtitle: "Test the system to ensure it works correctly",
      todaysMeetings: "Today's Meetings",
      noMeetings: "No meetings scheduled for today",
      noMeetingsSubtext: "Start by creating your first meeting",
      // Additional dashboard translations
      today: "Today",
      total: "Total",
      aiPowered: "AI Powered",
      quickActions: "Quick Actions",
      newMeeting: "New Meeting",
      aiChat: "AI Chat",
      calendar: "Calendar",
      realTimeUpdates: "Real-time updates",
      noMeetingsToday: "No meetings today",
      allCaughtUp: "You're all caught up! Create a new meeting to get started.",
      createNewMeeting: "Create New Meeting",
      test: "Test",
      selectedIntensity: "Selected Intensity",
      maximum: "maximum",
      active: "Active",
      disabled: "Disabled",
      needsReview: "Needs review",
      allGood: "All good",
      notesAndTasks: "Notes & Tasks"
    },
    // Calendar
    calendar: {
      title: "Calendar",
      subtitle: "View all your meetings organized by date",
      loadError: "Failed to load meetings",
      addMeeting: "Add Meeting"
    },
    // Settings
    settings: {
      title: "Settings",
      subtitle: "Customize your experience",
      saved: "Settings saved successfully",
      error: "Error saving settings",
      saving: "Saving...",
      save: "Save Changes",
      theme: "Theme",
      about: "About",
      version: "Version",
      themes: {
        light: "Light",
        dark: "Dark"
      },
      notificationSettings: {
        title: "Notification Settings",
        alertIntensity: "Alert Intensity",
        intensityLevels: {
          maximum: "Maximum - Full screen alerts",
          medium: "Medium - Banner alerts",
          light: "Light - Toast notifications"
        }
      },
      smartAlerts: "Smart Alerts",
      loadError: "Failed to load user data",
      alertIntensityUpdated: "Alert intensity updated to",
      saveError: "Failed to save alert intensity",
      noPreferences: "No preferences found",
      user: "User",
      darkThemeEnabled: "Dark theme is enabled",
      lightThemeEnabled: "Light theme is enabled"
    },
    // Notes
    notes: {
      title: "Notes & Tasks",
      subtitle: "Your digital brain for ideas and tasks",
      searchPlaceholder: "Search notes...",
      addNote: "Add Note",
      editNote: "Edit Note",
      deleteNote: "Delete Note",
      save: "Save",
      cancel: "Cancel",
      titlePlaceholder: "Note title",
      contentPlaceholder: "Write your note here...",
      categories: {
        all: "All",
        general: "General",
        work: "Work",
        personal: "Personal",
        ideas: "Ideas",
        tasks: "Tasks"
      },
      noNotes: "No notes yet",
      noNotesSubtext: "Create your first note to get started",
      deleteConfirm: "Are you sure you want to delete this note?",
      noteSaved: "Note saved successfully",
      noteDeleted: "Note deleted successfully",
      loadError: "Failed to load notes",
      fillRequired: "Please fill in both title and content",
      confirmDelete: "Confirm Delete"
    },
    // Navigation
    nav: {
      dashboard: "Dashboard",
      addMeeting: "Add Meeting",
      totalMeetings: "Total Meetings",
      calendar: "Calendar",
      notes: "Notes & Tasks",
      aiChat: "AI Chat",
      settings: "Settings",
      apiKeys: "API Keys",
      pricing: "Pricing",
      notificationDemo: "Notification Demo"
    },
    // Meeting
    meeting: {
      title: "Title",
      description: "Description",
      date: "Date",
      time: "Time",
      duration: "Duration",
      minutes: "min",
      participants: "Participants",
      location: "Location",
      confidence: "Confidence",
      source: "Source"
    },
    // Create Meeting
    createMeeting: {
      title: "Create Meeting",
      basicDetails: "Basic Details",
      meetingTitle: "Meeting Title",
      date: "Date",
      time: "Time",
      duration: "Duration (minutes)",
      description: "Description",
      location: "Location",
      locationType: "Location Type",
      physical: "Physical",
      virtual: "Virtual",
      hybrid: "Hybrid",
      virtualPlatform: "Virtual Platform",
      zoom: "Zoom",
      teams: "Microsoft Teams",
      googleMeet: "Google Meet",
      participants: "Participants",
      addParticipant: "Add Participant",
      attachments: "Attachments",
      addAttachment: "Add Attachment",
      createMeeting: "Create Meeting",
      cancel: "Cancel",
      save: "Save",
      locationAddress: "Location Address",
      enterMeetingLocation: "Enter meeting location...",
      videoPlatform: "Video Platform",
      generateMeetingLink: "Generate Meeting Link",
      linkGenerated: "Link Generated",
      participants: "Participants",
      name: "Name",
      email: "Email",
      addParticipant: "Add Participant",
      attachments: "Attachments",
      noAttachmentsAdded: "No attachments added yet.",
      pickDocument: "Pick Document",
      pickImages: "Pick Images"
    },
    // AI Chat
    aiChat: {
      title: "AI Assistant",
      subtitle: "Your intelligent meeting companion",
      welcome: "Hello! I'm your AI meeting assistant. How can I help you today?",
      thinking: "Thinking...",
      suggestions: "Quick suggestions:",
      suggestionsList: [
        "What meetings do I have today?",
        "Show my upcoming meetings",
        "Create a meeting for tomorrow at 2 PM",
        "Schedule a team standup for next week",
        "Check my availability for Friday",
        "Update my meeting with John",
        "Delete the ADSF meeting",
        "Create a virtual meeting with Zoom",
        "Schedule a hybrid meeting with Google Meet",
        "Tell me about my meetings"
      ],
      initializeError: "Failed to initialize AI service. Please check your API configuration.",
      confirmClear: "Are you sure you want to clear the chat history?",
      createMeeting: "Create Meeting",
      connected: "Connected",
      placeholder: "Type your message here...",
      updateMeeting: "Update Meeting"
    },
    // Total Meetings
    totalMeetings: {
      title: "Total Meetings",
      searchPlaceholder: "Search meetings...",
      all: "All",
      today: "Today",
      upcoming: "Upcoming",
      past: "Past",
      newMeeting: "New Meeting",
      loadingMeetings: "Loading meetings...",
      noMeetingsFound: "No meetings found",
      tryAdjustingSearch: "Try adjusting your search",
      createFirstMeeting: "Create your first meeting to get started",
      view: "View",
      edit: "Edit",
      delete: "Delete",
      noLocationSpecified: "No location specified",
      minutes: "minutes",
      participant: "participant",
      participants: "participants",
      thisWeek: "This Week",
      upcoming: "Upcoming"
    },
    // Pricing
    pricing: {
      loadingPricingPlans: "Loading pricing plans...",
      loadingFromBackend: "Loading pricing plans from backend...",
      retry: "Retry"
    },
    // Choose Creation Method
    chooseCreationMethod: {
      title: "Choose a Creation Method",
      subtitle: "Select how you want to schedule your next meeting.",
      manualTitle: "Manual",
      manualDesc: "Full control. Define every detail of your meeting in a simple form.",
      aiTitle: "AI Assistant",
      aiDesc: "Talk to the AI. Ask for what you need in natural language and let the assistant do the rest.",
      whatsappTitle: "WhatsApp Bot",
      whatsappDesc: "Quick and mobile. Send a message to schedule on the go, from anywhere.",
      back: "Back to Dashboard"
    },
    // AI Insights
    aiInsights: {
      title: "AI Insights & Review",
      subtitle: "Review and improve meetings that need your attention",
      backToDashboard: "Back to Dashboard",
      noReviewNeeded: "All meetings look good!",
      noReviewSubtext: "Your AI assistant is working perfectly. No meetings need review.",
      whyReview: "Why Review?",
      lowConfidence: "Low AI confidence",
      missingDetails: "Missing key details",
      unclearTime: "Unclear time format",
      vagueDuration: "Vague duration",
      edit: "Edit",
      save: "Save Changes",
      cancel: "Cancel",
      confirm: "Confirm as Correct",
      title: "Title",
      date: "Date",
      time: "Time",
      duration: "Duration (minutes)",
      description: "Description",
      fixed: "Fixed",
      meetingUpdated: "Meeting updated successfully"
    },
    // Alert Customizer
    alertCustomizer: {
      title: "Alert Settings",
      subtitle: "Customize your notification preferences",
      intensity: "Alert Intensity",
      intensityDescription: "Choose how prominent your alerts should be",
      soundEnabled: "Sound Alerts",
      soundDescription: "Play audio notifications",
      vibrationEnabled: "Vibration",
      vibrationDescription: "Vibrate device on alerts",
      speechEnabled: "Voice Announcements",
      speechDescription: "Announce meeting details with voice",
      autoCloseEnabled: "Auto-close Alerts",
      autoCloseDescription: "Automatically close alerts after countdown",
      defaultSnoozeMinutes: "Default Snooze Time",
      defaultSnoozeDescription: "Default snooze duration in minutes",
      save: "Save Settings",
      cancel: "Cancel",
      maximum: "Maximum - Full screen takeover",
      medium: "Medium - Persistent banner",
      light: "Light - Toast notification"
    },
    // Alert System
    alertSystem: {
      title: "🚨 MEETING ALERT 🚨",
      subtitle: "You have an important meeting!",
      inMinutes: "in minutes",
      now: "NOW",
      understood: "UNDERSTOOD - GO TO MEETING",
      snooze5: "Snooze 5 min",
      snooze15: "Snooze 15 min",
      snooze60: "Snooze 1 hour",
      postpone: "Postpone Meeting",
      reschedule: "Reschedule",
      cancel: "Cancel",
      autoClose: "Auto-close in",
      muteSound: "Mute",
      unmuteSound: "Unmute",
      postponeTitle: "Reschedule Meeting",
      newDate: "New Date",
      newTime: "New Time",
      tapToActivateAudio: "TAP TO ACTIVATE AUDIO",
      customizeAlert: "Customize Alert",
      customizeAlertTitle: "Customize Alert Settings",
      minutesBeforeMeeting: "Minutes before meeting",
      enableSound: "Enable Sound",
      enableVibration: "Enable Vibration",
      enableSpeech: "Enable Speech",
      saveCustomization: "Save Customization",
      back: "Back"
    },
    // Meeting Confirmation Modal
    meetingConfirmationModal: {
      confirmCreate: "Create Meeting",
      confirmUpdate: "Update Meeting",
      confirmDelete: "Delete Meeting",
      cancel: "Cancel",
      edit: "Edit",
      save: "Save",
      meetingDetails: "Meeting Details",
      title: "Title",
      date: "Date",
      time: "Time",
      duration: "Duration",
      location: "Location",
      participants: "Participants",
      description: "Description",
      minutes: "minutes",
      confirmDeleteMessage: "Are you sure you want to delete this meeting?",
      delete: "Delete",
      noParticipants: "No participants",
      addParticipant: "Add participant",
      participantEmail: "Participant email"
    },
    // Meeting Card
    meetingCard: {
      at: "at",
      duration: "Duration",
      minutes: "min",
      export: "Export",
      testAlert: "Test Alert",
      preparationTips: "AI Preparation Tips",
      participants: "Participants",
      location: "Location",
      attachments: "Attachments",
      shareEmail: "Send via Email",
      shareWhatsApp: "Send via WhatsApp",
      copyLink: "Copy Link",
      linkCopied: "Link copied!",
      noParticipants: "No participants added",
      physicalLocation: "Physical Location",
      virtualMeeting: "Virtual Meeting",
      hybridMeeting: "Hybrid Meeting",
      online: "Online",
      joinMeetingProvider: "Join {provider}",
      joinMeetingGeneric: "Join Meeting",
      viewOnGoogleMaps: "View on Google Maps"
    },
    // Auth
    auth: {
      title: "MeetingGuard",
      subtitle: "Secure your meetings with AI",
      loginTitle: "Welcome Back",
      signupTitle: "Create Account",
      loginSubtitle: "Sign in to continue to your dashboard",
      signupSubtitle: "Create your account to get started",
      email: "Email",
      password: "Password",
      confirmPassword: "Confirm Password",
      name: "Full Name",
      login: "Sign In",
      signup: "Sign Up",
      forgotPassword: "Forgot Password?",
      noAccount: "Don't have an account?",
      hasAccount: "Already have an account?",
      signUpHere: "Sign up here",
      signInHere: "Sign in here",
      emailPlaceholder: "Enter your email",
      passwordPlaceholder: "Enter your password",
      namePlaceholder: "Enter your full name",
      loginSuccess: "Login successful!",
      signupSuccess: "Account created successfully!",
      error: "An error occurred. Please try again.",
      invalidEmail: "Please enter a valid email address",
      passwordMismatch: "Passwords do not match",
      weakPassword: "Password must be at least 6 characters",
      emptyFields: "Please fill in all fields",
      orContinueWith: "Or continue with",
      signInWithGoogle: "Sign in with Google",
      signUpWithGoogle: "Sign up with Google"
    },
    // API Settings
    apiSettings: {
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
      enterCompanyName: "Please enter a company name."
    },
    // Meeting Details Modal
    meetingDetailsModal: {
      title: "Meeting Details",
      description: "Description",
      date: "Date",
      time: "Time",
      duration: "Duration",
      minutes: "min",
      source: "Source",
      confidence: "AI Confidence",
      preparation: "AI Preparation Tips",
      noDescription: "No description provided",
      exportCalendar: "Export to Calendar",
      testAlert: "Test Alert",
      close: "Close"
    },
    // Meeting Alert
    meetingAlert: {
      title: "MEETING ALERT",
      subtitle: "You have a meeting starting soon!",
      inMinutes: "in minutes",
      now: "NOW",
      understood: "UNDERSTOOD - GO TO MEETING",
      snooze: "Snooze 5 min",
      preparation: "AI Preparation Tips",
      confidence: "AI Confidence",
      autoClose: "Auto-close in"
    },
    // Medium Alert
    mediumAlert: {
      title: "Meeting Reminder",
      snooze5: "Snooze 5 min",
      snooze15: "Snooze 15 min",
      snooze60: "Snooze 1 hour",
      dismiss: "Dismiss"
    },
    // Maximum Alert
    maximumAlert: {
      title: "🚨 URGENT MEETING ALERT 🚨",
      subtitle: "You have an important meeting!",
      understood: "UNDERSTOOD - GO TO MEETING",
      snooze5: "Snooze 5 min",
      snooze15: "Snooze 15 min",
      snooze60: "Snooze 1 hour",
      postpone: "Postpone Meeting",
      customize: "Customize Alerts"
    },
    // Light Alert
    lightAlert: {
      title: "Meeting Reminder",
      dismiss: "Dismiss"
    },
    // WhatsApp Bot
    whatsAppBot: {
      title: "WhatsApp Bot",
      subtitle: "Schedule meetings quickly via WhatsApp",
      description: "Send a message to our WhatsApp bot to create meetings on the go. Perfect for quick scheduling when you're busy.",
      features: [
        "Natural language processing",
        "Quick meeting creation",
        "Available 24/7",
        "Works from anywhere"
      ],
      startChat: "Start WhatsApp Chat",
      backToDashboard: "Back to Dashboard",
      comingSoon: "Coming Soon",
      notAvailable: "WhatsApp Bot is not available yet. Please use the manual creation method or AI Assistant.",
      openWhatsApp: "Open WhatsApp",
      whatsAppNumber: "+1234567890"
    },
    // Privacy Policy
    privacy: {
      title: "Privacy Policy",
      subtitle: "How we protect your data and privacy",
      lastUpdated: "Last updated: December 2024",
      dataCollection: "Data Collection",
      dataCollectionDesc: "We collect only the information necessary to provide our services:",
      dataCollectionItems: [
        "Meeting details (title, date, time, participants)",
        "User preferences and settings",
        "Usage analytics to improve our service",
        "Communication data when you contact us"
      ],
      dataUsage: "How We Use Your Data",
      dataUsageDesc: "Your data is used exclusively for:",
      dataUsageItems: [
        "Providing meeting management services",
        "Sending notifications and reminders",
        "Personalizing your experience",
        "Improving our AI capabilities"
      ],
      dataSharing: "Data Sharing",
      dataSharingDesc: "We do not sell, trade, or rent your personal information. We may share data only when:",
      dataSharingItems: [
        "Required by law or legal process",
        "Necessary to protect our rights and safety",
        "With your explicit consent",
        "With service providers who assist in our operations"
      ],
      dataSecurity: "Data Security",
      dataSecurityDesc: "We implement industry-standard security measures:",
      dataSecurityItems: [
        "End-to-end encryption for sensitive data",
        "Regular security audits and updates",
        "Secure data centers with 99.9% uptime",
        "Access controls and authentication"
      ],
      yourRights: "Your Rights",
      yourRightsDesc: "You have the right to:",
      yourRightsItems: [
        "Access your personal data",
        "Correct inaccurate information",
        "Request deletion of your data",
        "Export your data in a portable format",
        "Opt-out of non-essential communications"
      ],
      cookies: "Cookies and Tracking",
      cookiesDesc: "We use cookies and similar tracking technologies to enhance your experience and analyze usage patterns.",
      cookiesItems: [
        "Essential cookies for app functionality",
        "Analytics cookies to improve user experience",
        "Preference cookies to remember your settings",
        "Marketing cookies for personalized content"
      ],
      contactUs: "Contact Us",
      contactUsDesc: "If you have any questions about this Privacy Policy, please contact us:",
      email: "privacy@meetingguard.ai",
      address: "MeetingGuard AI\n123 Innovation Street\nTech City, TC 12345",
      backToDashboard: "Back to Dashboard"
    },
    // Terms of Service
    terms: {
      title: "Terms of Service",
      subtitle: "Please read these terms carefully before using our service",
      lastUpdated: "Last updated: December 2024",
      acceptance: "Acceptance of Terms",
      acceptanceDesc: "By accessing and using MeetingGuard AI, you accept and agree to be bound by the terms and provision of this agreement.",
      serviceDescription: "Service Description",
      serviceDescriptionDesc: "MeetingGuard AI is an intelligent meeting management platform that provides:",
      serviceDescriptionItems: [
        "AI-powered meeting scheduling and management",
        "Smart notifications and reminders",
        "Calendar integration and synchronization",
        "Meeting analytics and insights",
        "Team collaboration features"
      ],
      userAccounts: "User Accounts",
      userAccountsDesc: "To use our service, you must:",
      userAccountsItems: [
        "Be at least 18 years old or have parental consent",
        "Provide accurate and complete information",
        "Maintain the security of your account credentials",
        "Notify us immediately of any unauthorized use",
        "Accept responsibility for all activities under your account"
      ],
      acceptableUse: "Acceptable Use",
      acceptableUseDesc: "You agree to use our service only for lawful purposes and in accordance with these terms. You agree not to:",
      acceptableUseItems: [
        "Use the service for any illegal or unauthorized purpose",
        "Interfere with or disrupt the service or servers",
        "Attempt to gain unauthorized access to any part of the service",
        "Use automated systems to access the service",
        "Share your account credentials with others"
      ],
      intellectualProperty: "Intellectual Property",
      intellectualPropertyDesc: "The service and its original content, features, and functionality are owned by MeetingGuard AI and are protected by international copyright, trademark, patent, trade secret, and other intellectual property laws.",
      privacy: "Privacy",
      privacyDesc: "Your privacy is important to us. Please review our Privacy Policy, which also governs your use of the service, to understand our practices.",
      termination: "Termination",
      terminationDesc: "We may terminate or suspend your account and bar access to the service immediately, without prior notice or liability, under our sole discretion, for any reason whatsoever, including without limitation if you breach the terms.",
      disclaimers: "Disclaimers",
      disclaimersDesc: "The service is provided on an 'AS IS' and 'AS AVAILABLE' basis. MeetingGuard AI makes no warranties, expressed or implied, and hereby disclaims all warranties, including without limitation:",
      disclaimersItems: [
        "Warranty of merchantability or fitness for a particular purpose",
        "Non-infringement of third-party rights",
        "Uninterrupted or error-free service",
        "Accuracy or reliability of information provided"
      ],
      contact: "Contact Information",
      contactDesc: "If you have any questions about these Terms of Service, please contact us at:",
      email: "legal@meetingguard.ai",
      address: "MeetingGuard AI\n123 Innovation Street\nTech City, TC 12345",
      backToDashboard: "Back to Dashboard"
    },
    // Common
    common: {
      save: "Save",
      cancel: "Cancel",
      confirm: "Confirm",
      delete: "Delete",
      edit: "Edit",
      back: "Back",
      next: "Next",
      loading: "Loading...",
      error: "Error",
      success: "Success",
      logout: "Logout",
      confirmLogout: "Are you sure you want to logout?",
      settings: "Settings"
    }
  },
  es: {
    // Dashboard
    dashboard: {
      title: "Panel Principal",
      subtitle: "Tu centro de comando de reuniones con IA",
      createNewMeeting: "Crear Nueva Reunión",
      meetingsToday: "Reuniones Hoy",
      aiAssisted: "Con Asistencia IA",
      aiAssistedSubtext: "Reuniones creadas con ayuda de IA",
      smartAlerts: "Alertas Inteligentes",
      aiInsights: "Información IA",
      needsReview: "Necesitan Revisión",
      allGood: "Todo Bien",
      testGlobalAlert: "Probar Alerta Global",
      testAlertSubtitle: "Prueba el sistema para asegurar que funcione correctamente",
      todaysMeetings: "Reuniones de Hoy",
      noMeetings: "No hay reuniones programadas para hoy",
      noMeetingsSubtext: "Comienza creando tu primera reunión",
      // Additional dashboard translations
      today: "Hoy",
      total: "Total",
      aiPowered: "Con IA",
      quickActions: "Acciones Rápidas",
      newMeeting: "Nueva Reunión",
      aiChat: "Chat IA",
      calendar: "Calendario",
      realTimeUpdates: "Actualizaciones en tiempo real",
      noMeetingsToday: "No hay reuniones hoy",
      allCaughtUp: "¡Estás al día! Crea una nueva reunión para comenzar.",
      createNewMeeting: "Crear Nueva Reunión",
      test: "Probar",
      selectedIntensity: "Intensidad Seleccionada",
      maximum: "máximo",
      active: "Activo",
      disabled: "Deshabilitado",
      needsReview: "Necesita revisión",
      allGood: "Todo bien",
      notesAndTasks: "Notas y Tareas"
    },
    // Calendar
    calendar: {
      title: "Calendario",
      subtitle: "Ve todas tus reuniones organizadas por fecha",
      loadError: "Error al cargar las reuniones",
      addMeeting: "Agregar Reunión"
    },
    // Settings
    settings: {
      title: "Configuración",
      subtitle: "Personaliza tu experiencia",
      saved: "Configuración guardada exitosamente",
      error: "Error al guardar configuración",
      saving: "Guardando...",
      save: "Guardar Cambios",
      theme: "Tema",
      about: "Acerca de",
      version: "Versión",
      themes: {
        light: "Claro",
        dark: "Oscuro"
      },
      notificationSettings: {
        title: "Configuración de Notificaciones",
        alertIntensity: "Intensidad de Alertas",
        intensityLevels: {
          maximum: "Máxima - Alertas de pantalla completa",
          medium: "Media - Alertas de banner",
          light: "Ligera - Notificaciones toast"
        }
      },
      smartAlerts: "Alertas",
      loadError: "Error al cargar los datos del usuario",
      alertIntensityUpdated: "Intensidad de alerta actualizada a",
      saveError: "Error al guardar la intensidad de alerta",
      noPreferences: "No se encontraron preferencias",
      user: "Usuario",
      darkThemeEnabled: "El tema oscuro está habilitado",
      lightThemeEnabled: "El tema claro está habilitado"
    },
    // Notes
    notes: {
      title: "Notas y Tareas",
      subtitle: "Tu cerebro digital para ideas y tareas",
      searchPlaceholder: "Buscar notas...",
      addNote: "Agregar Nota",
      editNote: "Editar Nota",
      deleteNote: "Eliminar Nota",
      save: "Guardar",
      cancel: "Cancelar",
      titlePlaceholder: "Título de la nota",
      contentPlaceholder: "Escribe tu nota aquí...",
      categories: {
        all: "Todas",
        general: "General",
        work: "Trabajo",
        personal: "Personal",
        ideas: "Ideas",
        tasks: "Tareas"
      },
      noNotes: "Aún no hay notas",
      noNotesSubtext: "Crea tu primera nota para comenzar",
      deleteConfirm: "¿Estás seguro de que quieres eliminar esta nota?",
      noteSaved: "Nota guardada exitosamente",
      noteDeleted: "Nota eliminada exitosamente",
      loadError: "Error al cargar las notas",
      fillRequired: "Por favor completa tanto el título como el contenido",
      confirmDelete: "Confirmar Eliminación"
    },
    // Navigation
    nav: {
      dashboard: "Panel",
      addMeeting: "Añadir Reunión",
      totalMeetings: "Todas las Reuniones",
      calendar: "Calendario",
      notes: "Notas y Tareas",
      aiChat: "Chat IA",
      settings: "Ajustes",
      apiKeys: "Claves API",
      pricing: "Precios",
      notificationDemo: "Demo de Notificaciones"
    },
    // Meeting
    meeting: {
      title: "Título",
      description: "Descripción",
      date: "Fecha",
      time: "Hora",
      duration: "Duración",
      minutes: "min",
      participants: "Participantes",
      location: "Ubicación",
      confidence: "Confianza",
      source: "Origen"
    },
    // Create Meeting
    createMeeting: {
      title: "Crear Reunión",
      basicDetails: "Detalles Básicos",
      meetingTitle: "Título de la Reunión",
      date: "Fecha",
      time: "Hora",
      duration: "Duración (minutos)",
      description: "Descripción",
      location: "Ubicación",
      locationType: "Tipo de Ubicación",
      physical: "Física",
      virtual: "Virtual",
      hybrid: "Híbrida",
      virtualPlatform: "Plataforma Virtual",
      zoom: "Zoom",
      teams: "Microsoft Teams",
      googleMeet: "Google Meet",
      participants: "Participantes",
      addParticipant: "Agregar Participante",
      attachments: "Adjuntos",
      addAttachment: "Agregar Adjunto",
      createMeeting: "Crear Reunión",
      cancel: "Cancelar",
      save: "Guardar",
      locationAddress: "Dirección de Ubicación",
      enterMeetingLocation: "Ingresa la ubicación de la reunión...",
      videoPlatform: "Plataforma de Video",
      generateMeetingLink: "Generar Enlace de Reunión",
      linkGenerated: "Enlace Generado",
      participants: "Participantes",
      name: "Nombre",
      email: "Correo Electrónico",
      addParticipant: "Agregar Participante",
      attachments: "Adjuntos",
      noAttachmentsAdded: "No se han agregado adjuntos aún.",
      pickDocument: "Seleccionar Documento",
      pickImages: "Seleccionar Imágenes"
    },
    // AI Chat
    aiChat: {
      title: "Asistente IA",
      subtitle: "Tu compañero inteligente para reuniones",
      welcome: "¡Hola! Soy tu asistente de reuniones con IA. ¿Cómo puedo ayudarte hoy?",
      thinking: "Pensando...",
      suggestions: "Sugerencias rápidas:",
      suggestionsList: [
        "¿Qué reuniones tengo hoy?",
        "Mostrar mis próximas reuniones",
        "Crear una reunión para mañana a las 2 PM",
        "Programar una reunión de equipo para la próxima semana",
        "Verificar mi disponibilidad para el viernes",
        "Actualizar mi reunión con John",
        "Eliminar la reunión ADSF",
        "Crear una reunión virtual con Zoom",
        "Programar una reunión híbrida con Google Meet",
        "Cuéntame sobre mis reuniones"
      ],
      initializeError: "Error al inicializar el servicio de IA. Por favor verifica tu configuración de API.",
      confirmClear: "¿Estás seguro de que quieres limpiar el historial del chat?",
      createMeeting: "Crear Reunión",
      connected: "Conectado",
      placeholder: "Escribe tu mensaje aquí...",
      updateMeeting: "Actualizar Reunión"
    },
    // Total Meetings
    totalMeetings: {
      title: "Todas las Reuniones",
      searchPlaceholder: "Buscar reuniones...",
      all: "Todas",
      today: "Hoy",
      upcoming: "Próximas",
      past: "Pasadas",
      newMeeting: "Nueva Reunión",
      loadingMeetings: "Cargando reuniones...",
      noMeetingsFound: "No se encontraron reuniones",
      tryAdjustingSearch: "Intenta ajustar tu búsqueda",
      createFirstMeeting: "Crea tu primera reunión para comenzar",
      view: "Ver",
      edit: "Editar",
      delete: "Eliminar",
      noLocationSpecified: "No se especificó ubicación",
      minutes: "minutos",
      participant: "participante",
      participants: "participantes",
      thisWeek: "Esta Semana",
      upcoming: "Próximas"
    },
    // Pricing
    pricing: {
      loadingPricingPlans: "Cargando planes de precios...",
      loadingFromBackend: "Cargando planes de precios desde el servidor...",
      retry: "Reintentar"
    },
    // Choose Creation Method
    chooseCreationMethod: {
      title: "Elige un Método de Creación",
      subtitle: "Selecciona cómo quieres agendar tu próxima reunión.",
      manualTitle: "Manual",
      manualDesc: "Control total. Define cada detalle de tu reunión en un formulario simple.",
      aiTitle: "Asistente IA",
      aiDesc: "Habla con la IA. Pide lo que necesitas en lenguaje natural y deja que el asistente haga el resto.",
      whatsappTitle: "Bot de WhatsApp",
      whatsappDesc: "Rápido y móvil. Envía un mensaje para agendar sobre la marcha, desde cualquier lugar.",
      back: "Volver al Panel"
    },
    // AI Insights
    aiInsights: {
      title: "Información IA y Revisión",
      subtitle: "Revisa y mejora reuniones que necesitan tu atención",
      backToDashboard: "Volver al Panel",
      noReviewNeeded: "¡Todas las reuniones se ven bien!",
      noReviewSubtext: "Tu asistente de IA está funcionando perfectamente. No hay reuniones que revisar.",
      whyReview: "¿Por qué Revisar?",
      lowConfidence: "Baja confianza de la IA",
      missingDetails: "Faltan detalles clave",
      unclearTime: "Formato de hora poco claro",
      vagueDuration: "Duración vaga",
      edit: "Editar",
      save: "Guardar Cambios",
      cancel: "Cancelar",
      confirm: "Confirmar como Correcto",
      title: "Título",
      date: "Fecha",
      time: "Hora",
      duration: "Duración (minutos)",
      description: "Descripción",
      fixed: "Corregido",
      meetingUpdated: "Reunión actualizada exitosamente"
    },
    // Alert Customizer
    alertCustomizer: {
      title: "Configuración de Alertas",
      subtitle: "Personaliza tus preferencias de notificación",
      intensity: "Intensidad de Alerta",
      intensityDescription: "Elige qué tan prominentes deben ser tus alertas",
      soundEnabled: "Alertas de Sonido",
      soundDescription: "Reproducir notificaciones de audio",
      vibrationEnabled: "Vibración",
      vibrationDescription: "Vibrar dispositivo en alertas",
      speechEnabled: "Anuncios de Voz",
      speechDescription: "Anunciar detalles de reunión con voz",
      autoCloseEnabled: "Cerrar Alertas Automáticamente",
      autoCloseDescription: "Cerrar alertas automáticamente después del conteo",
      defaultSnoozeMinutes: "Tiempo de Posposición Predeterminado",
      defaultSnoozeDescription: "Duración predeterminada de posposición en minutos",
      save: "Guardar Configuración",
      cancel: "Cancelar",
      maximum: "Máximo - Toma de pantalla completa",
      medium: "Medio - Banner persistente",
      light: "Ligero - Notificación toast"
    },
    // Alert System
    alertSystem: {
      title: "🚨 ALERTA DE REUNIÓN 🚨",
      subtitle: "¡Tienes una reunión importante!",
      inMinutes: "en minutos",
      now: "AHORA",
      understood: "ENTENDIDO - IR A REUNIÓN",
      snooze5: "Posponer 5 min",
      snooze15: "Posponer 15 min",
      snooze60: "Posponer 1 hora",
      postpone: "Reagendar Reunión",
      reschedule: "Reagendar",
      cancel: "Cancelar",
      autoClose: "Cierre automático en",
      muteSound: "Silenciar",
      unmuteSound: "Activar sonido",
      postponeTitle: "Reagendar Reunión",
      newDate: "Nueva Fecha",
      newTime: "Nueva Hora",
      tapToActivateAudio: "TOCA PARA ACTIVAR AUDIO",
      customizeAlert: "Personalizar Alerta",
      customizeAlertTitle: "Configuración de Alerta Personalizada",
      minutesBeforeMeeting: "Minutos antes de la reunión",
      enableSound: "Activar Sonido",
      enableVibration: "Activar Vibración",
      enableSpeech: "Activar Voz",
      saveCustomization: "Guardar Personalización",
      back: "Atrás"
    },
    // Meeting Confirmation Modal
    meetingConfirmationModal: {
      confirmCreate: "Crear Reunión",
      confirmUpdate: "Actualizar Reunión",
      confirmDelete: "Eliminar Reunión",
      cancel: "Cancelar",
      edit: "Editar",
      save: "Guardar",
      meetingDetails: "Detalles de la Reunión",
      title: "Título",
      date: "Fecha",
      time: "Hora",
      duration: "Duración",
      location: "Ubicación",
      participants: "Participantes",
      description: "Descripción",
      minutes: "minutos",
      confirmDeleteMessage: "¿Estás seguro de que quieres eliminar esta reunión?",
      delete: "Eliminar",
      noParticipants: "Sin participantes",
      addParticipant: "Agregar participante",
      participantEmail: "Email del participante"
    },
    // Meeting Card
    meetingCard: {
      at: "a las",
      duration: "Duración",
      minutes: "min",
      export: "Exportar",
      testAlert: "Probar Alerta",
      preparationTips: "Consejos de Preparación IA",
      participants: "Participantes",
      location: "Ubicación",
      attachments: "Archivos Adjuntos",
      shareEmail: "Enviar por Email",
      shareWhatsApp: "Enviar por WhatsApp",
      copyLink: "Copiar Enlace",
      linkCopied: "¡Enlace copiado!",
      noParticipants: "Sin participantes",
      physicalLocation: "Ubicación Física",
      virtualMeeting: "Reunión Virtual",
      hybridMeeting: "Reunión Híbrida",
      online: "Online",
      joinMeetingProvider: "Unirse a {provider}",
      joinMeetingGeneric: "Unirse a la reunión",
      viewOnGoogleMaps: "Ver en Google Maps"
    },
    // Auth
    auth: {
      title: "MeetingGuard",
      subtitle: "Asegura tus reuniones con IA",
      loginTitle: "Bienvenido de Vuelta",
      signupTitle: "Crear Cuenta",
      loginSubtitle: "Inicia sesión para continuar a tu panel",
      signupSubtitle: "Crea tu cuenta para comenzar",
      email: "Correo Electrónico",
      password: "Contraseña",
      confirmPassword: "Confirmar Contraseña",
      name: "Nombre Completo",
      login: "Iniciar Sesión",
      signup: "Registrarse",
      forgotPassword: "¿Olvidaste tu contraseña?",
      noAccount: "¿No tienes una cuenta?",
      hasAccount: "¿Ya tienes una cuenta?",
      signUpHere: "Regístrate aquí",
      signInHere: "Inicia sesión aquí",
      emailPlaceholder: "Ingresa tu correo electrónico",
      passwordPlaceholder: "Ingresa tu contraseña",
      namePlaceholder: "Ingresa tu nombre completo",
      loginSuccess: "¡Inicio de sesión exitoso!",
      signupSuccess: "¡Cuenta creada exitosamente!",
      error: "Ocurrió un error. Por favor intenta de nuevo.",
      invalidEmail: "Por favor ingresa una dirección de correo válida",
      passwordMismatch: "Las contraseñas no coinciden",
      weakPassword: "La contraseña debe tener al menos 6 caracteres",
      emptyFields: "Por favor completa todos los campos",
      orContinueWith: "O continúa con",
      signInWithGoogle: "Iniciar sesión con Google",
      signUpWithGoogle: "Registrarse con Google"
    },
    // API Settings
    apiSettings: {
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
      enterCompanyName: "Por favor ingresa un nombre de empresa."
    },
    // Meeting Details Modal
    meetingDetailsModal: {
      title: "Detalles de la Reunión",
      description: "Descripción",
      date: "Fecha",
      time: "Hora",
      duration: "Duración",
      minutes: "min",
      source: "Origen",
      confidence: "Confianza IA",
      preparation: "Consejos de Preparación IA",
      noDescription: "No se proporcionó descripción",
      exportCalendar: "Exportar al Calendario",
      testAlert: "Probar Alerta",
      close: "Cerrar"
    },
    // Meeting Alert
    meetingAlert: {
      title: "ALERTA DE REUNIÓN",
      subtitle: "¡Tienes una reunión que comenzará pronto!",
      inMinutes: "en minutos",
      now: "AHORA",
      understood: "ENTENDIDO - IR A REUNIÓN",
      snooze: "Posponer 5 min",
      preparation: "Consejos de Preparación IA",
      confidence: "Confianza IA",
      autoClose: "Cierre automático en"
    },
    // Medium Alert
    mediumAlert: {
      title: "Recordatorio de Reunión",
      snooze5: "Posponer 5 min",
      snooze15: "Posponer 15 min",
      snooze60: "Posponer 1 hora",
      dismiss: "Descartar"
    },
    // Maximum Alert
    maximumAlert: {
      title: "🚨 ALERTA URGENTE DE REUNIÓN 🚨",
      subtitle: "¡Tienes una reunión importante!",
      understood: "ENTENDIDO - IR A REUNIÓN",
      snooze5: "Posponer 5 min",
      snooze15: "Posponer 15 min",
      snooze60: "Posponer 1 hora",
      postpone: "Posponer Reunión",
      customize: "Personalizar Alertas"
    },
    // Light Alert
    lightAlert: {
      title: "Recordatorio de Reunión",
      dismiss: "Descartar"
    },
    // WhatsApp Bot
    whatsAppBot: {
      title: "Bot de WhatsApp",
      subtitle: "Agenda reuniones rápidamente vía WhatsApp",
      description: "Envía un mensaje a nuestro bot de WhatsApp para crear reuniones sobre la marcha. Perfecto para agendar rápidamente cuando estés ocupado.",
      features: [
        "Procesamiento de lenguaje natural",
        "Creación rápida de reuniones",
        "Disponible 24/7",
        "Funciona desde cualquier lugar"
      ],
      startChat: "Iniciar Chat de WhatsApp",
      backToDashboard: "Volver al Panel",
      comingSoon: "Próximamente",
      notAvailable: "El Bot de WhatsApp no está disponible aún. Por favor usa el método de creación manual o el Asistente IA.",
      openWhatsApp: "Abrir WhatsApp",
      whatsAppNumber: "+1234567890"
    },
    // Privacy Policy
    privacy: {
      title: "Política de Privacidad",
      subtitle: "Cómo protegemos tus datos y privacidad",
      lastUpdated: "Última actualización: Diciembre 2024",
      dataCollection: "Recopilación de Datos",
      dataCollectionDesc: "Solo recopilamos la información necesaria para brindar nuestros servicios:",
      dataCollectionItems: [
        "Detalles de reuniones (título, fecha, hora, participantes)",
        "Preferencias y configuraciones del usuario",
        "Analíticas de uso para mejorar nuestro servicio",
        "Datos de comunicación cuando nos contactas"
      ],
      dataUsage: "Cómo Usamos Tus Datos",
      dataUsageDesc: "Tus datos se usan exclusivamente para:",
      dataUsageItems: [
        "Brindar servicios de gestión de reuniones",
        "Enviar notificaciones y recordatorios",
        "Personalizar tu experiencia",
        "Mejorar nuestras capacidades de IA"
      ],
      dataSharing: "Compartir Datos",
      dataSharingDesc: "No vendemos, intercambiamos o alquilamos tu información personal. Solo podemos compartir datos cuando:",
      dataSharingItems: [
        "Sea requerido por ley o proceso legal",
        "Sea necesario para proteger nuestros derechos y seguridad",
        "Con tu consentimiento explícito",
        "Con proveedores de servicios que nos ayudan en nuestras operaciones"
      ],
      dataSecurity: "Seguridad de Datos",
      dataSecurityDesc: "Implementamos medidas de seguridad estándar de la industria:",
      dataSecurityItems: [
        "Cifrado de extremo a extremo para datos sensibles",
        "Auditorías y actualizaciones de seguridad regulares",
        "Centros de datos seguros con 99.9% de tiempo de actividad",
        "Controles de acceso y autenticación"
      ],
      yourRights: "Tus Derechos",
      yourRightsDesc: "Tienes derecho a:",
      yourRightsItems: [
        "Acceder a tus datos personales",
        "Corregir información inexacta",
        "Solicitar la eliminación de tus datos",
        "Exportar tus datos en un formato portátil",
        "Optar por no recibir comunicaciones no esenciales"
      ],
      cookies: "Cookies y Seguimiento",
      cookiesDesc: "Utilizamos cookies y tecnologías de seguimiento similares para mejorar tu experiencia y analizar patrones de uso.",
      cookiesItems: [
        "Cookies esenciales para la funcionalidad de la aplicación",
        "Cookies de análisis para mejorar la experiencia del usuario",
        "Cookies de preferencias para recordar tu configuración",
        "Cookies de marketing para contenido personalizado"
      ],
      contactUs: "Contáctanos",
      contactUsDesc: "Si tienes alguna pregunta sobre esta Política de Privacidad, por favor contáctanos:",
      email: "privacy@meetingguard.ai",
      address: "MeetingGuard AI\n123 Innovation Street\nTech City, TC 12345",
      backToDashboard: "Volver al Panel"
    },
    // Terms of Service
    terms: {
      title: "Términos de Servicio",
      subtitle: "Por favor lee estos términos cuidadosamente antes de usar nuestro servicio",
      lastUpdated: "Última actualización: Diciembre 2024",
      acceptance: "Aceptación de Términos",
      acceptanceDesc: "Al acceder y usar MeetingGuard AI, aceptas y te comprometes a cumplir con los términos y disposiciones de este acuerdo.",
      serviceDescription: "Descripción del Servicio",
      serviceDescriptionDesc: "MeetingGuard AI es una plataforma inteligente de gestión de reuniones que proporciona:",
      serviceDescriptionItems: [
        "Programación y gestión de reuniones impulsada por IA",
        "Notificaciones y recordatorios inteligentes",
        "Integración y sincronización de calendarios",
        "Analíticas e insights de reuniones",
        "Características de colaboración en equipo"
      ],
      userAccounts: "Cuentas de Usuario",
      userAccountsDesc: "Para usar nuestro servicio, debes:",
      userAccountsItems: [
        "Tener al menos 18 años o tener consentimiento parental",
        "Proporcionar información precisa y completa",
        "Mantener la seguridad de las credenciales de tu cuenta",
        "Notificarnos inmediatamente de cualquier uso no autorizado",
        "Aceptar la responsabilidad de todas las actividades bajo tu cuenta"
      ],
      acceptableUse: "Uso Aceptable",
      acceptableUseDesc: "Aceptas usar nuestro servicio solo para propósitos legales y de acuerdo con estos términos. Aceptas no:",
      acceptableUseItems: [
        "Usar el servicio para cualquier propósito ilegal o no autorizado",
        "Interferir o interrumpir el servicio o servidores",
        "Intentar obtener acceso no autorizado a cualquier parte del servicio",
        "Usar sistemas automatizados para acceder al servicio",
        "Compartir las credenciales de tu cuenta con otros"
      ],
      intellectualProperty: "Propiedad Intelectual",
      intellectualPropertyDesc: "El servicio y su contenido original, características y funcionalidad son propiedad de MeetingGuard AI y están protegidos por leyes internacionales de derechos de autor, marcas registradas, patentes, secretos comerciales y otras leyes de propiedad intelectual.",
      privacy: "Privacidad",
      privacyDesc: "Tu privacidad es importante para nosotros. Por favor revisa nuestra Política de Privacidad, que también rige tu uso del servicio, para entender nuestras prácticas.",
      termination: "Terminación",
      terminationDesc: "Podemos terminar o suspender tu cuenta y prohibir el acceso al servicio inmediatamente, sin previo aviso o responsabilidad, bajo nuestra sola discreción, por cualquier razón, incluyendo sin limitación si incumples los términos.",
      disclaimers: "Descargos de Responsabilidad",
      disclaimersDesc: "El servicio se proporciona 'TAL COMO ESTÁ' y 'SEGÚN DISPONIBILIDAD'. MeetingGuard AI no hace garantías, expresas o implícitas, y por la presente renuncia a todas las garantías, incluyendo sin limitación:",
      disclaimersItems: [
        "Garantía de comerciabilidad o idoneidad para un propósito particular",
        "No infracción de derechos de terceros",
        "Servicio ininterrumpido o libre de errores",
        "Precisión o confiabilidad de la información proporcionada"
      ],
      contact: "Información de Contacto",
      contactDesc: "Si tienes alguna pregunta sobre estos Términos de Servicio, por favor contáctanos en:",
      email: "legal@meetingguard.ai",
      address: "MeetingGuard AI\n123 Innovation Street\nTech City, TC 12345",
      backToDashboard: "Volver al Panel"
    },
    // Common
    common: {
      save: "Guardar",
      cancel: "Cancelar",
      confirm: "Confirmar",
      delete: "Eliminar",
      edit: "Editar",
      back: "Atrás",
      next: "Siguiente",
      loading: "Cargando...",
      error: "Error",
      success: "Éxito",
      logout: "Cerrar Sesión",
      confirmLogout: "¿Estás seguro de que quieres cerrar sesión?",
      settings: "Configuración"
    }
  },
  fr: {
    // Dashboard
    dashboard: {
      title: "Tableau de Bord",
      subtitle: "Votre centre de commande de réunions alimenté par IA",
      createNewMeeting: "Créer Nouvelle Réunion",
      meetingsToday: "Réunions Aujourd'hui",
      aiAssisted: "Assisté par IA",
      aiAssistedSubtext: "Réunions créées avec l'aide de l'IA",
      smartAlerts: "Alertes Intelligentes",
      aiInsights: "Insights IA",
      needsReview: "Nécessitent Révision",
      allGood: "Tout Va Bien",
      testGlobalAlert: "Test Alerte Globale",
      testAlertSubtitle: "Testez le système pour vous assurer qu'il fonctionne correctement",
      todaysMeetings: "Réunions d'Aujourd'hui",
      noMeetings: "Aucune réunion programmée pour aujourd'hui",
      noMeetingsSubtext: "Commencez par créer votre première réunion"
    },
    // Navigation
    nav: {
      dashboard: "Tableau de Bord",
      addMeeting: "Ajouter Réunion",
      calendar: "Calendrier",
      notes: "Notes et Tâches",
      aiChat: "Chat IA",
      settings: "Paramètres",
      apiKeys: "Clés API"
    },
    // Meeting
    meeting: {
      title: "Titre",
      description: "Description",
      date: "Date",
      time: "Heure",
      duration: "Durée",
      minutes: "min",
      participants: "Participants",
      location: "Lieu",
      confidence: "Confiance",
      source: "Source"
    },
    // Common
    common: {
      save: "Enregistrer",
      cancel: "Annuler",
      confirm: "Confirmer",
      delete: "Supprimer",
      edit: "Modifier",
      back: "Retour",
      next: "Suivant",
      loading: "Chargement...",
      error: "Erreur",
      success: "Succès"
    }
  },
  de: {
    // Dashboard
    dashboard: {
      title: "Dashboard",
      subtitle: "Ihr KI-gestütztes Meeting-Kommandozentrum",
      createNewMeeting: "Neues Meeting Erstellen",
      meetingsToday: "Meetings Heute",
      aiAssisted: "KI-Unterstützt",
      aiAssistedSubtext: "Meetings mit KI-Hilfe erstellt",
      smartAlerts: "Intelligente Benachrichtigungen",
      aiInsights: "KI-Einblicke",
      needsReview: "Benötigen Überprüfung",
      allGood: "Alles Gut",
      testGlobalAlert: "Globale Benachrichtigung Testen",
      testAlertSubtitle: "Testen Sie das System, um sicherzustellen, dass es korrekt funktioniert",
      todaysMeetings: "Heutige Meetings",
      noMeetings: "Keine Meetings für heute geplant",
      noMeetingsSubtext: "Beginnen Sie mit der Erstellung Ihres ersten Meetings"
    },
    // Navigation
    nav: {
      dashboard: "Dashboard",
      addMeeting: "Meeting Hinzufügen",
      calendar: "Kalender",
      notes: "Notizen & Aufgaben",
      aiChat: "KI-Chat",
      settings: "Einstellungen",
      apiKeys: "API-Schlüssel"
    },
    // Meeting
    meeting: {
      title: "Titel",
      description: "Beschreibung",
      date: "Datum",
      time: "Uhrzeit",
      duration: "Dauer",
      minutes: "Min",
      participants: "Teilnehmer",
      location: "Ort",
      confidence: "Vertrauen",
      source: "Quelle"
    },
    // Common
    common: {
      save: "Speichern",
      cancel: "Abbrechen",
      confirm: "Bestätigen",
      delete: "Löschen",
      edit: "Bearbeiten",
      back: "Zurück",
      next: "Weiter",
      loading: "Wird geladen...",
      error: "Fehler",
      success: "Erfolg"
    }
  },
  pt: {
    // Dashboard
    dashboard: {
      title: "Painel Principal",
      subtitle: "Seu centro de comando de reuniões com IA",
      createNewMeeting: "Criar Nova Reunião",
      meetingsToday: "Reuniões Hoje",
      aiAssisted: "Assistido por IA",
      aiAssistedSubtext: "Reuniões criadas com ajuda da IA",
      smartAlerts: "Alertas Inteligentes",
      aiInsights: "Insights de IA",
      needsReview: "Precisam Revisão",
      allGood: "Tudo Bem",
      testGlobalAlert: "Testar Alerta Global",
      testAlertSubtitle: "Teste o sistema para garantir que funciona corretamente",
      todaysMeetings: "Reuniões de Hoje",
      noMeetings: "Nenhuma reunião agendada para hoje",
      noMeetingsSubtext: "Comece criando sua primeira reunião"
    },
    // Navigation
    nav: {
      dashboard: "Painel",
      addMeeting: "Adicionar Reunião",
      calendar: "Calendário",
      notes: "Notas e Tarefas",
      aiChat: "Chat IA",
      settings: "Configurações",
      apiKeys: "Chaves API"
    },
    // Meeting
    meeting: {
      title: "Título",
      description: "Descrição",
      date: "Data",
      time: "Hora",
      duration: "Duração",
      minutes: "min",
      participants: "Participantes",
      location: "Local",
      confidence: "Confiança",
      source: "Fonte"
    },
    // Common
    common: {
      save: "Salvar",
      cancel: "Cancelar",
      confirm: "Confirmar",
      delete: "Excluir",
      edit: "Editar",
      back: "Voltar",
      next: "Próximo",
      loading: "Carregando...",
      error: "Erro",
      success: "Sucesso"
    }
  },
  zh: {
    // Dashboard - 简体中文
    dashboard: {
      title: "控制面板",
      subtitle: "您的AI智能会议指挥中心",
      createNewMeeting: "创建新会议",
      meetingsToday: "今天的会议",
      aiAssisted: "AI辅助",
      aiAssistedSubtext: "由AI帮助创建的会议",
      smartAlerts: "智能提醒",
      aiInsights: "AI洞察",
      needsReview: "需要审核",
      allGood: "一切正常",
      testGlobalAlert: "测试全局提醒",
      testAlertSubtitle: "测试系统以确保正常工作",
      todaysMeetings: "今天的会议",
      noMeetings: "今天没有安排会议",
      noMeetingsSubtext: "开始创建您的第一个会议吧"
    },
    // Navigation
    nav: {
      dashboard: "控制面板",
      addMeeting: "添加会议",
      calendar: "日历",
      notes: "笔记与任务",
      aiChat: "AI聊天",
      settings: "设置",
      apiKeys: "API密钥"
    },
    // Meeting
    meeting: {
      title: "标题",
      description: "描述",
      date: "日期",
      time: "时间",
      duration: "持续时间",
      minutes: "分钟",
      participants: "参与者",
      location: "地点",
      confidence: "置信度",
      source: "来源"
    },
    // Common
    common: {
      save: "保存",
      cancel: "取消",
      confirm: "确认",
      delete: "删除",
      edit: "编辑",
      back: "返回",
      next: "下一步",
      loading: "加载中...",
      error: "错误",
      success: "成功"
    }
  },
  'zh-TW': {
    // Dashboard - 繁體中文
    dashboard: {
      title: "控制面板",
      subtitle: "您的AI智慧會議指揮中心",
      createNewMeeting: "建立新會議",
      meetingsToday: "今天的會議",
      aiAssisted: "AI輔助",
      aiAssistedSubtext: "由AI協助建立的會議",
      smartAlerts: "智慧提醒",
      aiInsights: "AI洞察",
      needsReview: "需要審核",
      allGood: "一切正常",
      testGlobalAlert: "測試全域提醒",
      testAlertSubtitle: "測試系統以確保正常運作",
      todaysMeetings: "今天的會議",
      noMeetings: "今天沒有安排會議",
      noMeetingsSubtext: "開始建立您的第一個會議吧"
    },
    // Navigation
    nav: {
      dashboard: "控制面板",
      addMeeting: "新增會議",
      calendar: "行事曆",
      notes: "筆記與任務",
      aiChat: "AI聊天",
      settings: "設定",
      apiKeys: "API金鑰"
    },
    // Meeting
    meeting: {
      title: "標題",
      description: "描述",
      date: "日期",
      time: "時間",
      duration: "持續時間",
      minutes: "分鐘",
      participants: "參與者",
      location: "地點",
      confidence: "信心度",
      source: "來源"
    },
    // Common
    common: {
      save: "儲存",
      cancel: "取消",
      confirm: "確認",
      delete: "刪除",
      edit: "編輯",
      back: "返回",
      next: "下一步",
      loading: "載入中...",
      error: "錯誤",
      success: "成功"
    }
  }
};

// Hook personalizado para traducciones
export const useTranslation = (language = 'en') => {
  const t = (key) => {
    const keys = key.split('.');
    let value = translations[language] || translations['en'];
    
    for (const k of keys) {
      value = value?.[k];
      if (!value) break;
    }
    
    // Fallback a inglés si no existe la traducción
    if (!value && language !== 'en') {
      let fallback = translations['en'];
      for (const k of keys) {
        fallback = fallback?.[k];
        if (!fallback) break;
      }
      value = fallback;
    }
    
    return value || key;
  };
  
  return { t };
};

// Función para obtener idiomas disponibles
export const getAvailableLanguages = () => [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'pt', name: 'Português', flag: '🇧🇷' },
  { code: 'zh', name: '简体中文', flag: '🇨🇳' },
  { code: 'zh-TW', name: '繁體中文', flag: '🇹🇼' }
];
