// Firestore Service
// Replaces backend database with Firebase Firestore

import { db } from '../config/firebase';
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  limit,
  Timestamp,
  serverTimestamp,
  onSnapshot,
} from 'firebase/firestore';
import { auth } from '../config/firebase';

class FirestoreService {
  constructor() {
    this.db = db;
  }

  /**
   * Get current user ID
   */
  getCurrentUserId() {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('User not authenticated');
    }
    return user.uid;
  }

  /**
   * Get user document
   */
  async getUser(userId) {
    try {
      const userRef = doc(this.db, 'users', userId);
      const userSnap = await getDoc(userRef);
      
      if (userSnap.exists()) {
        return { id: userSnap.id, ...userSnap.data() };
      }
      return null;
    } catch (error) {
      console.error('Error getting user:', error);
      throw error;
    }
  }

  /**
   * Create or update user document
   */
  async saveUser(userData) {
    try {
      const userId = this.getCurrentUserId();
      const userRef = doc(this.db, 'users', userId);
      
      await setDoc(userRef, {
        ...userData,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      
      return { id: userId, ...userData };
    } catch (error) {
      console.error('Error saving user:', error);
      throw error;
    }
  }

  /**
   * Get all meetings for current user
   */
  async getMeetings(options = {}) {
    try {
      const userId = this.getCurrentUserId();
      const meetingsRef = collection(this.db, 'users', userId, 'meetings');
      
      let q = query(meetingsRef);
      
      // Apply filters
      if (options.startDate) {
        q = query(q, where('date', '>=', options.startDate));
      }
      if (options.endDate) {
        q = query(q, where('date', '<=', options.endDate));
      }
      
      // Apply sorting
      if (options.sortBy === '-created_date' || options.sortBy === '-date') {
        q = query(q, orderBy('created_date', 'desc'));
      } else if (options.sortBy === 'date') {
        q = query(q, orderBy('date', 'asc'));
      }
      
      // Apply limit
      if (options.limit) {
        q = query(q, limit(options.limit));
      }
      
      const querySnapshot = await getDocs(q);
      const meetings = [];
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        meetings.push({
          id: doc.id,
          ...data,
          // Convert Firestore Timestamps to dates
          date: data.date?.toDate?.()?.toISOString() || data.date,
          created_date: data.created_date?.toDate?.()?.toISOString() || data.created_date,
          updated_date: data.updated_date?.toDate?.()?.toISOString() || data.updated_date,
        });
      });
      
      return meetings;
    } catch (error) {
      console.error('Error getting meetings:', error);
      throw error;
    }
  }

  /**
   * Get a single meeting
   */
  async getMeeting(meetingId) {
    try {
      const userId = this.getCurrentUserId();
      const meetingRef = doc(this.db, 'users', userId, 'meetings', meetingId);
      const meetingSnap = await getDoc(meetingRef);
      
      if (meetingSnap.exists()) {
        const data = meetingSnap.data();
        return {
          id: meetingSnap.id,
          ...data,
          date: data.date?.toDate?.()?.toISOString() || data.date,
          created_date: data.created_date?.toDate?.()?.toISOString() || data.created_date,
          updated_date: data.updated_date?.toDate?.()?.toISOString() || data.updated_date,
        };
      }
      return null;
    } catch (error) {
      console.error('Error getting meeting:', error);
      throw error;
    }
  }

  /**
   * Create a meeting
   */
  async createMeeting(meetingData) {
    try {
      const userId = this.getCurrentUserId();
      const meetingsRef = collection(this.db, 'users', userId, 'meetings');
      const newMeetingRef = doc(meetingsRef);
      
      const meeting = {
        ...meetingData,
        user_id: userId,
        created_date: serverTimestamp(),
        updated_date: serverTimestamp(),
      };
      
      await setDoc(newMeetingRef, meeting);
      
      return {
        id: newMeetingRef.id,
        ...meetingData,
        created_date: new Date().toISOString(),
        updated_date: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Error creating meeting:', error);
      throw error;
    }
  }

  /**
   * Update a meeting
   */
  async updateMeeting(meetingId, meetingData) {
    try {
      const userId = this.getCurrentUserId();
      const meetingRef = doc(this.db, 'users', userId, 'meetings', meetingId);
      
      await updateDoc(meetingRef, {
        ...meetingData,
        updated_date: serverTimestamp(),
      });
      
      return {
        id: meetingId,
        ...meetingData,
        updated_date: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Error updating meeting:', error);
      throw error;
    }
  }

  /**
   * Delete a meeting
   */
  async deleteMeeting(meetingId) {
    try {
      const userId = this.getCurrentUserId();
      const meetingRef = doc(this.db, 'users', userId, 'meetings', meetingId);
      
      await deleteDoc(meetingRef);
      return true;
    } catch (error) {
      console.error('Error deleting meeting:', error);
      throw error;
    }
  }

  /**
   * Listen to meetings changes (real-time)
   */
  subscribeToMeetings(callback, options = {}) {
    try {
      const userId = this.getCurrentUserId();
      const meetingsRef = collection(this.db, 'users', userId, 'meetings');
      
      let q = query(meetingsRef);
      
      if (options.sortBy === '-created_date' || options.sortBy === '-date') {
        q = query(q, orderBy('created_date', 'desc'));
      } else if (options.sortBy === 'date') {
        q = query(q, orderBy('date', 'asc'));
      }
      
      return onSnapshot(q, (querySnapshot) => {
        const meetings = [];
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          meetings.push({
            id: doc.id,
            ...data,
            date: data.date?.toDate?.()?.toISOString() || data.date,
            created_date: data.created_date?.toDate?.()?.toISOString() || data.created_date,
            updated_date: data.updated_date?.toDate?.()?.toISOString() || data.updated_date,
          });
        });
        callback(meetings);
      });
    } catch (error) {
      console.error('Error subscribing to meetings:', error);
      throw error;
    }
  }

  /**
   * Get user preferences
   */
  async getUserPreferences() {
    try {
      const userId = this.getCurrentUserId();
      const userRef = doc(this.db, 'users', userId);
      const userSnap = await getDoc(userRef);
      
      if (userSnap.exists()) {
        const data = userSnap.data();
        return data.preferences || {};
      }
      return {};
    } catch (error) {
      console.error('Error getting user preferences:', error);
      throw error;
    }
  }

  /**
   * Update user preferences
   */
  async updateUserPreferences(preferences) {
    try {
      const userId = this.getCurrentUserId();
      const userRef = doc(this.db, 'users', userId);
      
      await updateDoc(userRef, {
        preferences: preferences,
        updatedAt: serverTimestamp(),
      });
      
      return preferences;
    } catch (error) {
      console.error('Error updating user preferences:', error);
      throw error;
    }
  }
}

export default new FirestoreService();

