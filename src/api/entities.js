import { localStorageAPI } from './localStorage';
import { normalizeDate, normalizeTime } from '../utils';

// Meeting Entity
export const Meeting = {
  list: async (sortBy = "-created_date") => {
    const data = await localStorageAPI.getData();
    let meetings = data.meetings || [];
    
    console.log('Meeting Entity: Loading meetings from storage, count:', meetings.length);
    console.log('Meeting Entity: All meetings:', meetings);
    
    if (sortBy === "-created_date") {
      meetings = meetings.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
    }
    
    console.log('Meeting Entity: Returning meetings:', meetings.length);
    return meetings;
  },

  create: async (meetingData) => {
    console.log('Meeting Entity: Creating meeting with data:', meetingData);
    console.log('Meeting Entity: Date format:', typeof meetingData.date, meetingData.date);
    console.log('Meeting Entity: Time format:', typeof meetingData.time, meetingData.time);
    
    const data = await localStorageAPI.getData();
    const currentUser = await localStorageAPI.getCurrentUser();
    
    // Normalize date and time formats
    const normalizedDate = normalizeDate(meetingData.date);
    const normalizedTime = normalizeTime(meetingData.time);
    
    console.log('Meeting Entity: Normalized date:', normalizedDate);
    console.log('Meeting Entity: Normalized time:', normalizedTime);
    
    // Validate that we have required fields
    if (!meetingData.title) {
      throw new Error('Meeting title is required');
    }
    
    if (!normalizedDate || normalizedDate === '') {
      throw new Error('Meeting date is required');
    }
    
    if (!normalizedTime || normalizedTime === '') {
      throw new Error('Meeting time is required');
    }
    
    const newMeeting = {
      id: localStorageAPI.generateId(),
      ...meetingData,
      date: normalizedDate,
      time: normalizedTime,
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString(),
      created_by: currentUser.email
    };
    
    console.log('Meeting Entity: New meeting object:', newMeeting);
    console.log('Meeting Entity: Final date value:', newMeeting.date);
    console.log('Meeting Entity: Final time value:', newMeeting.time);
    
    data.meetings = data.meetings || [];
    data.meetings.push(newMeeting);
    await localStorageAPI.setData(data);
    
    console.log('Meeting Entity: Meeting created successfully');
    
    return newMeeting;
  },

  update: async (id, updateData) => {
    console.log('Meeting Entity: Updating meeting with id:', id, 'and data:', updateData);
    
    const data = await localStorageAPI.getData();
    const meetingIndex = data.meetings.findIndex(m => m.id === id);
    
    if (meetingIndex !== -1) {
      data.meetings[meetingIndex] = {
        ...data.meetings[meetingIndex],
        ...updateData,
        updated_date: new Date().toISOString()
      };
      await localStorageAPI.setData(data);
      console.log('Meeting Entity: Meeting updated successfully');
      return data.meetings[meetingIndex];
    }
    
    console.log('Meeting Entity: Meeting not found with id:', id);
    throw new Error('Meeting not found');
  },

  delete: async (id) => {
    console.log('Meeting Entity: Deleting meeting with id:', id);
    
    const data = await localStorageAPI.getData();
    data.meetings = data.meetings.filter(m => m.id !== id);
    await localStorageAPI.setData(data);
    
    console.log('Meeting Entity: Meeting deleted successfully');
    return { success: true };
  },

  get: async (id) => {
    const data = await localStorageAPI.getData();
    const meeting = data.meetings.find(m => m.id === id);
    return meeting || null;
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
    const data = await localStorageAPI.getData();
    let prefs = data.userPreferences || [];
    
    if (criteria.created_by) {
      prefs = prefs.filter(p => p.created_by === criteria.created_by);
    }
    
    return prefs;
  },

  create: async (prefData) => {
    const data = await localStorageAPI.getData();
    const newPrefs = {
      id: localStorageAPI.generateId(),
      ...prefData,
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString()
    };
    
    data.userPreferences = data.userPreferences || [];
    data.userPreferences.push(newPrefs);
    await localStorageAPI.setData(data);
    
    return newPrefs;
  },

  update: async (id, updateData) => {
    const data = await localStorageAPI.getData();
    const prefIndex = data.userPreferences.findIndex(p => p.id === id);
    
    if (prefIndex !== -1) {
      data.userPreferences[prefIndex] = {
        ...data.userPreferences[prefIndex],
        ...updateData,
        updated_date: new Date().toISOString()
      };
      await localStorageAPI.setData(data);
      return data.userPreferences[prefIndex];
    }
    
    throw new Error('UserPreferences not found');
  }
};

