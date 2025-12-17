// Firebase Storage Service
// Replaces backend file uploads with Firebase Storage

import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject, listAll } from 'firebase/storage';
import { app } from '../config/firebase';
import { auth } from '../config/firebase';

const storage = getStorage(app);

class FirebaseStorageService {
  constructor() {
    this.storage = storage;
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
   * Upload a file
   */
  async uploadFile(file, path = null) {
    try {
      const userId = this.getCurrentUserId();
      const fileName = path || `${Date.now()}_${file.name}`;
      const storageRef = ref(this.storage, `users/${userId}/files/${fileName}`);
      
      // Convert file to blob if needed
      let blob;
      if (file.uri) {
        // React Native file
        const response = await fetch(file.uri);
        blob = await response.blob();
      } else if (file instanceof Blob) {
        blob = file;
      } else {
        throw new Error('Invalid file format');
      }
      
      // Upload file
      const snapshot = await uploadBytes(storageRef, blob);
      
      // Get download URL
      const downloadURL = await getDownloadURL(snapshot.ref);
      
      return {
        id: snapshot.ref.name,
        name: file.name || fileName,
        url: downloadURL,
        path: snapshot.ref.fullPath,
        size: snapshot.metadata.size,
        contentType: snapshot.metadata.contentType,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Error uploading file:', error);
      throw error;
    }
  }

  /**
   * Get file download URL
   */
  async getFileURL(filePath) {
    try {
      const fileRef = ref(this.storage, filePath);
      const url = await getDownloadURL(fileRef);
      return url;
    } catch (error) {
      console.error('Error getting file URL:', error);
      throw error;
    }
  }

  /**
   * Delete a file
   */
  async deleteFile(filePath) {
    try {
      const fileRef = ref(this.storage, filePath);
      await deleteObject(fileRef);
      return true;
    } catch (error) {
      console.error('Error deleting file:', error);
      throw error;
    }
  }

  /**
   * List user's files
   */
  async listFiles() {
    try {
      const userId = this.getCurrentUserId();
      const filesRef = ref(this.storage, `users/${userId}/files`);
      const result = await listAll(filesRef);
      
      const files = [];
      for (const itemRef of result.items) {
        const url = await getDownloadURL(itemRef);
        files.push({
          id: itemRef.name,
          name: itemRef.name,
          url: url,
          path: itemRef.fullPath,
        });
      }
      
      return files;
    } catch (error) {
      console.error('Error listing files:', error);
      throw error;
    }
  }
}

export default new FirebaseStorageService();

