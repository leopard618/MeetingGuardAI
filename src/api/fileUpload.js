// File Upload Service
// Handles document and image uploads for meetings

import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';

class FileUploadService {
  constructor() {
    this.supportedTypes = {
      documents: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain',
        'text/csv'
      ],
      images: [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/bmp'
      ],
      videos: [
        'video/mp4',
        'video/avi',
        'video/mov',
        'video/wmv',
        'video/flv'
      ],
      audio: [
        'audio/mpeg',
        'audio/wav',
        'audio/ogg',
        'audio/mp3',
        'audio/aac'
      ],
      archives: [
        'application/zip',
        'application/x-rar-compressed',
        'application/x-7z-compressed',
        'application/x-tar',
        'application/gzip'
      ]
    };
    
    this.maxFileSize = 50 * 1024 * 1024; // 50MB
  }

  /**
   * Pick a document from device
   */
  async pickDocument(options = {}) {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: options.type || '*/*',
        copyToCacheDirectory: true,
        multiple: options.multiple || false,
        ...options
      });

      if (!result.canceled && result.assets) {
        const files = Array.isArray(result.assets) ? result.assets : [result.assets];
        return await this.processFiles(files);
      }

      return { success: false, message: 'Document picking cancelled' };
    } catch (error) {
      console.error('Error picking document:', error);
      throw new Error('Failed to pick document');
    }
  }

  /**
   * Pick images from device
   */
  async pickImages(options = {}) {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (status !== 'granted') {
        throw new Error('Permission to access media library was denied');
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: options.multiple || false,
        quality: options.quality || 0.8,
        aspect: options.aspect || [4, 3],
        ...options
      });

      if (!result.canceled && result.assets) {
        const files = Array.isArray(result.assets) ? result.assets : [result.assets];
        return await this.processImageFiles(files);
      }

      return { success: false, message: 'Image picking cancelled' };
    } catch (error) {
      console.error('Error picking images:', error);
      throw new Error('Failed to pick images');
    }
  }

  /**
   * Take a photo with camera
   */
  async takePhoto(options = {}) {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      
      if (status !== 'granted') {
        throw new Error('Permission to access camera was denied');
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: options.quality || 0.8,
        aspect: options.aspect || [4, 3],
        ...options
      });

      if (!result.canceled && result.assets) {
        const files = Array.isArray(result.assets) ? result.assets : [result.assets];
        return await this.processImageFiles(files);
      }

      return { success: false, message: 'Photo capture cancelled' };
    } catch (error) {
      console.error('Error taking photo:', error);
      throw new Error('Failed to take photo');
    }
  }

  /**
   * Process picked files
   */
  async processFiles(files) {
    const processedFiles = [];
    const errors = [];

    for (const file of files) {
      try {
        const processedFile = await this.processFile(file);
        if (processedFile) {
          processedFiles.push(processedFile);
        }
      } catch (error) {
        errors.push({ file: file.name, error: error.message });
      }
    }

    return {
      success: processedFiles.length > 0,
      files: processedFiles,
      errors: errors,
      message: `Processed ${processedFiles.length} files${errors.length > 0 ? `, ${errors.length} errors` : ''}`
    };
  }

  /**
   * Process a single file
   */
  async processFile(file) {
    try {
      // Validate file size
      if (file.size && file.size > this.maxFileSize) {
        throw new Error(`File size exceeds ${this.maxFileSize / (1024 * 1024)}MB limit`);
      }

      // Validate file type
      const fileType = this.getFileType(file.mimeType || file.type);
      if (!fileType) {
        throw new Error('Unsupported file type');
      }

      // Generate unique file ID
      const fileId = this.generateFileId();
      
      // Copy file to app's document directory
      const fileName = `${fileId}_${file.name}`;
      const destinationUri = `${FileSystem.documentDirectory}uploads/${fileName}`;
      
      // Ensure uploads directory exists
      await this.ensureUploadsDirectory();
      
      // Copy file
      await FileSystem.copyAsync({
        from: file.uri,
        to: destinationUri
      });

      // Get file info
      const fileInfo = await FileSystem.getInfoAsync(destinationUri);
      
      const processedFile = {
        id: fileId,
        name: file.name,
        type: fileType,
        mimeType: file.mimeType || file.type,
        size: file.size || fileInfo.size,
        uri: destinationUri,
        originalUri: file.uri,
        uploadedAt: new Date().toISOString(),
        meetingId: null, // Will be set when attached to meeting
        thumbnail: await this.generateThumbnail(file, fileType)
      };

      // Store file metadata
      await this.storeFileMetadata(processedFile);

      return processedFile;
    } catch (error) {
      console.error('Error processing file:', error);
      throw error;
    }
  }

  /**
   * Process image files (special handling for images)
   */
  async processImageFiles(files) {
    const processedFiles = [];
    const errors = [];

    for (const file of files) {
      try {
        // Convert ImagePicker result to standard format
        const standardFile = {
          uri: file.uri,
          name: file.fileName || `image_${Date.now()}.jpg`,
          type: 'image/jpeg',
          size: file.fileSize,
          width: file.width,
          height: file.height
        };

        const processedFile = await this.processFile(standardFile);
        if (processedFile) {
          processedFiles.push(processedFile);
        }
      } catch (error) {
        errors.push({ file: file.fileName, error: error.message });
      }
    }

    return {
      success: processedFiles.length > 0,
      files: processedFiles,
      errors: errors,
      message: `Processed ${processedFiles.length} images${errors.length > 0 ? `, ${errors.length} errors` : ''}`
    };
  }

  /**
   * Generate thumbnail for file
   */
  async generateThumbnail(file, fileType) {
    try {
      if (fileType === 'images') {
        // For images, use the file itself as thumbnail
        return file.uri;
      } else {
        // For other file types, generate a placeholder or icon
        return this.getFileTypeIcon(fileType);
      }
    } catch (error) {
      console.error('Error generating thumbnail:', error);
      return null;
    }
  }

  /**
   * Get file type icon
   */
  getFileTypeIcon(fileType) {
    const icons = {
      documents: '📄',
      images: '🖼️',
      videos: '🎥',
      audio: '🎵',
      archives: '📦'
    };
    return icons[fileType] || '📎';
  }

  /**
   * Determine file type from MIME type
   */
  getFileType(mimeType) {
    if (!mimeType) return null;

    for (const [type, mimeTypes] of Object.entries(this.supportedTypes)) {
      if (mimeTypes.includes(mimeType)) {
        return type;
      }
    }

    return null;
  }

  /**
   * Ensure uploads directory exists
   */
  async ensureUploadsDirectory() {
    const uploadsDir = `${FileSystem.documentDirectory}uploads/`;
    const dirInfo = await FileSystem.getInfoAsync(uploadsDir);
    
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(uploadsDir, { intermediates: true });
    }
  }

  /**
   * Generate unique file ID
   */
  generateFileId() {
    return `file_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Store file metadata
   */
  async storeFileMetadata(file) {
    try {
      const key = `file_${file.id}`;
      await AsyncStorage.setItem(key, JSON.stringify(file));
    } catch (error) {
      console.error('Error storing file metadata:', error);
    }
  }

  /**
   * Get file metadata
   */
  async getFileMetadata(fileId) {
    try {
      const key = `file_${fileId}`;
      const metadata = await AsyncStorage.getItem(key);
      return metadata ? JSON.parse(metadata) : null;
    } catch (error) {
      console.error('Error getting file metadata:', error);
      return null;
    }
  }

  /**
   * Attach file to meeting
   */
  async attachFileToMeeting(fileId, meetingId) {
    try {
      const file = await this.getFileMetadata(fileId);
      if (!file) {
        throw new Error('File not found');
      }

      file.meetingId = meetingId;
      await this.storeFileMetadata(file);

      return { success: true, file };
    } catch (error) {
      console.error('Error attaching file to meeting:', error);
      throw error;
    }
  }

  /**
   * Get files for a meeting
   */
  async getMeetingFiles(meetingId) {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const fileKeys = keys.filter(key => key.startsWith('file_'));
      const files = [];

      for (const key of fileKeys) {
        const file = await this.getFileMetadata(key.replace('file_', ''));
        if (file && file.meetingId === meetingId) {
          files.push(file);
        }
      }

      return files;
    } catch (error) {
      console.error('Error getting meeting files:', error);
      return [];
    }
  }

  /**
   * Delete file
   */
  async deleteFile(fileId) {
    try {
      const file = await this.getFileMetadata(fileId);
      if (!file) {
        throw new Error('File not found');
      }

      // Delete file from storage
      await FileSystem.deleteAsync(file.uri, { idempotent: true });
      
      // Delete metadata
      const key = `file_${fileId}`;
      await AsyncStorage.removeItem(key);

      return { success: true };
    } catch (error) {
      console.error('Error deleting file:', error);
      throw error;
    }
  }

  /**
   * Get supported file types
   */
  getSupportedTypes() {
    return this.supportedTypes;
  }

  /**
   * Get file type display names
   */
  getFileTypeNames() {
    return {
      documents: 'Documents (PDF, Word, Excel, PowerPoint, Text)',
      images: 'Images (JPEG, PNG, GIF, WebP)',
      videos: 'Videos (MP4, AVI, MOV, WMV)',
      audio: 'Audio (MP3, WAV, OGG, AAC)',
      archives: 'Archives (ZIP, RAR, 7Z, TAR)'
    };
  }
}

export default new FileUploadService();