// ApiKey Entity
export const ApiKey = {
  list: async () => {
    const data = await localStorageAPI.getData();
    return data.apiKeys || [];
  },

  create: async (keyData) => {
    const data = await localStorageAPI.getData();
    const currentUser = await localStorageAPI.getCurrentUser();
    const newKey = {
      id: localStorageAPI.generateId(),
      ...keyData,
      created_date: new Date().toISOString(),
      created_by: currentUser.email
    };
    
    data.apiKeys = data.apiKeys || [];
    data.apiKeys.push(newKey);
    await localStorageAPI.setData(data);
    
    return newKey;
  },

  update: async (id, updateData) => {
    const data = await localStorageAPI.getData();
    const keyIndex = data.apiKeys.findIndex(k => k.id === id);
    
    if (keyIndex !== -1) {
      data.apiKeys[keyIndex] = {
        ...data.apiKeys[keyIndex],
        ...updateData,
        updated_date: new Date().toISOString()
      };
      await localStorageAPI.setData(data);
      return data.apiKeys[keyIndex];
    }
    
    throw new Error('ApiKey not found');
  },

  delete: async (id) => {
    const data = await localStorageAPI.getData();
    data.apiKeys = data.apiKeys.filter(k => k.id !== id);
    await localStorageAPI.setData(data);
    return { success: true };
  }
};

// Note Entity
export const Note = {
  list: async (sortBy = "-created_date") => {
    const data = await localStorageAPI.getData();
    let notes = data.notes || [];
    
    if (sortBy === "-created_date") {
      notes = notes.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
    }
    
    return notes;
  },

  create: async (noteData) => {
    const data = await localStorageAPI.getData();
    const currentUser = await localStorageAPI.getCurrentUser();
    const newNote = {
      id: localStorageAPI.generateId(),
      ...noteData,
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString(),
      created_by: currentUser.email
    };
    
    data.notes = data.notes || [];
    data.notes.push(newNote);
    await localStorageAPI.setData(data);
    
    return newNote;
  },

  update: async (id, updateData) => {
    const data = await localStorageAPI.getData();
    const noteIndex = data.notes.findIndex(n => n.id === id);
    
    if (noteIndex !== -1) {
      data.notes[noteIndex] = {
        ...data.notes[noteIndex],
        ...updateData,
        updated_date: new Date().toISOString()
      };
      await localStorageAPI.setData(data);
      return data.notes[noteIndex];
    }
    
    throw new Error('Note not found');
  },

  delete: async (id) => {
    const data = await localStorageAPI.getData();
    data.notes = data.notes.filter(n => n.id !== id);
    await localStorageAPI.setData(data);
    return { success: true };
  }
};

// User Auth Entity
export const User = {
  me: async () => {
    return await localStorageAPI.getCurrentUser();
  },

  signIn: async (credentials) => {
    // Mock sign in - in real app this would validate credentials
    const user = {
      id: 'user-' + localStorageAPI.generateId(),
      email: credentials.email,
      name: credentials.name || 'User',
      isCurrent: true
    };
    
    const data = await localStorageAPI.getData();
    data.users = data.users || [];
    data.users.push(user);
    await localStorageAPI.setData(data);
    
    return user;
  },

  signOut: async () => {
    const data = await localStorageAPI.getData();
    data.users = data.users.map(u => ({ ...u, isCurrent: false }));
    await localStorageAPI.setData(data);
    return { success: true };
  }
};