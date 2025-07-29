// Mock functions to replace base44 functions

export const googleAuthInitiate = async () => {
  // Mock Google auth initiation
  console.log('Mock Google auth initiated');
  return {
    authUrl: 'https://mock-google-auth.com/auth',
    state: 'mock-state'
  };
};

export const googleAuthCallback = async (code, state) => {
  // Mock Google auth callback
  console.log('Mock Google auth callback', { code, state });
  return {
    success: true,
    user: {
      id: 'google-user-123',
      email: 'user@gmail.com',
      name: 'Google User'
    }
  };
};

export const sendMeetingInvitation = async ({ meetingId, method, recipients }) => {
  // Mock meeting invitation sending
  console.log('Mock sending meeting invitation', { meetingId, method, recipients });
  
  if (method === 'email') {
    // Simulate email sending
    console.log(`Mock email sent to: ${recipients.join(', ')}`);
  }
  
  return {
    success: true,
    message: `Invitation sent via ${method}`,
    recipients: recipients
  };
};

export const respondToInvitation = async (invitationId, response) => {
  // Mock invitation response
  console.log('Mock responding to invitation', { invitationId, response });
  return {
    success: true,
    response: response
  };
};

