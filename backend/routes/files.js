const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../config/database');
const { ValidationError } = require('../middleware/errorHandler');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow common file types
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
      'application/zip',
      'application/x-rar-compressed'
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'), false);
    }
  }
});

/**
 * Upload a file
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file provided'
      });
    }

    const { originalname, mimetype, buffer, size } = req.file;
    const fileId = uuidv4();
    const fileName = `${fileId}-${originalname}`;

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('meeting-files')
      .upload(fileName, buffer, {
        contentType: mimetype,
        upsert: false
      });

    if (error) {
      throw error;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('meeting-files')
      .getPublicUrl(fileName);

    // Store file metadata in database
    const { data: fileRecord, error: dbError } = await supabase
      .from('files')
      .insert({
        id: fileId,
        user_id: req.userId,
        name: originalname,
        type: mimetype,
        size: size,
        url: urlData.publicUrl,
        storage_path: fileName
      })
      .select()
      .single();

    if (dbError) {
      throw dbError;
    }

    res.status(201).json({
      file: fileRecord
    });

  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({
      error: 'Failed to upload file',
      message: error.message
    });
  }
});

/**
 * Get user's files
 */
router.get('/', async (req, res) => {
  try {
    const { data: files, error } = await supabase
      .from('files')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    res.json({
      files: files || []
    });

  } catch (error) {
    console.error('Get files error:', error);
    res.status(500).json({
      error: 'Failed to get files',
      message: error.message
    });
  }
});

/**
 * Delete a file
 */
router.delete('/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;

    // Get file info
    const { data: file, error: fetchError } = await supabase
      .from('files')
      .select('*')
      .eq('id', fileId)
      .eq('user_id', req.userId)
      .single();

    if (fetchError || !file) {
      return res.status(404).json({
        error: 'File not found'
      });
    }

    // Delete from storage
    const { error: storageError } = await supabase.storage
      .from('meeting-files')
      .remove([file.storage_path]);

    if (storageError) {
      console.error('Storage deletion error:', storageError);
    }

    // Delete from database
    const { error: dbError } = await supabase
      .from('files')
      .delete()
      .eq('id', fileId)
      .eq('user_id', req.userId);

    if (dbError) {
      throw dbError;
    }

    res.json({
      message: 'File deleted successfully'
    });

  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({
      error: 'Failed to delete file',
      message: error.message
    });
  }
});

module.exports = router;
