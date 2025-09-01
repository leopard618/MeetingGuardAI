// Mock integrations to replace base44 integrations

export const Core = {
  InvokeLLM: async (prompt, options = {}) => {
    // Mock LLM invocation
    console.log('Mock LLM invoked with:', prompt);
    
    // Simulate AI response based on prompt
    let response = "This is a mock AI response.";
    
    if (prompt.toLowerCase().includes('meeting')) {
      response = "Based on your meeting request, I suggest scheduling it for tomorrow at 2 PM. The meeting should focus on project milestones and team coordination.";
    } else if (prompt.toLowerCase().includes('schedule')) {
      response = "I can help you schedule a meeting. What time works best for you?";
    }
    
    return {
      response: response,
      confidence: 0.85,
      tokens_used: 150
    };
  },

  SendEmail: async (to, subject, body, options = {}) => {
    // Mock email sending
    console.log('Mock email sent:', { to, subject, body });
    return {
      success: true,
      messageId: 'mock-email-id-' + Date.now(),
      sentAt: new Date().toISOString()
    };
  },

  UploadFile: async (file, options = {}) => {
    // Mock file upload
    console.log('Mock file uploaded:', file.name);
    return {
      success: true,
      fileId: 'mock-file-id-' + Date.now(),
      url: 'https://mock-storage.com/files/' + file.name,
      size: file.size
    };
  },

  GenerateImage: async (prompt, options = {}) => {
    // Mock image generation
    console.log('Mock image generated for:', prompt);
    return {
      success: true,
      imageUrl: 'https://mock-image-service.com/generated-image.jpg',
      prompt: prompt
    };
  },

  ExtractDataFromUploadedFile: async (fileId, options = {}) => {
    // Mock data extraction
    console.log('Mock data extracted from file:', fileId);
    return {
      success: true,
      extractedData: {
        text: "Mock extracted text from file",
        entities: ["mock entity 1", "mock entity 2"],
        confidence: 0.9
      }
    };
  }
};

// Individual exports for backward compatibility
export const InvokeLLM = Core.InvokeLLM;
export const SendEmail = Core.SendEmail;
export const UploadFile = Core.UploadFile;
export const GenerateImage = Core.GenerateImage;
export const ExtractDataFromUploadedFile = Core.ExtractDataFromUploadedFile;

