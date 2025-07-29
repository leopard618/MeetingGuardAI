import { localStorageAPI } from './localStorage';

// Meeting Entity
export const Meeting = {
  list: async (sortBy = "-created_date") => {
    const data = localStorageAPI.getData();
    let meetings = data.meetings || [];
    
    if (sortBy === "-created_date") {
      meetings = meetings.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
    }
    
    return meetings;
  },

  create: async (meetingData) => {
    const data = localStorageAPI.getData();
    const newMeeting = {
      id: localStorageAPI.generateId(),
      ...meetingData,
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString(),
      created_by: localStorageAPI.getCurrentUser().email
    };
    
    data.meetings = data.meetings || [];
    data.meetings.push(newMeeting);
    localStorageAPI.setData(data);
    
    return newMeeting;
  },

  update: async (id, updateData) => {
    const data = localStorageAPI.getData();
    const meetingIndex = data.meetings.findIndex(m => m.id === id);
    
    if (meetingIndex !== -1) {
      data.meetings[meetingIndex] = {
        ...data.meetings[meetingIndex],
        ...updateData,
        updated_date: new Date().toISOString()
      };
      localStorageAPI.setData(data);
      return data.meetings[meetingIndex];
    }
    
    throw new Error('Meeting not found');
  },

  delete: async (id) => {
    const data = localStorageAPI.getData();
    data.meetings = data.meetings.filter(m => m.id !== id);
    localStorageAPI.setData(data);
    return { success: true };
  },

  schema: () => ({
    title: { type: 'string', required: true },
    date: { type: 'string', required: true },
    time: { type: 'string', required: true },
    duration: { type: 'number', default: 60 },
    description: { type: 'string' },
    location: { type: 'object' },
    participants: { type: 'array' },
    source: { type: 'string' },
    confidence: { type: 'number' },
    preparation_tips: { type: 'array' }
  })
};

// UserPreferences Entity
export const UserPreferences = {
  filter: async (criteria) => {
    const data = localStorageAPI.getData();
    let prefs = data.userPreferences || [];
    
    if (criteria.created_by) {
      prefs = prefs.filter(p => p.created_by === criteria.created_by);
    }
    
    return prefs;
  },

  create: async (prefData) => {
    const data = localStorageAPI.getData();
    const newPrefs = {
      id: localStorageAPI.generateId(),
      ...prefData,
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString()
    };
    
    data.userPreferences = data.userPreferences || [];
    data.userPreferences.push(newPrefs);
    localStorageAPI.setData(data);
    
    return newPrefs;
  },

  update: async (id, updateData) => {
    const data = localStorageAPI.getData();
    const prefIndex = data.userPreferences.findIndex(p => p.id === id);
    
    if (prefIndex !== -1) {
      data.userPreferences[prefIndex] = {
        ...data.userPreferences[prefIndex],
        ...updateData,
        updated_date: new Date().toISOString()
      };
      localStorageAPI.setData(data);
      return data.userPreferences[prefIndex];
    }
    
    throw new Error('UserPreferences not found');
  }
};

// ApiKey Entity
export const ApiKey = {
  list: async () => {
    const data = localStorageAPI.getData();
    return data.apiKeys || [];
  },

  create: async (keyData) => {
    const data = localStorageAPI.getData();
    const newKey = {
      id: localStorageAPI.generateId(),
      ...keyData,
      created_date: new Date().toISOString(),
      created_by: localStorageAPI.getCurrentUser().email
    };
    
    data.apiKeys = data.apiKeys || [];
    data.apiKeys.push(newKey);
    localStorageAPI.setData(data);
    
    return newKey;
  },

  update: async (id, updateData) => {
    const data = localStorageAPI.getData();
    const keyIndex = data.apiKeys.findIndex(k => k.id === id);
    
    if (keyIndex !== -1) {
      data.apiKeys[keyIndex] = {
        ...data.apiKeys[keyIndex],
        ...updateData,
        updated_date: new Date().toISOString()
      };
      localStorageAPI.setData(data);
      return data.apiKeys[keyIndex];
    }
    
    throw new Error('ApiKey not found');
  },

  delete: async (id) => {
    const data = localStorageAPI.getData();
    data.apiKeys = data.apiKeys.filter(k => k.id !== id);
    localStorageAPI.setData(data);
    return { success: true };
  }
};

// Note Entity
export const Note = {
  list: async (sortBy = "-created_date") => {
    const data = localStorageAPI.getData();
    let notes = data.notes || [];
    
    if (sortBy === "-created_date") {
      notes = notes.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
    }
    
    return notes;
  },

  create: async (noteData) => {
    const data = localStorageAPI.getData();
    const newNote = {
      id: localStorageAPI.generateId(),
      ...noteData,
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString(),
      created_by: localStorageAPI.getCurrentUser().email
    };
    
    data.notes = data.notes || [];
    data.notes.push(newNote);
    localStorageAPI.setData(data);
    
    return newNote;
  },

  update: async (id, updateData) => {
    const data = localStorageAPI.getData();
    const noteIndex = data.notes.findIndex(n => n.id === id);
    
    if (noteIndex !== -1) {
      data.notes[noteIndex] = {
        ...data.notes[noteIndex],
        ...updateData,
        updated_date: new Date().toISOString()
      };
      localStorageAPI.setData(data);
      return data.notes[noteIndex];
    }
    
    throw new Error('Note not found');
  },

  delete: async (id) => {
    const data = localStorageAPI.getData();
    data.notes = data.notes.filter(n => n.id !== id);
    localStorageAPI.setData(data);
    return { success: true };
  }
};

// User Auth Entity
export const User = {
  me: async () => {
    return localStorageAPI.getCurrentUser();
  },

  signIn: async (credentials) => {
    // Mock sign in - in real app this would validate credentials
    const user = {
      id: 'user-' + localStorageAPI.generateId(),
      email: credentials.email,
      name: credentials.name || 'User',
      isCurrent: true
    };
    
    const data = localStorageAPI.getData();
    data.users = data.users || [];
    data.users.push(user);
    localStorageAPI.setData(data);
    
    return user;
  },

  signOut: async () => {
    const data = localStorageAPI.getData();
    data.users = data.users.map(u => ({ ...u, isCurrent: false }));
    localStorageAPI.setData(data);
    return { success: true };
  }
};