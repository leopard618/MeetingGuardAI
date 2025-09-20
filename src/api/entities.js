import { localStorageAPI } from './localStorage';
import { supabaseMeetingService } from './supabaseMeetingService';
import { normalizeDate, normalizeTime } from '../utils/index.ts';

// Meeting Entity - Now uses Supabase backend
export const Meeting = {
  list: async (sortBy = "-created_date") => {
    try {
      console.log('Meeting Entity: Attempting to load meetings from Supabase backend');
      
      // Try Supabase backend first
      const isSupabaseAvailable = await supabaseMeetingService.isAvailable();
      if (isSupabaseAvailable) {
        console.log('Meeting Entity: Using Supabase backend');
        const meetings = await supabaseMeetingService.list(sortBy);
        console.log('Meeting Entity: Retrieved meetings from Supabase:', meetings.length);
        return meetings;
      }
      
      // Fallback to localStorage if Supabase is not available
      console.log('Meeting Entity: Supabase not available, falling back to localStorage');
      const data = await localStorageAPI.getData();
      let meetings = data.meetings || [];
      
      console.log('Meeting Entity: Loading meetings from storage, count:', meetings.length);
      
      if (sortBy === "-created_date") {
        meetings = meetings.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
      }
      
      console.log('Meeting Entity: Returning meetings from localStorage:', meetings.length);
      return meetings;
    } catch (error) {
      console.error('Meeting Entity: Error loading meetings:', error);
      // Return empty array on error
      return [];
    }
  },

  create: async (meetingData) => {
    try {
      console.log('Meeting Entity: Creating meeting with data:', meetingData);
      console.log('Meeting Entity: Date format:', typeof meetingData.date, meetingData.date);
      console.log('Meeting Entity: Time format:', typeof meetingData.time, meetingData.time);
      
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
      
      // Prepare meeting data with normalized values
      const normalizedMeetingData = {
        ...meetingData,
        date: normalizedDate,
        time: normalizedTime
      };
      
      console.log('Meeting Entity: Normalized meeting data:', normalizedMeetingData);
      
      // Try Supabase backend first
      const isSupabaseAvailable = await supabaseMeetingService.isAvailable();
      if (isSupabaseAvailable) {
        console.log('Meeting Entity: Creating meeting in Supabase backend');
        const createdMeeting = await supabaseMeetingService.create(normalizedMeetingData);
        console.log('Meeting Entity: Meeting created successfully in Supabase:', createdMeeting);
        return createdMeeting;
      }
      
      // Fallback to localStorage if Supabase is not available
      console.log('Meeting Entity: Supabase not available, creating in localStorage');
      const data = await localStorageAPI.getData();
      const currentUser = await localStorageAPI.getCurrentUser();
      
      const newMeeting = {
        id: localStorageAPI.generateId(),
        ...normalizedMeetingData,
        created_date: new Date().toISOString(),
        updated_date: new Date().toISOString(),
        created_by: currentUser.email
      };
      
      console.log('Meeting Entity: New meeting object for localStorage:', newMeeting);
      
      data.meetings = data.meetings || [];
      data.meetings.push(newMeeting);
      await localStorageAPI.setData(data);
      
      console.log('Meeting Entity: Meeting created successfully in localStorage');
      
      return newMeeting;
    } catch (error) {
      console.error('Meeting Entity: Error creating meeting:', error);
      throw error;
    }
  },

  update: async (id, updateData) => {
    try {
      console.log('Meeting Entity: Updating meeting with id:', id, 'and data:', updateData);
      
      // Try Supabase backend first
      const isSupabaseAvailable = await supabaseMeetingService.isAvailable();
      if (isSupabaseAvailable) {
        console.log('Meeting Entity: Updating meeting in Supabase backend');
        const updatedMeeting = await supabaseMeetingService.update(id, updateData);
        console.log('Meeting Entity: Meeting updated successfully in Supabase:', updatedMeeting);
        return updatedMeeting;
      }
      
      // Fallback to localStorage if Supabase is not available
      console.log('Meeting Entity: Supabase not available, updating in localStorage');
      const data = await localStorageAPI.getData();
      const meetingIndex = data.meetings.findIndex(m => m.id === id);
      
      if (meetingIndex !== -1) {
        data.meetings[meetingIndex] = {
          ...data.meetings[meetingIndex],
          ...updateData,
          updated_date: new Date().toISOString()
        };
        await localStorageAPI.setData(data);
        console.log('Meeting Entity: Meeting updated successfully in localStorage');
        return data.meetings[meetingIndex];
      }
      
      console.log('Meeting Entity: Meeting not found with id:', id);
      throw new Error('Meeting not found');
    } catch (error) {
      console.error('Meeting Entity: Error updating meeting:', error);
      throw error;
    }
  },

  delete: async (id) => {
    try {
      console.log('Meeting Entity: Deleting meeting with id:', id);
      
      // Try Supabase backend first
      const isSupabaseAvailable = await supabaseMeetingService.isAvailable();
      if (isSupabaseAvailable) {
        console.log('Meeting Entity: Deleting meeting in Supabase backend');
        const result = await supabaseMeetingService.delete(id);
        console.log('Meeting Entity: Meeting deleted successfully in Supabase');
        return result;
      }
      
      // Fallback to localStorage if Supabase is not available
      console.log('Meeting Entity: Supabase not available, deleting in localStorage');
      const data = await localStorageAPI.getData();
      data.meetings = data.meetings.filter(m => m.id !== id);
      await localStorageAPI.setData(data);
      
      console.log('Meeting Entity: Meeting deleted successfully in localStorage');
      return { success: true };
    } catch (error) {
      console.error('Meeting Entity: Error deleting meeting:', error);
      throw error;
    }
  },

  get: async (id) => {
    try {
      console.log('Meeting Entity: Getting meeting with id:', id);
      
      // Try Supabase backend first
      const isSupabaseAvailable = await supabaseMeetingService.isAvailable();
      if (isSupabaseAvailable) {
        console.log('Meeting Entity: Getting meeting from Supabase backend');
        const meeting = await supabaseMeetingService.get(id);
        console.log('Meeting Entity: Retrieved meeting from Supabase:', meeting);
        return meeting;
      }
      
      // Fallback to localStorage if Supabase is not available
      console.log('Meeting Entity: Supabase not available, getting from localStorage');
      const data = await localStorageAPI.getData();
      const meeting = data.meetings.find(m => m.id === id);
      console.log('Meeting Entity: Retrieved meeting from localStorage:', meeting);
      return meeting || null;
    } catch (error) {
      console.error('Meeting Entity: Error getting meeting:', error);
      return null;
    }
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